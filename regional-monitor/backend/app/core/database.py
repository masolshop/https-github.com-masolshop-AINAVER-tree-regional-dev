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
    await _ensure_verify_schedule_v2_columns()
    await _ensure_notify_emails_column()
    await _ensure_excluded_upload_columns()
    await _ensure_rank_tracker_columns()
    await _ensure_is_demo_column()


async def _ensure_is_demo_column() -> None:
    """users 테이블에 is_demo BOOLEAN 컬럼 추가 — 외부 공개 데모 게스트 플래그.

    데모 계정만 is_demo=TRUE, 나머지 모든 회원은 FALSE.
    block_if_demo 가드가 이 컬럼으로 mutation/네이버 호출 차단 여부 판정.
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")
    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(users)"))
            existing_cols = {row[1] for row in res.fetchall()}
            if "is_demo" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN is_demo BOOLEAN "
                    "NOT NULL DEFAULT 0"
                ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_is_demo ON users(is_demo)"
            ))
        else:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo "
                "BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_is_demo ON users(is_demo)"
            ))


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


async def _ensure_verify_schedule_v2_columns() -> None:
    """자동 검증 스케줄 v2 — User 테이블 컬럼 추가 + 기존 회원 백필.

    추가 컬럼:
      · verify_frequency  VARCHAR(20)  DEFAULT 'every3d' NOT NULL
      · verify_slot_15m   INTEGER      DEFAULT 0         NOT NULL  (0~95)
      · last_auto_run_at  TIMESTAMP    NULL

    백필(컬럼이 새로 만들어진 경우만 1회):
      · verify_frequency = plan 매핑
          free → every5d / basic → every3d / pro → daily / enterprise → daily
      · verify_slot_15m  = (id × 7919) mod 96   (균등 해시)
      · last_auto_run_at = NULL  (첫 슬롯 도달 시 채워짐)
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(users)"))
            existing_cols = {row[1] for row in res.fetchall()}

            need_backfill = False
            if "verify_frequency" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN verify_frequency VARCHAR(20) "
                    "NOT NULL DEFAULT 'every3d'"
                ))
                need_backfill = True
            if "verify_slot_15m" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN verify_slot_15m INTEGER "
                    "NOT NULL DEFAULT 0"
                ))
                need_backfill = True
            if "last_auto_run_at" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN last_auto_run_at TIMESTAMP"
                ))

            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_verify_frequency "
                "ON users(verify_frequency)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_verify_slot_15m "
                "ON users(verify_slot_15m)"
            ))

            if need_backfill:
                # plan → frequency 매핑
                await conn.execute(text(
                    "UPDATE users SET verify_frequency='every5d' "
                    "WHERE plan='free'"
                ))
                await conn.execute(text(
                    "UPDATE users SET verify_frequency='every3d' "
                    "WHERE plan='basic'"
                ))
                await conn.execute(text(
                    "UPDATE users SET verify_frequency='daily' "
                    "WHERE plan IN ('pro','enterprise')"
                ))
                # 슬롯 균등 해시 — SQLite 도 % 연산자 지원
                await conn.execute(text(
                    "UPDATE users SET verify_slot_15m = (id * 7919) % 96"
                ))
        else:
            # PostgreSQL
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_frequency "
                "VARCHAR(20) NOT NULL DEFAULT 'every3d'"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_slot_15m "
                "INTEGER NOT NULL DEFAULT 0"
            ))
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_auto_run_at "
                "TIMESTAMPTZ"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_verify_frequency "
                "ON users(verify_frequency)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_verify_slot_15m "
                "ON users(verify_slot_15m)"
            ))

            # 백필 — verify_slot_15m 이 모두 0 이면 첫 마이그레이션으로 간주.
            # (이미 분산된 운영 DB 를 덮어쓰지 않음)
            res = await conn.execute(text(
                "SELECT COUNT(*) FROM users WHERE verify_slot_15m <> 0"
            ))
            already_distributed = int(res.scalar() or 0)
            if already_distributed == 0:
                await conn.execute(text(
                    "UPDATE users SET verify_frequency='every5d' "
                    "WHERE plan='free' AND verify_frequency='every3d'"
                ))
                await conn.execute(text(
                    "UPDATE users SET verify_frequency='daily' "
                    "WHERE plan IN ('pro','enterprise') "
                    "AND verify_frequency='every3d'"
                ))
                # basic 은 default('every3d') 그대로 유지
                # 균등 해시 — PostgreSQL 은 mod() 함수 사용 (text() 안에서
                # %% 이스케이프가 asyncpg 드라이버와 호환되지 않음)
                await conn.execute(text(
                    "UPDATE users SET verify_slot_15m = mod(id * 7919, 96) "
                    "WHERE verify_slot_15m = 0"
                ))

            # 슈퍼어드민은 자동 검증 대상에서 영구 제외 — 매 부팅 시 강제 동기화.
            # (운영 중 누군가 수동으로 frequency 를 바꿔도 다음 부팅에 자동 복구)
            await conn.execute(text(
                "UPDATE users SET verify_frequency='paused' "
                "WHERE is_superadmin=true AND verify_frequency<>'paused'"
            ))


