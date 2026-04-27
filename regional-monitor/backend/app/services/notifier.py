"""변경 이벤트 알림 발송 — Email + Slack.

호출 흐름:
    persist_results() 가 ChangeEvent 들을 만든 뒤 그 리스트와 사용자/Place 정보를
    notify_user_events() 에 넘긴다. 본 모듈은 사용자의 설정(email_alerts, slack_webhook)에
    따라 채널별로 발송하고, 성공 시 ChangeEvent.notified_email / notified_slack 플래그를
    True 로 기록한다.

설계 원칙:
    - 모든 채널은 best-effort: 한 채널 실패가 다른 채널을 막지 않는다.
    - DB 트랜잭션 외부에서 실행 (slow I/O). 호출자가 commit 한 뒤 await 한다.
    - 개발/테스트 모드(SMTP 미설정)에서는 콘솔 로그로 폴백 — 사용자 행동 영향 없음.
    - 1 user × N events 를 한 번의 메일/슬랙 메시지로 묶어 발송 (스팸 방지).
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Iterable

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.check import ChangeEvent
from app.models.user import User

logger = logging.getLogger("notifier")
# 개발/테스트 모드에서 콘솔 폴백 로그(`[EMAIL fallback]`)가 보이도록 INFO 레벨 보장.
# 운영에서는 외부 logging.basicConfig 가 덮어씀.
if logger.level == logging.NOTSET or logger.level > logging.INFO:
    logger.setLevel(logging.INFO)
if not logger.handlers and not logging.getLogger().handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(_h)

# 이벤트 타입 → 이모지 + 사람 친화 라벨
_EVENT_META: dict[str, dict[str, str]] = {
    "PAGE_DELETED":   {"emoji": "🚫", "label": "페이지 삭제",  "severity": "danger"},
    "EXPOSURE_LOST":  {"emoji": "⚠️", "label": "노출 상실",    "severity": "danger"},
    "REGION_CHANGED": {"emoji": "📍", "label": "지역 변경",    "severity": "danger"},
    "DONG_CHANGED":   {"emoji": "🏘️", "label": "동 변경",     "severity": "warning"},
    "NAME_CHANGED":   {"emoji": "🏷️", "label": "상호 변경",   "severity": "warning"},
    "RECOVERED":      {"emoji": "✅", "label": "정상 회복",    "severity": "info"},
    "OTHER_CHANGED":  {"emoji": "ℹ️", "label": "기타 변경",    "severity": "info"},
}


def _meta(event_type: str) -> dict[str, str]:
    return _EVENT_META.get(event_type, {"emoji": "ℹ️", "label": event_type, "severity": "info"})


# ────────────────────────────────────────────────────────────────────
#  공개 진입점
# ────────────────────────────────────────────────────────────────────


async def notify_user_events(
    db: AsyncSession,
    user: User,
    events: list[ChangeEvent],
    *,
    place_lookup: dict[int, Any],   # place_id_ref → RegisteredPlace (phone/business_name 사용)
) -> dict[str, int]:
    """한 사용자의 새 ChangeEvent 들을 묶어 알림 발송.

    Returns: {"email_sent": 0/1, "slack_sent": 0/1, "skipped": N}
    """
    if not events:
        return {"email_sent": 0, "slack_sent": 0, "skipped": 0}

    sent_email = 0
    sent_slack = 0

    # 1) Email (모든 플랜)
    if user.email_alerts and user.email:
        try:
            ok = await asyncio.get_event_loop().run_in_executor(
                None, _send_email, user, events, place_lookup,
            )
            if ok:
                sent_email = 1
                for e in events:
                    e.notified_email = True
        except Exception as exc:                                            # noqa: BLE001
            logger.warning("email send failed for user=%s: %s", user.id, exc)

    # 2) Slack (Enterprise — webhook 설정되어 있을 때만)
    if user.slack_webhook:
        try:
            ok = await _send_slack(user.slack_webhook, user, events, place_lookup)
            if ok:
                sent_slack = 1
                for e in events:
                    e.notified_slack = True
        except Exception as exc:                                            # noqa: BLE001
            logger.warning("slack send failed for user=%s: %s", user.id, exc)

    # 플래그 변경 commit (이벤트가 attach 되어 있다고 가정)
    if sent_email or sent_slack:
        try:
            await db.commit()
        except Exception:                                                   # noqa: BLE001
            await db.rollback()

    return {"email_sent": sent_email, "slack_sent": sent_slack, "skipped": 0}


# ────────────────────────────────────────────────────────────────────
#  Email — SMTP (또는 미설정 시 콘솔 폴백)
# ────────────────────────────────────────────────────────────────────


def _send_email(
    user: User,
    events: list[ChangeEvent],
    place_lookup: dict[int, Any],
) -> bool:
    """동기 SMTP 발송. asyncio loop 외부에서 run_in_executor 로 호출됨."""
    # 환경 변수 미설정 → 콘솔 폴백 (개발 편의)
    smtp_host = getattr(settings, "SMTP_HOST", "") or ""
    if not smtp_host:
        # 콘솔 폴백
        body = _build_email_body(user, events, place_lookup, plain=True)
        logger.info(
            "[EMAIL fallback] to=%s subject=%s\n%s",
            user.email, _build_subject(events), body,
        )
        return True

    smtp_port = int(getattr(settings, "SMTP_PORT", 587) or 587)
    smtp_user = getattr(settings, "SMTP_USER", "") or ""
    smtp_pass = getattr(settings, "SMTP_PASSWORD", "") or ""
    sender = getattr(settings, "SMTP_FROM", smtp_user) or "no-reply@regionwatch.kr"
    sender_name = getattr(settings, "SMTP_FROM_NAME", "타지역서비스")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = _build_subject(events)
    msg["From"] = f"{sender_name} <{sender}>"
    msg["To"] = user.email
    msg.attach(MIMEText(_build_email_body(user, events, place_lookup, plain=True), "plain", "utf-8"))
    msg.attach(MIMEText(_build_email_body(user, events, place_lookup, plain=False), "html", "utf-8"))

    ctx = ssl.create_default_context()
    if smtp_port == 465:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=15) as srv:
            if smtp_user:
                srv.login(smtp_user, smtp_pass)
            srv.send_message(msg)
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            srv.ehlo()
            try:
                srv.starttls(context=ctx)
                srv.ehlo()
            except smtplib.SMTPException:
                pass                                                        # 이미 평문/내부망
            if smtp_user:
                srv.login(smtp_user, smtp_pass)
            srv.send_message(msg)
    return True


def _build_subject(events: list[ChangeEvent]) -> str:
    n = len(events)
    danger = sum(1 for e in events if _meta(e.event_type)["severity"] == "danger")
    if danger:
        return f"[타지역서비스] ⚠️ 노출 변경 {n}건 감지 (위험 {danger}건)"
    if any(_meta(e.event_type)["severity"] == "warning" for e in events):
        return f"[타지역서비스] 노출 변경 {n}건 감지"
    return f"[타지역서비스] ✅ 변경 알림 {n}건"


def _build_email_body(
    user: User,
    events: list[ChangeEvent],
    place_lookup: dict[int, Any],
    *,
    plain: bool,
) -> str:
    name = user.name or user.email
    n = len(events)
    when = now_kst().strftime("%Y-%m-%d %H:%M KST")
    if plain:
        lines = [
            f"{name}님, 타지역서비스 자동 검증에서 변경 {n}건이 감지되었습니다.",
            f"감지 시각: {when}",
            "",
        ]
        for e in events:
            place = place_lookup.get(e.place_id_ref)
            phone = getattr(place, "phone", "?")
            biz   = getattr(place, "business_name", "(이름 없음)")
            meta  = _meta(e.event_type)
            lines.append(f"  {meta['emoji']} [{meta['label']}] {biz} ({phone})")
            lines.append(f"     {e.summary}  ({e.prev_verdict} → {e.new_verdict})")
            lines.append("")
        lines.append("자세한 내용은 타지역서비스 대시보드에서 확인하세요.")
        lines.append("")
        lines.append("이 알림이 불필요하면 설정에서 [이메일 알림] 을 끌 수 있습니다.")
        return "\n".join(lines)

    # HTML
    rows_html: list[str] = []
    for e in events:
        place = place_lookup.get(e.place_id_ref)
        phone = getattr(place, "phone", "?")
        biz   = getattr(place, "business_name", "(이름 없음)")
        meta  = _meta(e.event_type)
        color = {"danger": "#DC2626", "warning": "#D97706", "info": "#059669"}.get(meta["severity"], "#1F2D4D")
        rows_html.append(f"""
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #E5E7EB;vertical-align:top;width:44px;font-size:22px;">
            {meta['emoji']}
          </td>
          <td style="padding:14px 0 14px 0;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:14px;font-weight:700;color:#1F2D4D;">{_html_escape(biz)}
              <span style="margin-left:6px;font-weight:500;color:#6B7280;font-family:monospace;">{_html_escape(phone)}</span>
            </div>
            <div style="margin-top:4px;font-size:13px;color:#374151;">{_html_escape(e.summary)}</div>
            <div style="margin-top:6px;font-size:11px;color:{color};font-weight:700;">
              [{meta['label']}] · {_html_escape(e.prev_verdict)} → {_html_escape(e.new_verdict)}
            </div>
          </td>
        </tr>""")
    return f"""<!DOCTYPE html>
