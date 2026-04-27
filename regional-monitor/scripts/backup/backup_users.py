#!/usr/bin/env python3
"""타지역서비스 — 사용자별 데이터 export 스크립트.

매일 KST 01:30 실행 (systemd timer).

각 사용자에 대해 다음 데이터를 하나의 JSON으로 묶어 gzip 압축한 뒤
/home/ubuntu/backups/users/user_<id>_<safe_email>_<YYYY-MM-DD>.json.gz 로 저장한다.

내보내는 테이블:
  - users          (해당 사용자 1행, hashed_password 제외)
  - registered_places  (user_id 일치)
  - daily_health_checks (user 의 place 들; 최근 30일)
  - change_events  (user 의 place 들; 최근 30일)
  - verify_jobs    (user_id 일치)
  - payments       (user_id 일치)

DB 백엔드(SQLite/PostgreSQL)에 무관하게 동작 — 앱의 SQLAlchemy 모델/엔진 재사용.

저장 후 7일 초과 파일 자동 삭제. S3 활성화시 업로드.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ── 경로 설정 ─────────────────────────────────────
APP_DIR = Path(os.environ.get("APP_DIR", "/opt/regionwatch/regional-monitor"))
BACKEND_DIR = APP_DIR / "backend"
BACKUP_ROOT = Path(os.environ.get("BACKUP_ROOT", "/home/ubuntu/backups"))
USERS_DIR = BACKUP_ROOT / "users"
LOG_DIR = BACKUP_ROOT / "logs"
LOG_FILE = LOG_DIR / "backup_users.log"

RETENTION_DAYS = 7
HEALTH_CHECK_DAYS = 30  # daily_health_checks/change_events 최근 N일만
KST = timezone(timedelta(hours=9))

# 백엔드 모듈을 import 할 수 있도록 sys.path / 작업 디렉터리 설정
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

# .env 로드 (DATABASE_URL 등) — backend/.env 가 우선
ENV_FILE = BACKEND_DIR / ".env"
if ENV_FILE.is_file():
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# ── 로깅 ──────────────────────────────────────────
LOG_DIR.mkdir(parents=True, exist_ok=True)
USERS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("backup_users")
logger.setLevel(logging.INFO)
_fmt = logging.Formatter("[%(asctime)s] %(message)s", "%Y-%m-%d %H:%M:%S %Z")
_fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
_fh.setFormatter(_fmt)
_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(_fmt)
logger.addHandler(_fh)
logger.addHandler(_sh)


def now_kst() -> datetime:
    return datetime.now(KST)


def safe_email(email: str | None) -> str:
    if not email:
        return "unknown"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", email)[:80]


# ── 앱 모델 import — venv 활성화 후 ───────────────
def _import_app():
    """venv 활성화된 환경에서 SQLAlchemy 엔진/모델 import."""
    try:
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
        from sqlalchemy import select, text
    except ImportError:
        logger.error("SQLAlchemy not available — must run in app venv "
                     "(systemd unit ExecStart should use venv python)")
        sys.exit(10)
    return create_async_engine, AsyncSession, select, text


def _row_to_dict(row: Any) -> dict[str, Any]:
    """SQLAlchemy Row → dict (모든 컬럼)."""
    if hasattr(row, "_mapping"):
        return {k: _coerce(v) for k, v in dict(row._mapping).items()}
    return {k: _coerce(v) for k, v in dict(row).items()}


def _coerce(v: Any) -> Any:
    """JSON 직렬화에 안전한 형으로 변환."""
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            import base64
            return {"__b64__": base64.b64encode(v).decode("ascii")}
    return v


async def _async_export_all() -> tuple[int, int, int]:
    """모든 사용자 export. (success, fail, total_bytes) 반환."""
    create_async_engine, AsyncSession, select, text = _import_app()

    db_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./regional_monitor.db")
    logger.info("DB: %s", _redact_password(db_url))

    engine = create_async_engine(db_url, future=True)

    today = now_kst().strftime("%Y-%m-%d")
    # asyncpg + naive timestamp columns: pass a naive datetime in the same
    # local time (KST) the rows were written in. Stripping tzinfo aligns
    # comparison with the existing naive values in the DB.
    cutoff_dt = (now_kst() - timedelta(days=HEALTH_CHECK_DAYS)).replace(tzinfo=None)

    success = 0
    failure = 0
    total_bytes = 0

    async with engine.connect() as conn:
        # 사용자 목록
        users_rows = (await conn.execute(text(
            "SELECT id, email FROM users ORDER BY id"
        ))).fetchall()
        logger.info("Found %d user(s)", len(users_rows))

        for u in users_rows:
            uid = u.id
            email = u.email
            fname = f"user_{uid}_{safe_email(email)}_{today}.json.gz"
            out_path = USERS_DIR / fname
            try:
                data = await _export_one(conn, uid, cutoff_dt, text)
                size = _write_gz_json(out_path, data)
                total_bytes += size
                success += 1
                logger.info(
                    "OK user_id=%d email=%s places=%d events=%d "
                    "checks=%d jobs=%d payments=%d size=%.1fKB",
                    uid, email,
                    data["counts"]["places"],
                    data["counts"]["change_events"],
                    data["counts"]["daily_health_checks"],
                    data["counts"]["verify_jobs"],
                    data["counts"]["payments"],
                    size / 1024,
                )
                _upload_to_s3(out_path, f"users/{fname}")
            except Exception as e:  # noqa: BLE001
                failure += 1
                logger.exception("FAIL user_id=%s email=%s: %s", uid, email, e)

    await engine.dispose()
    return success, failure, total_bytes


async def _export_one(conn, user_id: int, cutoff_dt: datetime, text) -> dict[str, Any]:
    """단일 사용자 데이터 export."""
    # users (1행, hashed_password 제외)
    user_row = (await conn.execute(
        text("SELECT * FROM users WHERE id = :uid"),
        {"uid": user_id},
    )).fetchone()
    if not user_row:
        raise ValueError(f"user not found: {user_id}")
    user = _row_to_dict(user_row)
    user.pop("hashed_password", None)

    # registered_places
    places_rows = (await conn.execute(
        text("SELECT * FROM registered_places WHERE user_id = :uid ORDER BY id"),
        {"uid": user_id},
    )).fetchall()
    places = [_row_to_dict(r) for r in places_rows]
    place_ids = [p["id"] for p in places]

    # daily_health_checks (place 들 + 최근 30일)
    daily_checks: list[dict[str, Any]] = []
    change_events: list[dict[str, Any]] = []
    if place_ids:
        # bind list — SQLAlchemy text() expanding via tuple
        from sqlalchemy import bindparam
        dh_stmt = text(
            "SELECT * FROM daily_health_checks "
            "WHERE place_id_ref IN :pids AND checked_at >= :cut "
            "ORDER BY checked_at DESC"
        ).bindparams(bindparam("pids", expanding=True))
        rows = (await conn.execute(
            dh_stmt, {"pids": place_ids, "cut": cutoff_dt}
        )).fetchall()
        daily_checks = [_row_to_dict(r) for r in rows]

        ce_stmt = text(
            "SELECT * FROM change_events "
            "WHERE place_id_ref IN :pids AND detected_at >= :cut "
            "ORDER BY detected_at DESC"
        ).bindparams(bindparam("pids", expanding=True))
        rows = (await conn.execute(
            ce_stmt, {"pids": place_ids, "cut": cutoff_dt}
        )).fetchall()
        change_events = [_row_to_dict(r) for r in rows]

    # verify_jobs (없을 수 있음)
    verify_jobs = await _safe_select(
        conn, text,
        "SELECT * FROM verify_jobs WHERE user_id = :uid ORDER BY id DESC",
        {"uid": user_id},
    )

    # payments
    payments = await _safe_select(
        conn, text,
        "SELECT * FROM payments WHERE user_id = :uid ORDER BY id DESC",
        {"uid": user_id},
    )

    return {
        "exported_at": now_kst().isoformat(),
        "schema_version": 1,
        "user": user,
        "counts": {
            "places": len(places),
            "daily_health_checks": len(daily_checks),
            "change_events": len(change_events),
            "verify_jobs": len(verify_jobs),
            "payments": len(payments),
        },
        "places": places,
        "daily_health_checks": daily_checks,
        "change_events": change_events,
        "verify_jobs": verify_jobs,
        "payments": payments,
    }


async def _safe_select(conn, text, sql: str, params: dict) -> list[dict[str, Any]]:
    """테이블 부재 등으로 실패시 빈 리스트로 폴백."""
    try:
        rows = (await conn.execute(text(sql), params)).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "no such table" in msg or "does not exist" in msg or "undefined" in msg:
            logger.warning("Table missing, skipping: %s", e)
            return []
        raise


def _redact_password(url: str) -> str:
    """로그용 — DATABASE_URL 의 비밀번호 부분 가린다."""
    return re.sub(r"(://[^:/@]+):([^@]+)@", r"\1:***@", url)


def _write_gz_json(path: Path, data: dict[str, Any]) -> int:
    payload = json.dumps(data, ensure_ascii=False, default=str, indent=2)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(payload.encode("utf-8"))
    return path.stat().st_size


def _upload_to_s3(local_path: Path, key: str) -> bool:
    if os.environ.get("BACKUP_S3_ENABLED", "false").lower() != "true":
        return False
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    region = os.environ.get("BACKUP_S3_REGION", "ap-northeast-2")
    if not bucket:
        logger.warning("BACKUP_S3_ENABLED=true but BACKUP_S3_BUCKET unset — skip")
        return False
    if not shutil.which("aws"):
        logger.warning("BACKUP_S3_ENABLED=true but aws CLI not installed — skip")
        return False
    s3_uri = f"s3://{bucket}/{key}"
    try:
        subprocess.run(
            ["aws", "s3", "cp", str(local_path), s3_uri,
             "--region", region, "--no-progress"],
            check=True, capture_output=True,
        )
        logger.info("S3 upload OK: %s", s3_uri)
        return True
    except subprocess.CalledProcessError as e:
        logger.warning("S3 upload failed: %s",
                       e.stderr.decode(errors="replace") if e.stderr else e)
        return False


def _cleanup_old(directory: Path) -> int:
    cutoff = time.time() - RETENTION_DAYS * 86400
    removed = 0
    for p in directory.glob("user_*.json.gz"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
                removed += 1
        except OSError as e:
            logger.warning("cleanup failed: %s (%s)", p, e)
    return removed


def main() -> int:
    logger.info("─── Per-user export start ───")
    try:
        success, failure, total_bytes = asyncio.run(_async_export_all())
    except Exception as e:  # noqa: BLE001
        logger.exception("export failed: %s", e)
        return 99

    logger.info(
        "Export summary: success=%d fail=%d total_size=%.1fKB",
        success, failure, total_bytes / 1024,
    )

    removed = _cleanup_old(USERS_DIR)
    logger.info("Removed %d old file(s) (>%dd)", removed, RETENTION_DAYS)

    remaining = len(list(USERS_DIR.glob("user_*.json.gz")))
    logger.info("Remaining: %d file(s)", remaining)
    logger.info("─── Per-user export completed ───")
    return 0 if failure == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
