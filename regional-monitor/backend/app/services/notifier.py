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
    run_summary: dict | None = None,  # 회차 요약 (total/ok/dead/mismatch/pending/elapsed_ms/mode/trigger)
) -> dict[str, int]:
    """한 사용자의 새 ChangeEvent 들을 묶어 알림 발송.

    Args:
        run_summary: 자동/수동 검증 회차 요약. 전달되면 메일 상단에 회차 요약 카드 표시.
            예) {"total": 296, "ok": 285, "dead": 8, "mismatch": 3, "pending": 0,
                 "elapsed_ms": 271039, "mode": "fast", "trigger": "scheduler"}
            None이면 변경 상세만 표시 (구버전 호환).

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
                None, _send_email, user, events, place_lookup, run_summary,
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
    run_summary: dict | None = None,
) -> bool:
    """동기 SMTP 발송. asyncio loop 외부에서 run_in_executor 로 호출됨."""
    # 환경 변수 미설정 → 콘솔 폴백 (개발 편의)
    smtp_host = getattr(settings, "SMTP_HOST", "") or ""
    if not smtp_host:
        # 콘솔 폴백
        body = _build_email_body(user, events, place_lookup, plain=True, run_summary=run_summary)
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
    msg["Subject"] = _build_subject(events, run_summary)
    msg["From"] = f"{sender_name} <{sender}>"
    msg["To"] = user.email
    msg.attach(MIMEText(_build_email_body(user, events, place_lookup, plain=True, run_summary=run_summary), "plain", "utf-8"))
    msg.attach(MIMEText(_build_email_body(user, events, place_lookup, plain=False, run_summary=run_summary), "html", "utf-8"))

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


def _build_subject(events: list[ChangeEvent], run_summary: dict | None = None) -> str:
    """제목 — 회차 요약이 있으면 더 풍부하게."""
    n = len(events)
    danger = sum(1 for e in events if _meta(e.event_type)["severity"] == "danger")
    warning = sum(1 for e in events if _meta(e.event_type)["severity"] == "warning")
    info = sum(1 for e in events if _meta(e.event_type)["severity"] == "info")

    # 총 검증 곳 수
    total_str = ""
    if run_summary and run_summary.get("total"):
        total_str = f" ({run_summary['total']}곳 중)"

    if danger:
        return f"[타지역서비스] 🚨 노출 변경 {n}건 감지 — 위험 {danger}건{total_str}"
    if warning:
        return f"[타지역서비스] ⚠️ 노출 변경 {n}건 감지{total_str}"
    if info and all(e.event_type == "RECOVERED" for e in events):
        return f"[타지역서비스] ✅ 정상 회복 {n}건{total_str}"
    return f"[타지역서비스] 노출 변경 {n}건 감지{total_str}"


# ────────────────────────────────────────────────────────────────────
#  이메일 본문 — 회차 요약 카드형 (2026.04 신규 템플릿)
# ────────────────────────────────────────────────────────────────────

# 사이트 URL (환경 분리는 settings로 옮길 수 있음)
_SITE_URL = "https://taziyuk.com"
_HISTORY_URL = f"{_SITE_URL}/history"
_MONITOR_URL = f"{_SITE_URL}/monitor"


def _format_elapsed(ms: int | None) -> str:
    """elapsed_ms → '4분 31초' 형태."""
    if not ms or ms <= 0:
        return "—"
    sec = ms // 1000
    if sec < 60:
        return f"{sec}초"
    m, s = divmod(sec, 60)
    return f"{m}분 {s}초" if s else f"{m}분"


def _trigger_label(trigger: str | None, mode: str | None) -> str:
    """trigger/mode → 사람 친화 라벨."""
    t = "자동 검증" if (trigger or "scheduler") == "scheduler" else "수동 검증"
    m_map = {"fast": "빠른 검증", "full": "정밀 검증"}
    m = m_map.get((mode or "fast").lower(), "")
    return f"{t} · {m}" if m else t


def _build_email_body(
    user: User,
    events: list[ChangeEvent],
    place_lookup: dict[int, Any],
    *,
    plain: bool,
    run_summary: dict | None = None,
) -> str:
    name = user.name or user.email
    n = len(events)
    when_dt = now_kst()
    when = when_dt.strftime("%Y-%m-%d %H:%M KST")

    # 회차 요약 데이터 (없으면 events에서 추정)
    rs = run_summary or {}
    total = rs.get("total")
    ok_n = rs.get("ok")
    dead_n = rs.get("dead", 0)
    mismatch_n = rs.get("mismatch", 0)
    pending_n = rs.get("pending", 0)
    issue_n = (dead_n or 0) + (mismatch_n or 0)  # "이상" = DEAD + MISMATCH
    elapsed = _format_elapsed(rs.get("elapsed_ms"))
    trigger_label = _trigger_label(rs.get("trigger"), rs.get("mode"))
    ok_rate = None
    if total and ok_n is not None and total > 0:
        ok_rate = round((ok_n / total) * 100, 1)

    # 위험도별 카운트
    n_danger = sum(1 for e in events if _meta(e.event_type)["severity"] == "danger")
    n_warning = sum(1 for e in events if _meta(e.event_type)["severity"] == "warning")
    n_info = sum(1 for e in events if _meta(e.event_type)["severity"] == "info")

    # ─── PLAIN TEXT ───
    if plain:
        lines = [
            f"{name}님, 타지역서비스 자동 검증에서 변경 {n}건이 감지되었습니다.",
            f"감지 시각: {when}",
            f"검증 모드: {trigger_label}",
            "",
        ]
        if total:
            lines.append("─── 회차 요약 ───")
            lines.append(f"  검증: {total}곳   정상: {ok_n}곳   이상: {issue_n}곳   변경: {n}건")
            if ok_rate is not None:
                lines.append(f"  정상 노출률: {ok_rate}%   소요시간: {elapsed}")
            lines.append("")
        lines.append("─── 변경 상세 ───")
        for e in events:
            place = place_lookup.get(e.place_id_ref)
            phone = getattr(place, "phone", "?")
            biz   = getattr(place, "business_name", "(이름 없음)")
            meta  = _meta(e.event_type)
            lines.append(f"  {meta['emoji']} [{meta['label']}] {biz} ({phone})")
            lines.append(f"     {e.summary}  ({e.prev_verdict} → {e.new_verdict})")
            lines.append("")
        lines.append(f"대시보드에서 자세히 보기: {_HISTORY_URL}")
        lines.append("")
        lines.append("─────────────────────────────")
        lines.append("이 알림이 불필요하면 설정에서 [이메일 알림] 을 끌 수 있습니다.")
        lines.append("© 타지역서비스네이버노출솔루션")
        return "\n".join(lines)

    # ─── HTML ───

    # 헤더 톤 (위험 1건 이상이면 빨강 라인, 아니면 네이비)
    has_danger = n_danger > 0
    accent_color = "#DC2626" if has_danger else "#1F2D4D"

    # 1) 회차 요약 카드 HTML (run_summary 있을 때만)
    summary_card_html = ""
    if total:
        # 진행 바 색상 (97%↑ 초록, 80~96 주황, 미만 빨강)
        bar_color = "#10B981" if (ok_rate or 0) >= 95 else ("#F59E0B" if (ok_rate or 0) >= 80 else "#EF4444")
        ok_rate_txt = f"{ok_rate}%" if ok_rate is not None else "—"
        bar_pct = max(0, min(100, ok_rate or 0))

        summary_card_html = f"""
        <!-- 회차 요약 카드 -->
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0;padding:0;">
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <div style="font-size:12px;font-weight:700;color:#6B7280;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">
                회차 요약
              </div>
              <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;">
                <tr>
                  {_kpi_cell("검증", str(total), "#1F2D4D")}
                  {_kpi_cell("정상", str(ok_n if ok_n is not None else "—"), "#059669")}
                  {_kpi_cell("이상", str(issue_n), "#DC2626" if issue_n > 0 else "#9CA3AF")}
                  {_kpi_cell("변경", str(n), "#D97706" if n > 0 else "#9CA3AF")}
                </tr>
              </table>
              <div style="margin-top:14px;display:flex;align-items:center;gap:10px;">
                <div style="flex:1;height:8px;background:#E5E7EB;border-radius:999px;overflow:hidden;">
                  <div style="width:{bar_pct}%;height:100%;background:{bar_color};border-radius:999px;"></div>
                </div>
              </div>
              <div style="margin-top:8px;font-size:12px;color:#6B7280;">
                정상 노출률 <b style="color:#1F2D4D;">{ok_rate_txt}</b>
                &nbsp;·&nbsp; 소요시간 <b style="color:#1F2D4D;">{elapsed}</b>
                {f'&nbsp;·&nbsp; 대기 <b style="color:#1F2D4D;">{pending_n}건</b>' if pending_n else ''}
              </div>
            </td>
          </tr>
        </table>
        """

    # 2) 위험도 배지
    severity_badges = []
    if n_danger:
        severity_badges.append(f'<span style="display:inline-block;padding:4px 10px;background:#FEE2E2;color:#B91C1C;border-radius:999px;font-size:11px;font-weight:700;margin-right:6px;">🚨 위험 {n_danger}건</span>')
    if n_warning:
        severity_badges.append(f'<span style="display:inline-block;padding:4px 10px;background:#FEF3C7;color:#92400E;border-radius:999px;font-size:11px;font-weight:700;margin-right:6px;">⚠️ 주의 {n_warning}건</span>')
    if n_info:
        severity_badges.append(f'<span style="display:inline-block;padding:4px 10px;background:#D1FAE5;color:#065F46;border-radius:999px;font-size:11px;font-weight:700;margin-right:6px;">✅ 정보 {n_info}건</span>')
    severity_badges_html = "".join(severity_badges)

    # 3) 변경 상세 행
    rows_html: list[str] = []
    for e in events:
        place = place_lookup.get(e.place_id_ref)
        phone = getattr(place, "phone", "?")
        biz   = getattr(place, "business_name", "(이름 없음)")
        meta  = _meta(e.event_type)
        color = {"danger": "#DC2626", "warning": "#D97706", "info": "#059669"}.get(meta["severity"], "#1F2D4D")
        bg = {"danger": "#FEF2F2", "warning": "#FFFBEB", "info": "#F0FDF4"}.get(meta["severity"], "#FFFFFF")
        rows_html.append(f"""
        <tr>
          <td style="padding:0;">
            <table role="presentation" style="width:100%;border-collapse:collapse;background:{bg};border-left:4px solid {color};margin-bottom:8px;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:14px 16px;vertical-align:top;width:44px;font-size:22px;">
                  {meta['emoji']}
                </td>
                <td style="padding:14px 16px 14px 0;">
                  <div style="font-size:14px;font-weight:700;color:#1F2D4D;line-height:1.4;">
                    {_html_escape(biz)}
                    <span style="margin-left:6px;font-weight:500;color:#6B7280;font-family:'SF Mono',Consolas,monospace;font-size:13px;">{_html_escape(phone)}</span>
                  </div>
                  <div style="margin-top:6px;font-size:13px;color:#374151;line-height:1.5;">{_html_escape(e.summary)}</div>
                  <div style="margin-top:8px;font-size:11px;color:{color};font-weight:700;letter-spacing:.02em;">
                    [{meta['label']}] · {_html_escape(e.prev_verdict)} → {_html_escape(e.new_verdict)}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>""")

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{_html_escape('타지역서비스 자동 검증 알림')}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'맑은 고딕',sans-serif;color:#1F2D4D;">
  <!-- 미리보기 텍스트 (받은편지함 미리보기) -->
  <div style="display:none;font-size:1px;color:#F4F6FA;line-height:1px;max-height:0;max-width:0;overflow:hidden;">
    {when} 자동 검증 결과 — 변경 {n}건 감지 ({total or '—'}곳 검증)
  </div>

  <table role="presentation" style="width:100%;border-collapse:collapse;background:#F4F6FA;">
    <tr>
      <td style="padding:24px 16px;">
        <table role="presentation" style="max-width:600px;width:100%;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(31,45,77,.06);border-collapse:collapse;">

          <!-- 헤더 -->
          <tr>
            <td style="background:{accent_color};color:white;padding:24px 28px;">
              <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:700;">
                타지역서비스 · {trigger_label}
              </div>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;line-height:1.35;color:white;">
                {_html_escape(name)}님,<br>
                변경 {n}건이 감지되었습니다
              </h1>
              <div style="margin-top:10px;font-size:13px;color:rgba(255,255,255,.75);">
                {when}
              </div>
              <div style="margin-top:14px;">{severity_badges_html}</div>
            </td>
          </tr>

          {summary_card_html}

          <!-- 변경 상세 헤더 -->
          <tr>
            <td style="padding:8px 28px 4px 28px;">
              <div style="font-size:12px;font-weight:700;color:#6B7280;letter-spacing:.04em;text-transform:uppercase;">
                변경 상세 · {n}건
              </div>
            </td>
          </tr>

          <!-- 변경 상세 행 -->
          <tr>
            <td style="padding:8px 28px 16px 28px;">
              <table role="presentation" style="width:100%;border-collapse:collapse;">
                {''.join(rows_html)}
              </table>
            </td>
          </tr>

          <!-- CTA 버튼 -->
          <tr>
            <td style="padding:8px 28px 28px 28px;text-align:center;">
              <table role="presentation" style="margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td style="background:#1F2D4D;border-radius:10px;">
                    <a href="{_HISTORY_URL}" target="_blank"
                       style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;letter-spacing:.01em;">
                      대시보드에서 자세히 보기 →
                    </a>
                  </td>
                </tr>
              </table>
              <div style="margin-top:14px;font-size:12px;color:#9CA3AF;">
                <a href="{_MONITOR_URL}" style="color:#6B7280;text-decoration:underline;">지금 다시 검증하기</a>
              </div>
            </td>
          </tr>

          <!-- 푸터 -->
          <tr>
            <td style="padding:18px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
              <div style="font-size:12px;color:#6B7280;line-height:1.6;text-align:center;">
                자동 검증은 매일 정해진 시각에 실행됩니다.<br>
                이 알림이 불필요하면 <a href="{_SITE_URL}/settings" style="color:#1F2D4D;text-decoration:underline;font-weight:600;">설정</a>에서 끌 수 있습니다.
              </div>
              <div style="margin-top:12px;font-size:11px;color:#9CA3AF;text-align:center;">
                © 2026 타지역서비스네이버노출솔루션 · <a href="{_SITE_URL}" style="color:#9CA3AF;text-decoration:none;">taziyuk.com</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _kpi_cell(label: str, value: str, color: str) -> str:
    """회차 요약 KPI 셀 (4분할)."""
    return f"""
    <td style="width:25%;padding:12px 6px;background:#F9FAFB;border-radius:8px;text-align:center;">
      <div style="font-size:10px;font-weight:700;color:#6B7280;letter-spacing:.04em;text-transform:uppercase;">{label}</div>
      <div style="margin-top:4px;font-size:22px;font-weight:800;color:{color};line-height:1;">{value}</div>
    </td>"""


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