<html lang="ko"><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(31,45,77,.06);">
    <div style="background:#1F2D4D;color:white;padding:24px 28px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:600;">타지역서비스 · 자동 검증 알림</div>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">{_html_escape(name)}님, 변경 {n}건이 감지되었습니다</h1>
      <div style="margin-top:6px;font-size:13px;color:rgba(255,255,255,.7);">감지 시각: {when}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      {''.join(rows_html)}
    </table>
    <div style="padding:18px 28px;background:#F4F6FA;font-size:12px;color:#6B7280;text-align:center;">
      이 알림이 불필요하면 설정 페이지에서 [이메일 알림] 을 끌 수 있습니다.<br>
      © 타지역서비스
    </div>
  </div>
</body></html>"""


def _html_escape(s: Any) -> str:
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# ────────────────────────────────────────────────────────────────────
#  Slack — Incoming Webhook (블록 키트)
# ────────────────────────────────────────────────────────────────────


async def _send_slack(
    webhook_url: str,
    user: User,
    events: list[ChangeEvent],
    place_lookup: dict[int, Any],
) -> bool:
    n = len(events)
    danger_n = sum(1 for e in events if _meta(e.event_type)["severity"] == "danger")
    when = now_kst().strftime("%Y-%m-%d %H:%M KST")

    title = f"⚠️ 노출 변경 {n}건 감지" + (f" (위험 {danger_n})" if danger_n else "")
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": title, "emoji": True},
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"*타지역서비스* · {user.name or user.email} · {when}"},
            ],
        },
        {"type": "divider"},
    ]

    # 최대 10건만 표시 (Slack 메시지 길이 제한 회피)
    for e in events[:10]:
        place = place_lookup.get(e.place_id_ref)
        phone = getattr(place, "phone", "?")
        biz   = getattr(place, "business_name", "(이름 없음)")
        meta  = _meta(e.event_type)
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"{meta['emoji']} *{biz}* `{phone}`\n"
                    f"_{e.summary}_\n"
                    f"`{e.prev_verdict}` → `{e.new_verdict}` · *{meta['label']}*"
                ),
            },
        })
    if n > 10:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"+ {n - 10}건 더… · 자세한 내용은 대시보드에서 확인"}],
        })

    payload = {"text": title, "blocks": blocks}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(webhook_url, json=payload)
        if r.status_code >= 400:
            logger.warning("slack webhook returned %s: %s", r.status_code, r.text[:200])
            return False
    return True


__all__ = ["notify_user_events"]
