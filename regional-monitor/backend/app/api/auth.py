"""인증 라우터 — /api/v1/auth/*

엔드포인트:
  POST /auth/google    — Google ID 토큰 → 우리 JWT 발급 + User 생성/조회
  POST /auth/profile   — 신규 가입자 추가정보 + 약관 동의 저장
  GET  /auth/me        — 현재 사용자 정보 (JWT 검증)
  POST /auth/logout    — 클라이언트가 토큰 삭제하면 끝 (서버는 200 OK만)

가입 흐름:
  1) 프론트: Google Identity Services로 ID 토큰 획득
  2) 프론트 → POST /auth/google { id_token }
  3) 백엔드: id_token 검증 → User 생성/조회 → JWT 발급
     - is_profile_complete=False 면 needs_profile=True 응답
  4) 프론트: needs_profile=True 면 추가정보 모달 표시
  5) 프론트 → POST /auth/profile { name, phone, company, agreements } + Bearer JWT
  6) 백엔드: 검증 → User 업데이트 (is_profile_complete=True)
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta
from app.core.time_utils import now_kst, to_kst, KST

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import (
    get_db,
    create_access_token,
    verify_google_id_token,
    GoogleAuthError,
    verify_password,
)
from app.core.security import hash_password
from app.models.user import User
from app.models.place import RegisteredPlace
from app.models.check import ChangeEvent, DailyHealthCheck
from app.models.payment import Payment
from app.schemas.auth import (
    GoogleLoginRequest,
    GoogleLoginResponse,
    ProfileCompleteRequest,
    MeResponse,
    UserOut,
    PasswordLoginRequest,
    PasswordLoginResponse,
    SignupRequest,
    SignupResponse,
    ForgotIdRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ResetPasswordVerifyResponse,
    VerifySlotUpdateRequest,
    VerifySlotUpdateResponse,
    MyProfileUpdateRequest,
    MyProfileUpdateResponse,
)
from app.schemas.common import MessageResponse
from .deps import get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])


_PHONE_RE = re.compile(r"^01[016789]-?\d{3,4}-?\d{4}$")
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{4,30}$")
_RESERVED_USERNAMES = {
    "admin", "administrator", "root", "superadmin", "system",
    "support", "help", "info", "noreply", "no-reply", "test",
    "null", "undefined", "anonymous", "guest", "user",
}


def _normalize_phone(raw: str) -> str:
    """01012345678 / 010 1234 5678 → 010-1234-5678 형태로 정규화."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("01"):
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10 and digits.startswith("01"):
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return raw  # validation은 정규식이 이미 통과한 것만 들어옴


def _user_to_out(u: User) -> UserOut:
    return UserOut.model_validate(u, from_attributes=True)


def _issue_token(user: User) -> str:
    return create_access_token(
        sub=str(user.id),
        extra={"email": user.email, "plan": user.plan},
    )


# ─────────────────────────── 비밀번호 로그인 (어드민/직접가입) ───────────────────────────