async def _ensure_notify_emails_column() -> None:
    """users 에 notify_emails (TEXT) 컬럼 추가 — 알림 추가 수신자 콤마 목록.

    예: "manager@example.com, sales@example.com"
    이메일 알림은 user.email (가입 이메일) + notify_emails 모두에게 발송된다.
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(users)"))
            existing_cols = {row[1] for row in res.fetchall()}
            if "notify_emails" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN notify_emails TEXT"
                ))
        else:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_emails TEXT"
            ))


async def _ensure_excluded_upload_columns() -> None:
    """registered_places 에 미포함 번호(Excluded number) 추적 컬럼 추가.

    · in_latest_upload (BOOLEAN, default TRUE)
        - 마지막 엑셀 업로드에 포함돼 있는지 여부.
    · excluded_at (TIMESTAMP, nullable)
        - 미포함 상태로 전환된 시각.

    재업로드 시 빠진 번호는 자동 삭제하지 않고 in_latest_upload=FALSE,
    excluded_at=NOW() 로 마킹 → UI 에서 "미포함 번호" 뱃지 표시 → 수동 삭제.
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(registered_places)"))
            existing_cols = {row[1] for row in res.fetchall()}
            if "in_latest_upload" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN in_latest_upload "
                    "BOOLEAN NOT NULL DEFAULT 1"
                ))
            if "excluded_at" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN excluded_at TIMESTAMP"
                ))
            # 인덱스
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_in_latest "
                "ON registered_places(user_id, in_latest_upload)"
            ))
        else:
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS in_latest_upload "
                "BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS excluded_at "
                "TIMESTAMP"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_in_latest "
                "ON registered_places(user_id, in_latest_upload)"
            ))


