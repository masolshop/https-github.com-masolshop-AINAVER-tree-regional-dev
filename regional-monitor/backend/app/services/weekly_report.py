"""주간 리포트 메일 — 매주 월요일 09:00 KST 발송.

회원별로 지난 7일(KST) 활동 요약을 계산해 가입 이메일(To) + notify_emails(Cc)
에게 발송한다.

집계 항목:
  · 신규 등록 N건         — registered_places.created_at >= 7일 전
  · 미포함 마킹 M건       — registered_places.in_latest_upload=False AND excluded_at >= 7일 전
  · 변경 노출 K건         — change_events.event_type IN ('DONG_CHANGED','NAME_CHANGED','REGION_CHANGED')
                            AND detected_at >= 7일 전
  · 네이버 미노출 L건      — change_events.event_type IN ('EXPOSURE_LOST','PAGE_DELETED')
                            AND detected_at >= 7일 전
  · 고객요청 변경 P건      — change_events.event_type='USER_OVERRIDE_CHANGED'
                            AND detected_at >= 7일 전

발송 대상:
  · is_active=True
  · is_profile_complete=True
  · email_alerts=True
  · 7일간 활동(N+M+K+L+P)이 0건이면 발송 생략 (스팸 방지)

이 모듈은 SMTP 가 미설정된 환경에서는 콘솔 폴백 로그만 남긴다 (notifier 와 동일).
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from datetime import timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy import select, func as _f
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.time_utils import now_kst
from app.models.user import User
from app.models.place import RegisteredPlace
from app.models.check import ChangeEvent

logger = logging.getLogger("weekly_report")
logger.setLevel(logging.INFO)


SITE_URL = "https://taziyuk.com"


def _collect_recipients(user: User) -> tuple[str, list[str]]:
    """notifier._collect_recipients 와 동일 정책 (To + Cc 추가 수신자)."""
    import re as _re
    to_addr = (user.email or "").strip()
    raw = getattr(user, "notify_emails", None) or ""
    parts = _re.split(r"[,;\n]+", raw) if raw else []
    cc: list[str] = []
    seen: set[str] = {to_addr.lower()} if to_addr else set()
    for p in parts:
        e = p.strip()
        if not e:
            continue
        low = e.lower()
        if low in seen:
            continue
        seen.add(low)
        cc.append(e)
    return to_addr, cc


async def _compute_user_summary(db: AsyncSession, user_id: int) -> dict:
    """회원의 지난 7일 활동 요약을 dict 로 반환."""
    since = now_kst() - timedelta(days=7)

    # 신규 등록
    new_q = await db.execute(
        select(_f.count(RegisteredPlace.id)).where(
            RegisteredPlace.user_id == user_id,
            RegisteredPlace.created_at >= since,
        )
    )
    new_count = int(new_q.scalar_one() or 0)

    # 미포함 마킹 (현재 미포함 + 7일 이내)
    excluded_q = await db.execute(
        select(_f.count(RegisteredPlace.id)).where(
            RegisteredPlace.user_id == user_id,
            RegisteredPlace.in_latest_upload == False,  # noqa: E712
            RegisteredPlace.excluded_at >= since,
        )
    )
    excluded_count = int(excluded_q.scalar_one() or 0)

    # 변경/미노출/고객요청 — change_events 조인 (place_id_ref → registered_places.user_id)
    base_change_q = (
        select(ChangeEvent.event_type, _f.count(ChangeEvent.id))
        .join(RegisteredPlace, RegisteredPlace.id == ChangeEvent.place_id_ref)
        .where(
            RegisteredPlace.user_id == user_id,
            ChangeEvent.detected_at >= since,
        )
        .group_by(ChangeEvent.event_type)
    )
    change_q = await db.execute(base_change_q)
    by_type: dict[str, int] = {row[0]: int(row[1] or 0) for row in change_q.all()}

    changed_exposure = (
        by_type.get("DONG_CHANGED", 0)
        + by_type.get("NAME_CHANGED", 0)
        + by_type.get("REGION_CHANGED", 0)
    )
    dead_exposure = (
        by_type.get("EXPOSURE_LOST", 0)
        + by_type.get("PAGE_DELETED", 0)
    )
    user_override = by_type.get("USER_OVERRIDE_CHANGED", 0)

    # 현재 등록 총수 (참고)
    total_q = await db.execute(
        select(_f.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user_id)
    )
    total = int(total_q.scalar_one() or 0)

    return {
        "new_count": new_count,
        "excluded_count": excluded_count,
        "changed_exposure": changed_exposure,
        "dead_exposure": dead_exposure,
        "user_override": user_override,
        "total": total,
        "activity_total": new_count + excluded_count + changed_exposure + dead_exposure + user_override,
    }


def _build_subject(s: dict) -> str:
    return (
        f"[타지역서비스] 주간 리포트 — 신규 {s['new_count']} / "
        f"미노출 {s['dead_exposure']} / 변경 {s['changed_exposure']} / "
        f"미포함 {s['excluded_count']}건"
    )


def _build_body_text(user: User, s: dict, since_str: str) -> str:
    return (
        f"안녕하세요, {user.name or user.email} 님.\n\n"
        f"타지역서비스 주간 리포트 (지난 7일 / KST 기준 {since_str} 이후)\n"
        f"───────────────────────────────────────\n"
        f"  · 신규 등록 070       : {s['new_count']}건\n"
        f"  · 미포함 번호 마킹     : {s['excluded_count']}건  (엑셀 재업로드 시 빠진 번호)\n"
        f"  · 변경 노출 발생       : {s['changed_exposure']}건  (동/상호/지역 변경)\n"
        f"  · 네이버 미노출 발생   : {s['dead_exposure']}건  (페이지 삭제/노출 상실)\n"
        f"  · 고객요청 변경 반영   : {s['user_override']}건  (엑셀 재업로드로 동/상호 갱신)\n"
        f"  · 현재 총 등록         : {s['total']}건\n"
        f"───────────────────────────────────────\n\n"
        f"대시보드: {SITE_URL}/monitor\n"
        f"알림 설정: {SITE_URL}/monitor?tab=settings\n\n"
        f"본 메일은 영업관리자/고객 담당자 추가 수신자(notify_emails)에게도 Cc 로 발송됩니다.\n"
        f"수신을 원치 않으시면 알림 설정에서 이메일 알림을 해제하실 수 있습니다.\n"
    )


def _build_body_html(user: User, s: dict, since_str: str) -> str:
    name = user.name or user.email
    return f"""<!DOCTYPE html>
