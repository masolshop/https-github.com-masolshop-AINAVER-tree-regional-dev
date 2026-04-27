"""API 공통 의존성.

현재는 dev 모드 — X-Dev-User-Id 헤더로 사용자 식별.
실제 JWT 인증은 Step C (auth router) 에서 추가.
"""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models.user import User


async def get_or_create_dev_user(
    x_dev_user_email: str = Header(default="dev@regional-monitor.local"),
    x_dev_user_name: str = Header(default="Dev User"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """개발 모드: 헤더로 받은 이메일로 사용자 자동 생성/조회.

    Step C 에서 JWT 인증으로 교체 예정.
    """
    result = await db.execute(select(User).where(User.email == x_dev_user_email))
    user = result.scalar_one_or_none()
    if user:
        return user

    # 자동 생성
    user = User(
        email=x_dev_user_email,
        name=x_dev_user_name,
        plan="free",
        quota_places=5,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# JWT 인증을 Step에서 추가하기 전까지 별칭으로 사용
get_current_user = get_or_create_dev_user


async def require_quota(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """현재 등록 수가 quota를 초과하지 않는지 확인."""
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