@router.post("/login", response_model=PasswordLoginResponse)
async def login_with_password(
    body: PasswordLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> PasswordLoginResponse:
    """휴대폰/이메일/아이디 + 비밀번호 로그인.

    body.email 필드에 다음 형태를 모두 허용:
      - 휴대폰 번호 (010-1234-5678 / 01012345678 / 010 1234 5678)
      - 이메일 (you@example.com)
      - 아이디(username) — 직접가입 사용자의 경우 휴대폰 digit-only 가 자동 저장됨

    슈퍼어드민(이메일+비밀번호) 또는 일반 가입자(휴대폰+비밀번호)가 사용.
    Google OAuth 사용자는 password_hash 가 NULL 이라 자동으로 로그인 거부됨.

    실패 시 401 (어느 쪽이 틀렸는지 알려주지 않음 — enumeration 방지).
    차단된(is_active=False) 사용자는 403.
    """
    ident = body.email.strip()
    ident_lower = ident.lower()

    # 휴대폰 번호로 로그인 시도 시: 010-1234-5678 / 01012345678 / 010 1234 5678
    # 모두 동일하게 매칭하기 위해 dash/공백 제거된 digit-only 형태와 정규화된
    # 010-XXXX-XXXX 형태를 모두 후보 식별자로 사용한다.
    digits_only = re.sub(r"\D", "", ident)
    is_phone_like = len(digits_only) in (10, 11) and digits_only.startswith("01")
    phone_normalized: str | None = None
    if is_phone_like:
        phone_normalized = _normalize_phone(ident)

    where_clauses = [
        User.email == ident_lower,
        User.username == ident,        # username 은 대소문자 보존
        User.username == ident_lower,   # 호환: 소문자 입력도 허용
    ]
    if is_phone_like:
        # username 은 가입 시 digit-only(예: 01012345678)로 저장됨
        where_clauses.append(User.username == digits_only)
        # phone 컬럼은 010-XXXX-XXXX 형태로 저장됨
        if phone_normalized:
            where_clauses.append(User.phone == phone_normalized)

    result = await db.execute(select(User).where(or_(*where_clauses)))
    user = result.scalar_one_or_none()

    # 일정 시간 소비 (timing attack 방지) — 사용자 없을 때도 verify_password 호출
    is_valid = verify_password(body.password, user.password_hash if user else None)
    if not user or not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디(휴대폰/이메일) 또는 비밀번호가 올바르지 않습니다.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"차단된 계정입니다. ({user.blocked_reason or '관리자에게 문의하세요'})",
        )

    user.last_login_at = now_kst()
    await db.commit()
    await db.refresh(user)

    return PasswordLoginResponse(
        access_token=_issue_token(user),
        user=_user_to_out(user),
    )


# ─────────────────────────── 1단계: Google 로그인 ───────────────────────────

@router.post("/google", response_model=GoogleLoginResponse)
async def login_with_google(
    body: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> GoogleLoginResponse:
    """Google ID 토큰을 검증하고 우리 서비스 JWT를 발급한다.

    - 신규 사용자: User 자동 생성 (is_profile_complete=False)
    - 기존 사용자: last_login_at 갱신
    응답의 needs_profile=True 면 프론트가 추가정보 모달을 띄워야 한다.
    """
    try:
        claims = verify_google_id_token(body.id_token)
    except GoogleAuthError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Google 로그인 실패: {e}",
        ) from e

    google_sub: str = claims["sub"]
    email: str = claims["email"]
    name: str = claims.get("name") or email.split("@")[0]
    picture: str | None = claims.get("picture")

    # google_sub 우선 매칭, 없으면 email 매칭 (기존 dev 계정 흡수)
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()
    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

    now = now_kst()

    is_new_user = user is None
    if user is None:
        # 신규 가입 — verify_slot 은 placeholder 로 두고, flush 후
        # schedule_assigner.apply_default_schedule 로 plan 매핑·균등 해시 슬롯 배정.
        user = User(
            email=email,
            name=name,
            picture=picture,
            google_sub=google_sub,
            plan="free",
            quota_places=5,
            is_profile_complete=False,
            verify_slot=0,
            verify_slot_15m=0,
            verify_frequency="every5d",  # plan='free' 기본값
            last_login_at=now,
        )
        db.add(user)
        await db.flush()  # id 확보
        from app.services.schedule_assigner import apply_default_schedule
        await apply_default_schedule(db, user, overwrite=True)
    else:
        # 기존 사용자 — Google 정보 보강
        if not user.google_sub:
            user.google_sub = google_sub
        if picture and not user.picture:
            user.picture = picture
        if not user.name or user.name == email.split("@")[0]:
            user.name = name
        user.last_login_at = now

    await db.commit()
    await db.refresh(user)

    # 관리자(taziyuknaver@gmail.com) 신규 가입 알림 — best-effort, 가입 흐름 차단 X
    # Google 가입은 추가정보 미완료 상태이므로 source='google' 1차 알림만,
    # /profile 완료 시 source='profile' 로 다시 발송 (정보 보강).
    if is_new_user:
        try:
            from app.services.account_mailer import send_admin_signup_notification
            await send_admin_signup_notification(user, source="google")
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger("auth").warning(
                "admin signup notify failed user=%s err=%s", user.id, exc,
            )

    return GoogleLoginResponse(
        access_token=_issue_token(user),
        user=_user_to_out(user),
        needs_profile=not user.is_profile_complete,
    )