<html><body style="font-family:-apple-system,'Segoe UI',sans-serif;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto;padding:20px;">
  <h2 style="color:#3b82f6;margin-bottom:6px;">📊 타지역서비스 주간 리포트</h2>
  <p style="color:#6b7280;margin-top:0;">지난 7일 활동 요약 · KST 기준 {since_str} 이후</p>
  <p>안녕하세요, <strong>{name}</strong> 님.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px 12px;background:#f3f4f6;border-radius:8px;">신규 등록 070</td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#10b981;">{s['new_count']}건</td></tr>
    <tr><td style="padding:8px 12px;">미포함 번호 마킹 <span style="color:#9ca3af;font-size:12px;">(엑셀 재업로드 시 빠진 번호)</span></td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#6b7280;">{s['excluded_count']}건</td></tr>
    <tr><td style="padding:8px 12px;background:#fef3c7;border-radius:8px;">변경 노출 발생 <span style="color:#9ca3af;font-size:12px;">(동/상호/지역 변경)</span></td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#d97706;">{s['changed_exposure']}건</td></tr>
    <tr><td style="padding:8px 12px;background:#fee2e2;border-radius:8px;">네이버 미노출 발생 <span style="color:#9ca3af;font-size:12px;">(페이지 삭제/노출 상실)</span></td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#dc2626;">{s['dead_exposure']}건</td></tr>
    <tr><td style="padding:8px 12px;">고객요청 변경 반영 <span style="color:#9ca3af;font-size:12px;">(엑셀 재업로드로 동/상호 갱신)</span></td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#3b82f6;">{s['user_override']}건</td></tr>
    <tr><td style="padding:8px 12px;border-top:1px solid #e5e7eb;">현재 총 등록</td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;border-top:1px solid #e5e7eb;">{s['total']}건</td></tr>
  </table>
  <p style="margin-top:24px;">
    <a href="{SITE_URL}/monitor" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:white;text-decoration:none;border-radius:8px;font-weight:600;">대시보드 열기</a>
    &nbsp;
    <a href="{SITE_URL}/monitor?tab=settings" style="color:#6b7280;font-size:13px;">알림 설정</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;">
    본 메일은 영업관리자/고객 담당자 추가 수신자(notify_emails)에게도 Cc 로 발송됩니다.
    수신을 원치 않으시면 알림 설정에서 이메일 알림을 해제하실 수 있습니다.
  </p>
