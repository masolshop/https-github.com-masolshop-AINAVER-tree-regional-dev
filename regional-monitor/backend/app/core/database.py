"""SQLAlchemy 비동기 DB 엔진/세션."""
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    """모든 모델의 베이스 클래스."""
    pass


# 비동기 엔진 (SQLite 또는 PostgreSQL)
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — DB 세션 yield."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """앱 시작 시 테이블 생성 (첫 실행)."""
    # 모든 모델을 import해서 Base.metadata에 등록되도록 한 뒤
    from app import models  # noqa: F401  (등록 트리거)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