# ─────────────────────────── 2단계: 추가정보 + 약관 ───────────────────────────

@router.post("/profile", response_model=MeResponse)
async def complete_profile(
    body: ProfileCompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    """신규 가입자 추가정보 등록.

    - 휴대폰/회사명/이름은 필수
    - 개인정보·이용약관 동의는 필수 (둘 중 하나라도 False면 400)
    - 마케팅 동의는 선택
    """
    # 필수 동의 검증
    if not body.agreements.privacy:
        raise HTTPException(400, detail="개인정보 수집·이용 동의는 필수입니다.")
    if not body.agreements.terms:
        raise HTTPException(400, detail="서비스 이용약관 동의는 필수입니다.")

    # 휴대폰 형식 검증
    if not _PHONE_RE.match(body.phone.replace(" ", "")):
        raise HTTPException(
            400, detail="휴대폰 형식이 올바르지 않습니다. 예: 010-1234-5678"
        )

    user.name = body.name.strip()
    user.phone = _normalize_phone(body.phone)
    user.company = body.company.strip()
    user.job_title = (body.job_title or "").strip() or None
    user.agreed_privacy = True
    user.agreed_terms = True
    user.agreed_marketing = body.agreements.marketing
    user.agreed_at = now_kst()
    user.is_profile_complete = True

    await db.commit()
    await db.refresh(user)

    # 관리자(taziyuknaver@gmail.com) 신규 가입 알림 — Google 추가정보 완료 시점.
    # /google 단계의 1차 알림은 정보가 비어 있으므로, 본 시점에 보강 알림을 추가 발송.
    try:
        from app.services.account_mailer import send_admin_signup_notification
        await send_admin_signup_notification(user, source="profile")
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("auth").warning(
            "admin signup notify (profile) failed user=%s err=%s", user.id, exc,
        )

    return MeResponse(user=_user_to_out(user))


# ─────────────────────────── 직접 회원가입 (아이디/비밀번호) ───────────────────────────

@router.post("/signup", response_model=SignupResponse)
async def signup(
    body: SignupRequest,
    db: AsyncSession = Depends(get_db),
) -> SignupResponse:
    """아이디/비밀번호 기반 직접 회원가입.

    필수: username, password, email, name, phone, company, agreements(privacy/terms)
    선택: job_title, agreements.marketing
    """
    # 1) 약관 검증
    if not body.agreements.privacy:
        raise HTTPException(400, detail="개인정보 수집·이용 동의는 필수입니다.")
    if not body.agreements.terms:
        raise HTTPException(400, detail="서비스 이용약관 동의는 필수입니다.")

    # 2) 형식 검증
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(
            400, detail="아이디는 4~30자의 영문/숫자/_/. 만 사용할 수 있습니다."
        )
    if body.username.lower() in _RESERVED_USERNAMES:
        raise HTTPException(400, detail="사용할 수 없는 아이디입니다.")
    if not _PHONE_RE.match(body.phone.replace(" ", "")):
        raise HTTPException(
            400, detail="휴대폰 형식이 올바르지 않습니다. 예: 010-1234-5678"
        )
    if len(body.password) < 8:
        raise HTTPException(400, detail="비밀번호는 8자 이상이어야 합니다.")

    # 3) 중복 검사
    email_lower = body.email.lower().strip()
    dup = await db.execute(
        select(User).where(or_(User.email == email_lower, User.username == body.username))
    )
    existing = dup.scalar_one_or_none()
    if existing:
        if existing.username == body.username:
            raise HTTPException(409, detail="이미 사용 중인 아이디입니다.")
        if existing.email == email_lower:
            raise HTTPException(409, detail="이미 가입된 이메일입니다.")

    # 4) 사용자 생성 — 가입 즉시 is_profile_complete=True (모든 필드를 한 번에 받음)
    #    verify_slot/verify_slot_15m 은 flush 후 schedule_assigner 가 plan 매핑 + 균등 해시로 배정.
    now = now_kst()
    user = User(
        email=email_lower,
        username=body.username,
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        phone=_normalize_phone(body.phone),
        company=body.company.strip(),
        job_title=(body.job_title or "").strip() or None,
        plan="free",
        quota_places=5,
        is_profile_complete=True,
        verify_slot=0,
        verify_slot_15m=0,
        verify_frequency="every5d",  # plan='free' 기본값
        agreed_privacy=True,
        agreed_terms=True,
        agreed_marketing=body.agreements.marketing,
        agreed_at=now,
        last_login_at=now,
    )
    db.add(user)
    await db.flush()  # id 확보
    from app.services.schedule_assigner import apply_default_schedule
    await apply_default_schedule(db, user, overwrite=True)
    await db.commit()
    await db.refresh(user)

    # 관리자(taziyuknaver@gmail.com) 신규 가입 알림 — best-effort, 가입 흐름 차단 X
    try:
        from app.services.account_mailer import send_admin_signup_notification
        await send_admin_signup_notification(user, source="signup")
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("auth").warning(
            "admin signup notify failed user=%s err=%s", user.id, exc,
        )

    return SignupResponse(
        access_token=_issue_token(user),
        user=_user_to_out(user),
    )


# ─────────────────────────── 아이디/비밀번호 찾기 ───────────────────────────

def _mask_email(email: str) -> str:
    """ceo@femayeon.com → ce***@femayeon.com (앞 2자만 노출)."""
    try:
        local, domain = email.split("@", 1)
    except ValueError:
        return email
    if len(local) <= 2:
        return local[0] + "***@" + domain
    return local[:2] + "***@" + domain


def _mask_username(username: str) -> str:
    """abcdefg → ab***fg."""
    if not username:
        return ""
    if len(username) <= 3:
        return username[0] + "***"
    return username[:2] + "***" + username[-1]


@router.post("/forgot-id", response_model=MessageResponse)
async def forgot_id(
    body: ForgotIdRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """가입 시 등록한 이메일로 사용자의 아이디(username)를 발송.

    enumeration 방지를 위해 가입 여부와 무관하게 항상 200을 반환한다.
    실제 발송은 비동기로 best-effort.
    """
    email_lower = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email_lower))
    user = result.scalar_one_or_none()

    # 사용자 정보가 있고 username이 있으면 메일 전송
    if user and user.username:
        try:
            from app.services.account_mailer import send_username_email
            await send_username_email(user)
        except Exception as exc:  # noqa: BLE001
            # 발송 실패해도 응답은 그대로 — 노출 방지.
            import logging
            logging.getLogger("auth").warning("forgot-id mail failed: %s", exc)

    return MessageResponse(
        message="입력하신 이메일로 가입된 계정이 있다면 아이디를 발송했습니다."
    )


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """이메일로 비밀번호 재설정 링크를 발송.

    아이디 또는 이메일 중 하나가 일치하면 가입된 이메일로 발송.
    enumeration 방지를 위해 항상 200 반환.
    """
    if not body.username and not body.email:
        raise HTTPException(400, detail="아이디(휴대폰) 또는 이메일을 입력해주세요.")

    user: User | None = None
    # username 필드는 (1) 옛 영문 아이디 (2) 휴대폰 digit-only (3) 휴대폰 dash 형식
    # 모두 받을 수 있도록 후보를 생성한다.
    if body.username:
        ident = body.username.strip()
        digits_only = re.sub(r"\D", "", ident)
        is_phone_like = len(digits_only) in (10, 11) and digits_only.startswith("01")
        candidates = [
            User.username == ident,
            User.username == ident.lower(),
        ]
        if is_phone_like:
            candidates.append(User.username == digits_only)
            phone_norm = _normalize_phone(ident)
            if phone_norm:
                candidates.append(User.phone == phone_norm)
        # 이메일 형식이면 username 칸으로 들어왔어도 email 매칭
        if "@" in ident:
            candidates.append(User.email == ident.lower())
        result = await db.execute(select(User).where(or_(*candidates)))
        user = result.scalar_one_or_none()
    if user is None and body.email:
        result = await db.execute(
            select(User).where(User.email == body.email.lower().strip())
        )
        user = result.scalar_one_or_none()

    # 직접가입 사용자만 재설정 가능 (Google OAuth 사용자는 password_hash 없음)
    if user and user.password_hash and user.email:
        # 토큰 생성 (32바이트 ≈ 43자 base64url)
        token = secrets.token_urlsafe(32)
        user.reset_token = token
        user.reset_token_expires_at = now_kst() + timedelta(hours=1)
        await db.commit()
        try:
            from app.services.account_mailer import send_password_reset_email
            await send_password_reset_email(user, token)
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger("auth").warning("forgot-password mail failed: %s", exc)

    return MessageResponse(
        message="가입된 계정이 확인되면 이메일로 재설정 링크를 발송했습니다."
    )