</body></html>"""


def _send_weekly_email_sync(user: User, summary: dict) -> bool:
    """동기 SMTP 발송 (notifier._send_email 와 동일 패턴)."""
    to_addr, cc_addrs = _collect_recipients(user)
    if not to_addr:
        logger.info("[weekly_report] skip user_id=%s — no email", user.id)
        return False

    since_str = (now_kst() - timedelta(days=7)).strftime("%Y-%m-%d")

    smtp_host = getattr(settings, "SMTP_HOST", "") or ""
    if not smtp_host:
        # 콘솔 폴백
        logger.info(
            "[EMAIL weekly fallback] to=%s cc=%s subject=%s body=\n%s",
            to_addr, ",".join(cc_addrs) if cc_addrs else "-",
            _build_subject(summary),
            _build_body_text(user, summary, since_str),
        )
        return True

    smtp_port = int(getattr(settings, "SMTP_PORT", 587) or 587)
    smtp_user = getattr(settings, "SMTP_USER", "") or ""
    smtp_pass = getattr(settings, "SMTP_PASSWORD", "") or ""
    sender = getattr(settings, "SMTP_FROM", smtp_user) or "no-reply@regionwatch.kr"
    sender_name = getattr(settings, "SMTP_FROM_NAME", "타지역서비스")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = _build_subject(summary)
    msg["From"] = f"{sender_name} <{sender}>"
    msg["To"] = to_addr
    if cc_addrs:
        msg["Cc"] = ", ".join(cc_addrs)
    msg.attach(MIMEText(_build_body_text(user, summary, since_str), "plain", "utf-8"))
    msg.attach(MIMEText(_build_body_html(user, summary, since_str), "html", "utf-8"))

    rcpt = [a for a in ([to_addr] + cc_addrs) if a]

    ctx = ssl.create_default_context()
    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=15) as srv:
                if smtp_user:
                    srv.login(smtp_user, smtp_pass)
                srv.send_message(msg, from_addr=sender, to_addrs=rcpt)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
                srv.ehlo()
                try:
                    srv.starttls(context=ctx)
                    srv.ehlo()
                except smtplib.SMTPException:
                    pass
                if smtp_user:
                    srv.login(smtp_user, smtp_pass)
                srv.send_message(msg, from_addr=sender, to_addrs=rcpt)
        logger.info(
            "[weekly_report] sent user_id=%s to=%s cc=%d activity=%d",
            user.id, to_addr, len(cc_addrs), summary["activity_total"],
        )
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("[weekly_report] SMTP send failed user_id=%s err=%s", user.id, e)
        return False


async def run_weekly_report() -> dict:
    """주간 리포트 작업 — 모든 활성 회원에게 발송.

    Returns:
        {"sent": N, "skipped_no_activity": M, "skipped_disabled": K, "errors": L}
    """
    import asyncio

    sent = 0
    skipped_no_activity = 0
    skipped_disabled = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        users_q = await db.execute(
            select(User).where(
                User.is_active == True,                       # noqa: E712
                User.is_profile_complete == True,             # noqa: E712
                User.email_alerts == True,                    # noqa: E712
            )
        )
        users = list(users_q.scalars().all())

        for user in users:
            try:
                summary = await _compute_user_summary(db, user.id)
                if summary["activity_total"] == 0:
                    skipped_no_activity += 1
                    continue

                # 동기 SMTP 호출은 별도 스레드에서 (이벤트 루프 블록 방지)
                ok = await asyncio.get_running_loop().run_in_executor(
                    None, _send_weekly_email_sync, user, summary,
                )
                if ok:
                    sent += 1
                else:
                    errors += 1
            except Exception as e:  # noqa: BLE001
                errors += 1
                logger.warning(
                    "[weekly_report] user_id=%s failed: %s", user.id, e,
                )

    result = {
        "sent": sent,
        "skipped_no_activity": skipped_no_activity,
        "skipped_disabled": skipped_disabled,
        "errors": errors,
        "total_candidates": len(users) if "users" in locals() else 0,
    }
    logger.info("[weekly_report] completed: %s", result)
    return result
