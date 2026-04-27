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
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import (
    get_db,
    create_access_token,
    verify_google_id_token,
    GoogleAuthError,
)
from app.models.user import User
from app.schemas.auth import (
    GoogleLoginRequest,
    GoogleLoginResponse,
    ProfileCompleteRequest,
    MeResponse,
    UserOut,
)
from app.schemas.common import MessageResponse
from .deps import get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])


_PHONE_RE = re.compile(r"^01[016789]-?\d{3,4}-?\d{4}$")


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

    now = datetime.utcnow()

    if user is None:
        # 신규 가입
        user = User(
            email=email,
            name=name,
            picture=picture,
            google_sub=google_sub,
            plan="free",
            quota_places=5,
            is_profile_complete=False,
            last_login_at=now,
        )
        db.add(user)
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
    user.agreed_at = datetime.utcnow()
    user.is_profile_complete = True

    await db.commit()
    await db.refresh(user)
    return MeResponse(user=_user_to_out(user))


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