@router.get("/reset-password/verify", response_model=ResetPasswordVerifyResponse)
async def verify_reset_token(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> ResetPasswordVerifyResponse:
    """비밀번호 재설정 페이지 진입 시 토큰 사전 검증."""
    if not token or len(token) < 20:
        return ResetPasswordVerifyResponse(valid=False)
    result = await db.execute(select(User).where(User.reset_token == token))
    user = result.scalar_one_or_none()
    if not user or not user.reset_token_expires_at:
        return ResetPasswordVerifyResponse(valid=False)
    if to_kst(user.reset_token_expires_at) < now_kst():
        return ResetPasswordVerifyResponse(valid=False)
    return ResetPasswordVerifyResponse(valid=True, email_masked=_mask_email(user.email))


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """이메일 링크로 받은 토큰을 사용해 비밀번호 재설정."""
    result = await db.execute(select(User).where(User.reset_token == body.token))
    user = result.scalar_one_or_none()
    if not user or not user.reset_token_expires_at:
        raise HTTPException(400, detail="유효하지 않은 링크입니다.")
    if to_kst(user.reset_token_expires_at) < now_kst():
        raise HTTPException(400, detail="링크가 만료되었습니다. 다시 요청해주세요.")
    if len(body.new_password) < 8:
        raise HTTPException(400, detail="비밀번호는 8자 이상이어야 합니다.")

    user.password_hash = hash_password(body.new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    await db.commit()
    return MessageResponse(message="비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.")


# ─────────────────────────── 조회 / 로그아웃 ───────────────────────────

@router.get("/me", response_model=MeResponse)
async def get_me(user: User = Depends(get_current_user)) -> MeResponse:
    """현재 로그인한 사용자 정보."""
    return MeResponse(user=_user_to_out(user))


@router.post("/logout", response_model=MessageResponse)
async def logout(user: User = Depends(get_current_user)) -> MessageResponse:
    """JWT는 stateless 이므로 서버는 별도 처리 없이 200만 반환한다.
    클라이언트가 localStorage 등에서 토큰을 제거하면 로그아웃 완료.
    추후 블랙리스트(Redis) 도입 시 여기에 invalidate 로직 추가.
    """
    return MessageResponse(message=f"logged out: {user.email}")


# ─────────────────────────── 자동 검증 시각 변경 ───────────────────────────

def _calc_next_run_at(slot: int) -> datetime:
    """현재 KST 기준 다음 실행 시각 계산 (slot 시 정각).

    예) 지금 KST 14:30, slot=10 → 내일 KST 10:00
        지금 KST 14:30, slot=18 → 오늘 KST 18:00
    """
    from datetime import timedelta
    now = now_kst()
    target = now.replace(hour=slot, minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return target


@router.patch("/me", response_model=MyProfileUpdateResponse)
async def update_my_profile(
    body: MyProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MyProfileUpdateResponse:
    """로그인 사용자 본인 정보 수정 — 이름/이메일/회사명/직함.

    - 이메일 변경 시 형식 검사 + 다른 사용자와 중복 체크 (409)
    - 회사명/직함 빈 문자열은 null 로 저장
    - 이름은 자동 trim
    - 플랜/quota/슈퍼어드민 권한은 본인이 변경 불가 (어드민 전용)
    """
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise HTTPException(400, "이름은 비울 수 없습니다.")
        user.name = new_name

    if body.email is not None:
        new_email = body.email.strip().lower()
        if not new_email or "@" not in new_email or "." not in new_email.split("@")[-1]:
            raise HTTPException(400, "유효한 이메일 형식이 아닙니다.")
        if new_email != (user.email or "").lower():
            dup = (await db.execute(
                select(User).where(User.email == new_email, User.id != user.id)
            )).scalar_one_or_none()
            if dup:
                raise HTTPException(409, f"이미 사용 중인 이메일입니다: {new_email}")
            user.email = new_email

    if body.company is not None:
        user.company = body.company.strip() or None

    if body.job_title is not None:
        user.job_title = body.job_title.strip() or None

    await db.commit()
    await db.refresh(user)
    return MyProfileUpdateResponse(user=_user_to_out(user))


@router.patch("/me/verify-slot", response_model=VerifySlotUpdateResponse)
async def update_verify_slot(
    body: VerifySlotUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifySlotUpdateResponse:
    """내 자동 검증 시각(0~23시) 변경.

    매일 KST 해당 시각 정각에 내 등록 장소 전체가 자동 검증된다.
    (참고) 시스템 부하 분산을 위해 가입 시 0~23 랜덤 슬롯이 자동 배정되며,
    사용자가 원하는 시간대로 자유롭게 변경 가능.
    """
    user.verify_slot = body.verify_slot
    await db.commit()
    await db.refresh(user)
    next_run = _calc_next_run_at(body.verify_slot)
    return VerifySlotUpdateResponse(
        user=_user_to_out(user),
        next_run_at=next_run,
    )


# ─────────────────────────── 회원 탈퇴 ───────────────────────────

@router.delete("/me", response_model=MessageResponse)
async def delete_my_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """본인 회원 탈퇴 — 등록 070 / 변경 이벤트 / 검증 이력 / 결제 레코드 영구 삭제.

    - 슈퍼어드민은 본인 탈퇴 차단 (lockout 방지) — 어드민 콘솔에서 다른 어드민이 처리.
    - 외래키 cascade 보장이 없어 명시적으로 자식 테이블부터 삭제.
    - 클라이언트는 응답 후 토큰 제거 + 홈으로 이동해야 함.
    """
    if user.is_superadmin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "슈퍼어드민 계정은 본인 탈퇴할 수 없습니다. 다른 어드민에게 요청하세요.",
        )

    from sqlalchemy import delete as sa_delete

    user_id = user.id
    user_email = user.email

    # 1) 등록 장소 → 검증 이력/이벤트 함께 삭제
    place_ids = [
        pid for (pid,) in (await db.execute(
            select(RegisteredPlace.id).where(RegisteredPlace.user_id == user_id)
        )).all()
    ]
    if place_ids:
        await db.execute(sa_delete(DailyHealthCheck).where(DailyHealthCheck.place_id_ref.in_(place_ids)))
        await db.execute(sa_delete(ChangeEvent).where(ChangeEvent.place_id_ref.in_(place_ids)))
        await db.execute(sa_delete(RegisteredPlace).where(RegisteredPlace.id.in_(place_ids)))

    # 2) 결제 레코드
    await db.execute(sa_delete(Payment).where(Payment.user_id == user_id))

    # 3) 사용자 본체
    await db.delete(user)
    await db.commit()

    return MessageResponse(
        message=f"회원 탈퇴가 완료되었습니다. ({user_email}) — 모든 데이터가 영구 삭제되었습니다."
    )