async def _ensure_excluded_upload_columns() -> None:
    """registered_places 에 미포함 번호 추적용 컬럼 추가.

    · in_latest_upload BOOLEAN  — 최근 업로드 엑셀에 포함됐는지 (기본 True)
    · excluded_at      TIMESTAMP — 미포함 처리된 시각 (NULL=현재 포함)

    재업로드 시:
      - 엑셀에 있는 번호 → in_latest_upload=True, excluded_at=NULL 로 복귀
      - 엑셀에서 빠진 번호 → in_latest_upload=False, excluded_at=now()
    UI 에서는 미포함 번호에 뱃지/필터/일괄 삭제를 노출.
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(registered_places)"))
            existing_cols = {row[1] for row in res.fetchall()}
            if "in_latest_upload" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN "
                    "in_latest_upload BOOLEAN NOT NULL DEFAULT 1"
                ))
            if "excluded_at" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN excluded_at TIMESTAMP"
                ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_in_latest "
                "ON registered_places(user_id, in_latest_upload)"
            ))
        else:
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "in_latest_upload BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "excluded_at TIMESTAMP"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_in_latest "
                "ON registered_places(user_id, in_latest_upload)"
            ))


async def _ensure_rank_tracker_columns() -> None:
    """RankTracker (솔루션 #5) 마이그레이션.

    registered_places 확장:
      · tracking_keywords TEXT          — 쉼표 구분 키워드 목록
      · match_confidence  INTEGER       — (레거시) 0~100 점수. 070+동 정책에선 100 또는 0만 사용.
      · match_status      VARCHAR(20)   — AUTO_MATCHED / NEEDS_MANUAL / PENDING_MATCH
                                          (레거시 REVIEW_NEEDED, NOT_FOUND, CONFIRMED는 자동 백필)
      · match_candidates  TEXT          — 매칭된 단일 플레이스 JSON
      · matched_at        TIMESTAMP
      · dong_changed      BOOLEAN       — 변경 노출 플래그 (등록동 ≠ 실제 노출동)
      · actual_dong       VARCHAR(120)  — 실제 노출동명 (dong_changed=True일 때만)

    신규 테이블 place_rank_history는 Base.metadata.create_all에서 자동 생성.
    인덱스만 별도 보장.
    """
    from sqlalchemy import text

    is_sqlite = settings.DATABASE_URL.startswith("sqlite")

    async with engine.begin() as conn:
        if is_sqlite:
            res = await conn.execute(text("PRAGMA table_info(registered_places)"))
            existing_cols = {row[1] for row in res.fetchall()}
            if "tracking_keywords" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN tracking_keywords TEXT"
                ))
            if "match_confidence" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN match_confidence INTEGER"
                ))
            if "match_status" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN match_status VARCHAR(20)"
                ))
            if "match_candidates" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN match_candidates TEXT"
                ))
            if "matched_at" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN matched_at TIMESTAMP"
                ))
            # 070+동 정책: 변경 노출 플래그 & 실제 노출동 컬럼 추가
            if "dong_changed" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN dong_changed "
                    "BOOLEAN NOT NULL DEFAULT 0"
                ))
            if "actual_dong" not in existing_cols:
                await conn.execute(text(
                    "ALTER TABLE registered_places ADD COLUMN actual_dong VARCHAR(120)"
                ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_match_status "
                "ON registered_places(user_id, match_status)"
            ))
            # place_rank_history 인덱스 (테이블 자체는 metadata.create_all에서 생성)
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_rank_history_place_date "
                "ON place_rank_history(place_pk, check_date)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_rank_history_keyword_date "
                "ON place_rank_history(keyword, check_date)"
            ))
            # ── 레거시 match_status 백필 (070+동 정책으로 단순화) ──
            # CONFIRMED → AUTO_MATCHED (이미 사용자가 확정한 행은 그대로 유지)
            # REVIEW_NEEDED → NEEDS_MANUAL (점수제 폐기, 사용자 개입 필요분만 보존)
            # NOT_FOUND → NEEDS_MANUAL
            await conn.execute(text(
                "UPDATE registered_places SET match_status = 'AUTO_MATCHED' "
                "WHERE match_status = 'CONFIRMED'"
            ))
            await conn.execute(text(
                "UPDATE registered_places SET match_status = 'NEEDS_MANUAL' "
                "WHERE match_status IN ('REVIEW_NEEDED', 'NOT_FOUND')"
            ))
        else:
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "tracking_keywords TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "match_confidence INTEGER"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "match_status VARCHAR(20)"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "match_candidates TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "matched_at TIMESTAMPTZ"
            ))
            # 070+동 정책: 변경 노출 플래그 & 실제 노출동
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "dong_changed BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            await conn.execute(text(
                "ALTER TABLE registered_places ADD COLUMN IF NOT EXISTS "
                "actual_dong VARCHAR(120)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_match_status "
                "ON registered_places(user_id, match_status)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_rank_history_place_date "
                "ON place_rank_history(place_pk, check_date)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_rank_history_keyword_date "
                "ON place_rank_history(keyword, check_date)"
            ))
            # ── 레거시 match_status 백필 ──
            await conn.execute(text(
                "UPDATE registered_places SET match_status = 'AUTO_MATCHED' "
                "WHERE match_status = 'CONFIRMED'"
            ))
            await conn.execute(text(
                "UPDATE registered_places SET match_status = 'NEEDS_MANUAL' "
                "WHERE match_status IN ('REVIEW_NEEDED', 'NOT_FOUND')"
            ))
