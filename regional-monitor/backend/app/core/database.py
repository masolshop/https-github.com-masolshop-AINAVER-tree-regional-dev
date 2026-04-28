"""SQLAlchemy 비동기 DB 엔진/세션."""
from collections.abc import AsyncGenerator
from sqlalchemy import event
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
    echo=settings.SQL_ECHO,
    future=True,
)


# SQLite 의 경우 FK 제약(특히 ON DELETE CASCADE) 을 사용하려면
# 매 connection 마다 PRAGMA foreign_keys=ON 이 필요하다.
# (PostgreSQL 등에서는 무시된다.)
if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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
    """앱 시작 시 테이블 생성 (첫 실행) + 가벼운 ADD COLUMN 마이그레이션.

    Alembic 도입 전까지는 신규 컬럼을 IF NOT EXISTS 형태로 안전하게 추가한다.
    PostgreSQL 과 SQLite 둘 다 지원.
    """
    # 모든 모델을 import해서 Base.metadata에 등록되도록 한 뒤
    from app import models  # noqa: F401  (등록 트리거)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # ── 컬럼 추가 마이그레이션 (idempotent) ──
    await _ensure_user_account_columns()


async def _ensure_user_account_columns() -> None:
    """users 테이블에 username / reset_token / reset_token_expires_at 컬럼이 없으면 추가.

    - PostgreSQL: ADD COLUMN IF NOT EXISTS 지원
    - SQLite     : information_schema 가 없어 PRAGMA table_info 로 우회
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            # 이미 존재하는 컬럼 목록 조회
            res = await conn.execute(text("PRAGMA table_info(users)"))
            existing_cols = {row[1] for row in res.fetchall()}

            stmts: list[str] = []
            if "username" not in existing_cols:
                stmts.append("ALTER TABLE users ADD COLUMN username VARCHAR(60)")
            if "reset_token" not in existing_cols:
                stmts.append("ALTER TABLE users ADD COLUMN reset_token VARCHAR(120)")
            if "reset_token_expires_at" not in existing_cols:
                # SQLite 는 KSTDateTime 을 TIMESTAMP 로 저장
                stmts.append("ALTER TABLE users ADD COLUMN reset_token_expires_at TIMESTAMP")
            for s in stmts:
                await conn.execute(text(s))
            # SQLite 에서는 UNIQUE 인덱스도 명시적으로 추가
            if "username" not in existing_cols:
                await conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"
                ))
            if "reset_token" not in existing_cols:
                await conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_reset_token ON users(reset_token)"
                ))
        else:
            # PostgreSQL — ADD COLUMN IF NOT EXISTS 사용
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(60)"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(120)"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_reset_token ON users(reset_token)"
            ))
