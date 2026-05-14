"""API 공통 의존성 — 인증 / 쿼터.

인증 우선순위:
  1) Authorization: Bearer <jwt>     ← 운영/실 사용 (Google 로그인 후 발급된 JWT)
  2) X-Dev-User-Email 헤더            ← 개발/테스트용 (DEBUG=True 일 때만)
  3) 둘 다 없으면 401

is_profile_complete=False 인 사용자는 /api/v1/auth/profile 만 접근 가능하도록
require_complete_profile 의존성을 별도로 제공한다.
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db, settings, decode_token, TokenError
from app.models.user import User


# ─────────────────────────── 인증 의존성 ───────────────────────────

async def _get_user_from_jwt(
    authorization: str | None,
    db: AsyncSession,
) -> User | None:
    """Authorization 헤더에서 JWT 추출 → User 조회. 헤더 없거나 실패 시 None."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = decode_token(token)
    except TokenError:
        # 만료/위변조 — 명시적 401 반환을 위해 호출자가 None을 받고 다음 단계에서 401 발생
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _get_or_create_dev_user(
    email: str,
    db: AsyncSession,
) -> User:
    """DEBUG 모드 전용 — 헤더 이메일로 사용자 자동 생성/조회."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(
        email=email,
        name=email.split("@")[0],
        plan="free",
        quota_places=5,
        # dev 사용자는 즉시 사용 가능하도록 프로필 완성 상태로 생성
        phone="010-0000-0000",
        company="(dev)",
        agreed_privacy=True,
        agreed_terms=True,
        is_profile_complete=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user_email: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """현재 로그인 사용자.

    프로필 완성 여부는 검사하지 않으므로 /auth/profile 같이 가입 도중인
    사용자도 통과한다. 등록·검증 등 일반 라우트에서는 require_complete_profile 사용.
    """
    # 1) JWT
    user = await _get_user_from_jwt(authorization, db)
    if user:
        return user

    # 2) DEBUG fallback
    if settings.DEBUG and x_dev_user_email:
        return await _get_or_create_dev_user(x_dev_user_email, db)

    # 3) 인증 실패
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="로그인이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_complete_profile(
    user: User = Depends(get_current_user),
) -> User:
    """추가정보 입력 + 약관 동의를 마친 사용자만 통과.

    아직 가입 2단계가 끝나지 않았다면 409 — 프론트는 추가정보 모달을 띄운다.
    슈퍼어드민은 가입 2단계를 건너뛸 수 있다(관리자 시드 시 미완료일 수 있음).
    """
    if user.is_superadmin:
        return user
    if not user.is_profile_complete:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="추가 정보(휴대폰/회사/약관 동의)가 필요합니다.",
        )
    return user


async def block_if_demo(
    user: User = Depends(get_current_user),
) -> User:
    """데모 게스트 계정 차단 가드.

    `/demo?t=...` 로 접근한 외부 공개 게스트(is_demo=True) 는 모든 mutation
    (POST/PATCH/DELETE) 과 네이버 트래픽 발생 GET 엔드포인트에서 차단된다.
    응답: 403 + 프론트가 파싱할 수 있는 reason='demo_readonly' 헤더 포함.
    """
    if user.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="외부 공개 데모 계정에서는 실제 기능을 사용할 수 없습니다. 회원가입 후 이용해주세요.",
            headers={"X-Demo-Readonly": "1"},
        )
    return user


async def require_superadmin(
    user: User = Depends(get_current_user),
) -> User:
    """슈퍼어드민 권한 검사 — /admin/* 라우트 가드."""
    if not user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 관리자 계정입니다.",
        )
    return user


# ─────────────────────────── 비즈니스 가드 ───────────────────────────

async def require_quota(
    user: User = Depends(require_complete_profile),
    db: AsyncSession = Depends(get_db),
) -> User:
    """현재 등록 수가 plan quota를 초과하지 않는지 확인."""
    from app.models.place import RegisteredPlace
    from sqlalchemy import func

    count = await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user.id)
    )
    n = count.scalar_one()
    if n >= user.quota_places:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"등록 가능한 070 번호 수({user.quota_places}개)를 모두 사용했습니다. "
                f"플랜을 업그레이드하면 더 많이 등록할 수 있습니다."
            ),
        )
    return user


# 기존 코드 호환 (places.py 등이 import 하는 dev 헬퍼)
async def get_or_create_dev_user(
    x_dev_user_email: str = Header(default="dev@regional-monitor.local"),
    x_dev_user_name: str = Header(default="Dev User"),  # noqa: ARG001 — 인터페이스 보존
    db: AsyncSession = Depends(get_db),
) -> User:
    return await _get_or_create_dev_user(x_dev_user_email, db)
