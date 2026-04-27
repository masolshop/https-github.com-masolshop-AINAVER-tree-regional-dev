"""슈퍼어드민 시드 스크립트.

사용법:
    cd backend
    ./venv/bin/python -m scripts.seed_superadmin

또는 환경변수로 직접 지정:
    SUPERADMIN_EMAIL=ceo@femayeon.com \
    SUPERADMIN_PASSWORD=...                \
    SUPERADMIN_NAME="최고관리자"          \
    ./venv/bin/python -m scripts.seed_superadmin

규칙:
  · 같은 이메일이 이미 있으면 비밀번호만 갱신하고 is_superadmin=True 보장.
  · 없으면 신규 생성 (is_profile_complete=True 로 시드).
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime

from sqlalchemy import select

# 백엔드 모듈 경로 보정 (scripts/ 에서 실행 시)
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.core import init_db, hash_password
from app.core.database import AsyncSessionLocal
from app.models.user import User


# 기본값 — 환경변수가 없을 때만 사용. 운영에서는 반드시 환경변수로 덮어쓸 것.
DEFAULT_EMAIL = os.getenv("SUPERADMIN_EMAIL", "ceo@femayeon.com")
DEFAULT_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "sun3328io$$")
DEFAULT_NAME = os.getenv("SUPERADMIN_NAME", "최고관리자")


async def upsert_superadmin(email: str, password: str, name: str) -> dict:
    await init_db()  # 스키마 자동 생성/보장
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email.lower()))
        u = result.scalar_one_or_none()
        now = datetime.utcnow()

        if u is None:
            u = User(
                email=email.lower(),
                name=name,
                password_hash=hash_password(password),
                is_superadmin=True,
                is_active=True,
                is_profile_complete=True,
                plan="enterprise",
                quota_places=10000,
                phone=None,
                company="(superadmin)",
                agreed_privacy=True,
                agreed_terms=True,
                agreed_marketing=False,
                agreed_at=now,
                verify_slot=0,
                last_login_at=None,
            )
            db.add(u)
            await db.commit()
            await db.refresh(u)
            return {"action": "created", "id": u.id, "email": u.email}

        # 기존 사용자 → 비밀번호 / 권한 / 활성 상태 보장
        u.password_hash = hash_password(password)
        u.is_superadmin = True
        u.is_active = True
        if not u.is_profile_complete:
            u.is_profile_complete = True
            u.agreed_privacy = True
            u.agreed_terms = True
            u.agreed_at = now
        # 플랜은 어드민이라면 enterprise 가 자연스러움 (기존 free 였다면 갱신)
        if u.plan == "free":
            u.plan = "enterprise"
            u.quota_places = 10000
        await db.commit()
        await db.refresh(u)
        return {"action": "updated", "id": u.id, "email": u.email}


def main() -> None:
    email = DEFAULT_EMAIL
    pw = DEFAULT_PASSWORD
    name = DEFAULT_NAME

    if not email or not pw:
        print("ERROR: SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD 가 필요합니다.")
        sys.exit(2)

    result = asyncio.run(upsert_superadmin(email, pw, name))
    print(f"✅ {result['action']}  id={result['id']}  email={result['email']}")
    print(f"   로그인: POST /api/v1/auth/login  body={{'email': '{result['email']}', 'password': '***'}}")


if __name__ == "__main__":
    main()
