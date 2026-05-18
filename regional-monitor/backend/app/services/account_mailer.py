"""계정 관련 이메일 발송 — 아이디 안내 / 비밀번호 재설정 링크.

notifier.py 의 변경 알림 메일과 같은 SMTP 설정을 사용하되, 본 모듈은 계정 보조용
(아이디 분실, 비밀번호 재설정) 메일에 특화된 깔끔한 템플릿을 제공한다.

설계 원칙:
    - SMTP 미설정 시 콘솔 로그로 폴백 (개발 편의 + 노출 방지)
    - 외부에서 await 으로 호출, 내부 SMTP 송신은 run_in_executor 로 동기 코드 분리
    - 본문 디자인은 변경 알림 메일과 동일한 톤(브랜드 네이비 #1F2D4D)
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings
from app.core.time_utils import now_kst
from app.models.user import User

logger = logging.getLogger("account-mailer")
if logger.level == logging.NOTSET or logger.level > logging.INFO:
    logger.setLevel(logging.INFO)
if not logger.handlers and not logging.getLogger().handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(_h)


_SITE_URL = "https://taziyuk.com"
_BRAND_COLOR = "#1F2D4D"

# 관리자 신규 가입 알림 수신 메일 (요구사항: taziyuknaver@gmail.com)
_ADMIN_NOTIFY_EMAIL = "taziyuknaver@gmail.com"


# ────────────────────────────────────────────────────────────────
#  공개 API
# ────────────────────────────────────────────────────────────────

async def send_username_email(user: User) -> bool:
    """가입 이메일로 아이디(username) 안내 메일 발송."""
    subject = "[타지역서비스] 아이디 찾기 안내"
    text, html = _render_username(user)
    return await asyncio.get_event_loop().run_in_executor(
        None, _send, user.email, subject, text, html,
    )


async def send_password_reset_email(user: User, token: str) -> bool:
    """비밀번호 재설정 링크 메일 발송 (유효 1시간)."""
    subject = "[타지역서비스] 비밀번호 재설정 링크"
    reset_url = f"{_SITE_URL}/reset-password?token={token}"
    text, html = _render_reset(user, reset_url)
    return await asyncio.get_event_loop().run_in_executor(
        None, _send, user.email, subject, text, html,
    )


async def send_admin_signup_notification(user: User, *, source: str = "signup") -> bool:
    """관리자(taziyuknaver@gmail.com) 에게 신규 회원가입 알림 메일 발송.

    Args:
        user   : 방금 가입한 User (id 확보 후 호출).
        source : 'signup'(아이디/비밀번호) | 'google' | 'profile'(Google 추가정보 완료) 등.

    SMTP 미설정 시 콘솔 로그로 폴백. 가입 흐름은 절대 막지 않는다 (호출측 try/except).
    """
    subject = f"[타지역서비스] 신규 회원가입 — {user.name or user.email}"
    text, html = _render_admin_signup(user, source=source)
    return await asyncio.get_event_loop().run_in_executor(
        None, _send, _ADMIN_NOTIFY_EMAIL, subject, text, html,
    )


# ────────────────────────────────────────────────────────────────
#  SMTP 송신 (동기) — notifier 와 동일 흐름
# ────────────────────────────────────────────────────────────────

def _send(to: str, subject: str, text: str, html: str) -> bool:
    smtp_host = getattr(settings, "SMTP_HOST", "") or ""
    if not smtp_host:
        logger.info("[ACCOUNT_MAIL fallback] to=%s subject=%s\n%s", to, subject, text)
        return True

    smtp_port = int(getattr(settings, "SMTP_PORT", 587) or 587)
    smtp_user = getattr(settings, "SMTP_USER", "") or ""
    smtp_pass = getattr(settings, "SMTP_PASSWORD", "") or ""
    sender = getattr(settings, "SMTP_FROM", smtp_user) or "no-reply@regionwatch.kr"
    sender_name = getattr(settings, "SMTP_FROM_NAME", "타지역서비스")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{sender_name} <{sender}>"
    msg["To"] = to
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

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
                pass
            if smtp_user:
                srv.login(smtp_user, smtp_pass)
            srv.send_message(msg)
    return True


# ────────────────────────────────────────────────────────────────
#  본문 템플릿
# ────────────────────────────────────────────────────────────────

def _html_escape(s: str | None) -> str:
    if not s:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _shell(title: str, headline: str, body_html: str) -> str:
    """공통 메일 셸 (헤더/푸터)."""
    when = now_kst().strftime("%Y-%m-%d %H:%M KST")
    return f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{_html_escape(title)}</title></head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'맑은 고딕',sans-serif;color:#1F2D4D;">
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#F4F6FA;">
    <tr><td style="padding:24px 16px;">
      <table role="presentation" style="max-width:560px;width:100%;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(31,45,77,.06);border-collapse:collapse;">
        <tr>
          <td style="background:{_BRAND_COLOR};color:white;padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:700;">타지역서비스 · 계정</div>
            <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;line-height:1.35;color:white;">{_html_escape(headline)}</h1>
            <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,.7);">{when}</div>
          </td>
        </tr>
        <tr><td style="padding:28px;">
          {body_html}
        </td></tr>
        <tr>
          <td style="padding:18px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
            <div style="font-size:12px;color:#6B7280;line-height:1.6;text-align:center;">
              본 메일은 발신 전용입니다. 문의는 <a href="{_SITE_URL}" style="color:{_BRAND_COLOR};text-decoration:underline;font-weight:600;">taziyuk.com</a> 에서 도와드립니다.
            </div>
            <div style="margin-top:10px;font-size:11px;color:#9CA3AF;text-align:center;">
              © 2026 타지역서비스네이버노출솔루션
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _render_username(user: User) -> tuple[str, str]:
    name = user.name or user.email
    raw_username = user.username or ""
    # 신규 정책: username = 휴대폰 digit-only (예: 01012345678).
    # 사용자 친화적으로 010-1234-5678 형태로 표기.
    if raw_username.isdigit() and len(raw_username) == 11 and raw_username.startswith("01"):
        display_id = f"{raw_username[:3]}-{raw_username[3:7]}-{raw_username[7:]}"
    else:
        display_id = raw_username or (user.phone or "(미설정)")

    text = (
        f"{name}님,\n\n"
        f"요청하신 타지역서비스 계정의 아이디(휴대폰 번호)는 다음과 같습니다.\n\n"
        f"  아이디: {display_id}\n\n"
        f"로그인: {_SITE_URL}\n\n"
        f"본인이 요청하지 않았다면 이 메일을 무시해주세요.\n"
        f"— 타지역서비스네이버노출솔루션"
    )

    body_html = f"""
        <p style="margin:0 0 16px;font-size:14px;color:#1F2D4D;line-height:1.6;">
          <b>{_html_escape(name)}</b>님, 요청하신 계정의 아이디(휴대폰 번호)는 아래와 같습니다.
        </p>
        <div style="margin:16px 0;padding:18px 20px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;">
          <div style="font-size:11px;font-weight:700;color:#6B7280;letter-spacing:.06em;text-transform:uppercase;">아이디 (휴대폰 번호)</div>
          <div style="margin-top:6px;font-size:20px;font-weight:800;color:#1F2D4D;font-family:'SF Mono',Consolas,monospace;letter-spacing:.02em;">{_html_escape(display_id)}</div>
        </div>
        <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.6;">
          위 아이디와 비밀번호로 로그인해주세요. 비밀번호가 기억나지 않으면 로그인 화면에서 <b>비밀번호 찾기</b> 를 이용하실 수 있습니다.
        </p>
        <div style="text-align:center;margin:20px 0 4px;">
          <a href="{_SITE_URL}" style="display:inline-block;padding:12px 24px;background:{_BRAND_COLOR};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">로그인하러 가기 →</a>
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;line-height:1.6;text-align:center;">
          본인이 요청하지 않았다면 이 메일을 무시해주세요.
        </p>
    """
    return text, _shell("아이디 찾기", "아이디 안내", body_html)


def _render_reset(user: User, reset_url: str) -> tuple[str, str]:
    name = user.name or user.email

    text = (
        f"{name}님,\n\n"
        f"비밀번호 재설정 요청이 접수되었습니다. 아래 링크에서 1시간 안에 새 비밀번호를 설정해주세요.\n\n"
        f"  {reset_url}\n\n"
        f"본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 변경되지 않습니다.\n\n"
        f"— 타지역서비스네이버노출솔루션"
    )

    body_html = f"""
        <p style="margin:0 0 16px;font-size:14px;color:#1F2D4D;line-height:1.6;">
          <b>{_html_escape(name)}</b>님, 비밀번호 재설정 요청이 접수되었습니다.<br>
          아래 버튼을 눌러 <b>1시간 안에</b> 새 비밀번호를 설정해주세요.
        </p>
        <div style="text-align:center;margin:24px 0;">
          <a href="{_html_escape(reset_url)}" style="display:inline-block;padding:14px 28px;background:{_BRAND_COLOR};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:.01em;">비밀번호 재설정하기 →</a>
        </div>
        <div style="margin:16px 0;padding:14px 16px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;font-size:12px;color:#92400E;line-height:1.6;">
          ⚠️ 이 링크는 발송 시각으로부터 <b>1시간</b> 동안만 유효합니다. 시간이 지나면 다시 요청해주세요.
        </div>
        <p style="margin:0 0 8px;font-size:12px;color:#6B7280;line-height:1.6;">
          버튼이 동작하지 않으면 아래 주소를 복사해 브라우저에 붙여넣으세요.
        </p>
        <div style="padding:10px 12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;font-size:11px;color:#374151;font-family:'SF Mono',Consolas,monospace;word-break:break-all;">
          {_html_escape(reset_url)}
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;line-height:1.6;text-align:center;">
          본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 변경되지 않습니다.
        </p>
    """
    return text, _shell("비밀번호 재설정", "비밀번호 재설정", body_html)


def _render_admin_signup(user: User, *, source: str) -> tuple[str, str]:
    """관리자용 신규 가입 알림 메일 본문."""
    name = user.name or "(이름 미입력)"
    email = user.email or "(이메일 없음)"
    phone = user.phone or "(미입력)"
    company = user.company or "(미입력)"
    job_title = user.job_title or "(미입력)"
    plan = user.plan or "free"
    username = user.username or "(소셜 로그인)"
    user_id = getattr(user, "id", "—")

    source_label = {
        "signup": "아이디/비밀번호",
        "google": "Google 로그인",
        "profile": "Google + 추가정보 완료",
    }.get(source, source)

    when = now_kst().strftime("%Y-%m-%d %H:%M KST")

    text = (
        f"[타지역서비스] 신규 회원가입 알림\n\n"
        f"가입 시각: {when}\n"
        f"가입 경로: {source_label}\n"
        f"\n"
        f"  회원ID    : {user_id}\n"
        f"  이름      : {name}\n"
        f"  이메일    : {email}\n"
        f"  아이디    : {username}\n"
        f"  휴대폰    : {phone}\n"
        f"  회사명    : {company}\n"
        f"  직함      : {job_title}\n"
        f"  플랜      : {plan}\n"
        f"\n"
        f"어드민에서 확인: {_SITE_URL}/admin/users\n"
    )

    rows = [
        ("회원ID", str(user_id)),
        ("이름", name),
        ("이메일", email),
        ("아이디", username),
        ("휴대폰", phone),
        ("회사명", company),
        ("직함", job_title),
        ("플랜", plan),
        ("가입 경로", source_label),
    ]
    rows_html = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;font-weight:600;width:30%;">{_html_escape(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;color:#1F2D4D;font-size:13px;font-weight:600;">{_html_escape(value)}</td>
        </tr>
        """
        for label, value in rows
    )

    body_html = f"""
        <p style="margin:0 0 14px;font-size:14px;color:#1F2D4D;line-height:1.6;">
          새로운 회원이 가입했습니다. 가입 정보는 아래와 같습니다.
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:12px 0 18px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;">
          {rows_html}
        </table>
        <div style="text-align:center;margin:18px 0 4px;">
          <a href="{_SITE_URL}/admin/users" style="display:inline-block;padding:12px 24px;background:{_BRAND_COLOR};color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">어드민 회원 관리 →</a>
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;line-height:1.6;text-align:center;">
          이 메일은 신규 가입 발생 시 슈퍼어드민에게 자동 발송됩니다.
        </p>
    """
    return text, _shell("신규 회원가입", "신규 회원가입 알림", body_html)


__all__ = [
    "send_username_email",
    "send_password_reset_email",
    "send_admin_signup_notification",
]
