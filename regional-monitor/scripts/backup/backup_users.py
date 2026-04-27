#!/usr/bin/env python3
"""타지역서비스 — 사용자별 데이터 export 스크립트.

매일 KST 01:30 실행 (systemd timer).

각 사용자에 대해 다음 데이터를 하나의 JSON으로 묶어 gzip 압축한 뒤
/home/ubuntu/backups/users/user_<id>_<safe_email>_<YYYY-MM-DD>.json.gz 로 저장한다.

내보내는 테이블:
  - users          (해당 사용자 1행, hashed_password 제외)
  - registered_places  (user_id 일치)
  - daily_health_checks (place_id_ref → user 의 place 들; 최근 30일)
  - change_events  (place_id_ref → user 의 place 들; 최근 30일)
  - verify_jobs    (user_id 일치)
  - payments       (user_id 일치)

저장 후 7일 초과 파일 자동 삭제.
S3 활성화시 업로드 (BACKUP_S3_ENABLED=true).
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ── 경로 (환경변수로 오버라이드 가능) ──────────────
APP_DIR = Path(os.environ.get("APP_DIR", "/opt/regionwatch/regional-monitor"))
DB_PATH = Path(os.environ.get("DB_PATH", str(APP_DIR / "backend" / "regional_monitor.db")))
BACKUP_ROOT = Path(os.environ.get("BACKUP_ROOT", "/home/ubuntu/backups"))
USERS_DIR = BACKUP_ROOT / "users"
LOG_DIR = BACKUP_ROOT / "logs"
LOG_FILE = LOG_DIR / "backup_users.log"

RETENTION_DAYS = 7
HEALTH_CHECK_DAYS = 30  # daily_health_checks/change_events 최근 N일만
KST = timezone(timedelta(hours=9))

# .env 로드 (S3 옵션)
ENV_FILE = APP_DIR / "backend" / ".env"
if ENV_FILE.is_file():
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        # 환경에 이미 있으면 덮어쓰지 않음
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
    """이메일을 파일명에 안전한 문자열로 변환."""
    if not email:
        return "unknown"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", email)[:80]


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for k in row.keys():
        v = row[k]
        # 바이트 → base64-ish 문자열은 우리 모델엔 없음. 그대로 직렬화.
        d[k] = v
    return d


def fetch_all(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    try:
        cur = conn.execute(sql, params)
        return [row_to_dict(r) for r in cur.fetchall()]
    except sqlite3.OperationalError as e:
        # 테이블이 아직 마이그레이션되지 않은 경우 등 — 빈 리스트로 폴백
        if "no such table" in str(e).lower():
            logger.warning("Table missing, skipping: %s", e)
            return []
        raise


def fetch_one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict[str, Any] | None:
    cur = conn.execute(sql, params)
    r = cur.fetchone()
    return row_to_dict(r) if r else None


def export_user(conn: sqlite3.Connection, user_id: int) -> dict[str, Any]:
    """단일 사용자에 대한 모든 관련 데이터를 dict 로 반환."""
    user = fetch_one(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
    if not user:
        raise ValueError(f"user not found: id={user_id}")

    # 비밀번호 해시 제거 (안전성) — 모델 변천에 대비해 가능한 컬럼명 모두 제거
    for k in ("hashed_password", "password_hash", "password"):
        user.pop(k, None)

    places = fetch_all(
        conn,
        "SELECT * FROM registered_places WHERE user_id = ? ORDER BY id",
        (user_id,),
    )
    place_ids = [p["id"] for p in places]

    cutoff = (now_kst() - timedelta(days=HEALTH_CHECK_DAYS)).strftime("%Y-%m-%d %H:%M:%S")

    daily_checks: list[dict[str, Any]] = []
    change_events: list[dict[str, Any]] = []
    if place_ids:
        # SQLite IN 절 — placeholder 동적 생성
        placeholders = ",".join("?" * len(place_ids))
        daily_checks = fetch_all(
            conn,
            f"SELECT * FROM daily_health_checks "
            f"WHERE place_id_ref IN ({placeholders}) AND checked_at >= ? "
            f"ORDER BY checked_at DESC",
            tuple(place_ids) + (cutoff,),
        )
        change_events = fetch_all(
            conn,
            f"SELECT * FROM change_events "
            f"WHERE place_id_ref IN ({placeholders}) AND detected_at >= ? "
            f"ORDER BY detected_at DESC",
            tuple(place_ids) + (cutoff,),
        )

    verify_jobs = fetch_all(
        conn,
        "SELECT * FROM verify_jobs WHERE user_id = ? ORDER BY id DESC",
        (user_id,),
    )
    payments = fetch_all(
        conn,
        "SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC",
        (user_id,),
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


def write_gz_json(path: Path, data: dict[str, Any]) -> int:
    payload = json.dumps(data, ensure_ascii=False, default=str, indent=2)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(payload.encode("utf-8"))
    return path.stat().st_size


def upload_to_s3(local_path: Path, key: str) -> bool:
    """S3 업로드 (활성화시). 실패해도 백업 자체는 성공으로 간주."""
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
            check=True,
            capture_output=True,
        )
        logger.info("S3 upload OK: %s", s3_uri)
        return True
    except subprocess.CalledProcessError as e:
        logger.warning("S3 upload failed: %s", e.stderr.decode(errors="replace") if e.stderr else e)
        return False


def cleanup_old(directory: Path) -> int:
    """7일 초과 파일 삭제, 삭제 개수 반환."""
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

    if not DB_PATH.is_file():
        logger.error("DB not found: %s", DB_PATH)
        return 1

    today = now_kst().strftime("%Y-%m-%d")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    try:
        users = fetch_all(conn, "SELECT id, email FROM users ORDER BY id")
        logger.info("Found %d user(s)", len(users))

        success = 0
        failure = 0
        total_bytes = 0

        for u in users:
            uid = u["id"]
            email = u["email"]
            fname = f"user_{uid}_{safe_email(email)}_{today}.json.gz"
            out_path = USERS_DIR / fname
            try:
                data = export_user(conn, uid)
                size = write_gz_json(out_path, data)
                total_bytes += size
                success += 1
                logger.info(
                    "OK user_id=%d email=%s places=%d events=%d jobs=%d "
                    "size=%.1fKB",
                    uid, email,
                    data["counts"]["places"],
                    data["counts"]["change_events"],
                    data["counts"]["verify_jobs"],
                    size / 1024,
                )
                # S3
                upload_to_s3(out_path, f"users/{fname}")
            except Exception as e:  # noqa: BLE001
                failure += 1
                logger.exception("FAIL user_id=%d email=%s: %s", uid, email, e)

        logger.info(
            "Export summary: success=%d fail=%d total_size=%.1fKB",
            success, failure, total_bytes / 1024,
        )

        removed = cleanup_old(USERS_DIR)
        logger.info("Removed %d old file(s) (>%dd)", removed, RETENTION_DAYS)

        remaining = len(list(USERS_DIR.glob("user_*.json.gz")))
        logger.info("Remaining: %d file(s)", remaining)

    finally:
        conn.close()

    logger.info("─── Per-user export completed ───")
    return 0 if failure == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
