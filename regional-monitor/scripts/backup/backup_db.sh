#!/usr/bin/env bash
# 타지역서비스 — DB 전체 핫 백업
# 매일 KST 01:00 실행 (systemd timer)
#
# DATABASE_URL 을 자동 감지:
#   · postgresql[+driver]://user:pwd@host:port/dbname  → pg_dump
#   · sqlite[+driver]:///path/to.db                    → sqlite3 .backup
# 산출물:
#   /home/ubuntu/backups/db/db_<DATE>_<TIME>.{sqlite|sql}.gz
# 7일 초과 자동 삭제. S3 업로드 (BACKUP_S3_ENABLED=true).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/regionwatch/regional-monitor}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
BACKUP_DIR="${BACKUP_ROOT}/db"
LOG_DIR="${BACKUP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/backup_db.log"
RETENTION_DAYS=7

# .env 로드
ENV_FILE="${APP_DIR}/backend/.env"
if [[ -f "${ENV_FILE}" ]]; then
    set -o allexport
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +o allexport
fi

mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" | tee -a "${LOG_FILE}"
}

log "─── DB backup start ───"

DB_URL="${DATABASE_URL:-}"
if [[ -z "${DB_URL}" ]]; then
    log "ERROR: DATABASE_URL not set in .env"
    exit 1
fi

TS=$(date '+%Y-%m-%d_%H%M%S')

# ── DB 종류 감지 ─────────────────────────────────
if [[ "${DB_URL}" == sqlite* ]]; then
    DB_KIND="sqlite"
    # sqlite[+aiosqlite]:///./regional_monitor.db
    # 슬래시 3개 제거 후 경로 추출
    SQLITE_PATH="${DB_URL#*:///}"
    # 상대 경로면 backend 디렉터리 기준으로 풀어준다.
    if [[ "${SQLITE_PATH:0:1}" != "/" ]]; then
        SQLITE_PATH="${APP_DIR}/backend/${SQLITE_PATH#./}"
    fi
    OUT_FILE="${BACKUP_DIR}/db_${TS}.sqlite.gz"
    TMP_DB="${BACKUP_DIR}/db_${TS}.sqlite"

    log "Mode: SQLite — ${SQLITE_PATH}"
    if [[ ! -f "${SQLITE_PATH}" ]]; then
        log "ERROR: SQLite file not found: ${SQLITE_PATH}"
        exit 1
    fi

    log "Step 1: sqlite3 .backup → ${TMP_DB}"
    sqlite3 "${SQLITE_PATH}" ".backup '${TMP_DB}'"

    INTEGRITY=$(sqlite3 "${TMP_DB}" "PRAGMA integrity_check;" 2>&1 || true)
    if [[ "${INTEGRITY}" != "ok" ]]; then
        log "ERROR: integrity_check failed: ${INTEGRITY}"
        rm -f "${TMP_DB}"
        exit 2
    fi
    log "Integrity OK"

    log "Step 2: gzip -9 → ${OUT_FILE}"
    gzip -9 "${TMP_DB}"

elif [[ "${DB_URL}" == postgresql* ]] || [[ "${DB_URL}" == postgres* ]]; then
    DB_KIND="postgres"
    OUT_FILE="${BACKUP_DIR}/db_${TS}.sql.gz"

    # URL parsing — 정규식
    # postgresql[+driver]://user:pass@host:port/dbname[?args]
    URL="${DB_URL}"
    # +driver 제거
    URL="${URL/postgresql+*:\/\//postgresql:\/\/}"
    URL="${URL/postgres+*:\/\//postgres:\/\/}"
    if [[ "${URL}" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):?([0-9]*)/([^?]+) ]]; then
        PG_USER="${BASH_REMATCH[2]}"
        PG_PASS="${BASH_REMATCH[3]}"
        PG_HOST="${BASH_REMATCH[4]}"
        PG_PORT="${BASH_REMATCH[5]:-5432}"
        PG_DB="${BASH_REMATCH[6]}"
    else
        log "ERROR: cannot parse DATABASE_URL: ${URL}"
        exit 3
    fi

    log "Mode: PostgreSQL — ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"
    log "Step 1: pg_dump → ${OUT_FILE}"
    PGPASSWORD="${PG_PASS}" pg_dump \
        -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" \
        --format=plain --no-owner --no-privileges --clean --if-exists \
        "${PG_DB}" 2>>"${LOG_FILE}" | gzip -9 > "${OUT_FILE}"

    if [[ ! -s "${OUT_FILE}" ]]; then
        log "ERROR: pg_dump produced empty file"
        rm -f "${OUT_FILE}"
        exit 4
    fi

    # 무결성 체크: gzip -t
    if ! gzip -t "${OUT_FILE}" 2>>"${LOG_FILE}"; then
        log "ERROR: gzip -t failed"
        exit 5
    fi
    log "gzip integrity OK"
else
    log "ERROR: unsupported DATABASE_URL scheme: ${DB_URL%%:*}"
    exit 1
fi

SIZE=$(du -h "${OUT_FILE}" | awk '{print $1}')
log "Saved: ${OUT_FILE} (${SIZE})"

# ── S3 업로드 (선택) ─────────────────────────────
if [[ "${BACKUP_S3_ENABLED:-false}" == "true" ]] && [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    if command -v aws >/dev/null 2>&1; then
        S3_KEY="db/$(basename "${OUT_FILE}")"
        log "Step 3: aws s3 cp → s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
        if aws s3 cp "${OUT_FILE}" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
            --region "${BACKUP_S3_REGION:-ap-northeast-2}" \
            --no-progress 2>&1 | tee -a "${LOG_FILE}"; then
            log "S3 upload OK"
        else
            log "WARN: S3 upload failed (continuing)"
        fi
    else
        log "WARN: BACKUP_S3_ENABLED=true but 'aws' CLI not installed — skip"
    fi
else
    log "Step 3: S3 upload disabled (set BACKUP_S3_ENABLED=true to activate)"
fi

# ── Google Drive 업로드 (선택, GDRIVE_ENABLED=true) ──────────
if [[ "${GDRIVE_ENABLED:-false}" == "true" ]]; then
    GDRIVE_SCRIPT="${APP_DIR}/scripts/backup/gdrive_upload.py"
    if [[ -f "${GDRIVE_SCRIPT}" ]]; then
        log "Step 3b: Google Drive upload (cat=db)"
        PY_BIN="${APP_DIR}/backend/venv/bin/python"
        [[ ! -x "${PY_BIN}" ]] && PY_BIN="/usr/bin/python3"
        "${PY_BIN}" "${GDRIVE_SCRIPT}" db "${OUT_FILE}" >>"${LOG_FILE}" 2>&1 || \
            log "WARN: gdrive upload returned non-zero (see /home/ubuntu/backups/logs/gdrive_upload.log)"
    else
        log "WARN: GDRIVE_ENABLED=true but ${GDRIVE_SCRIPT} not found"
    fi
fi

# ── 7일 초과 정리 ────────────────────────────────
log "Step 4: removing files older than ${RETENTION_DAYS} days"
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "db_*.sqlite.gz" -o -name "db_*.sql.gz" \) \
    -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log "Removed ${DELETED} old file(s)"

REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "db_*.sqlite.gz" -o -name "db_*.sql.gz" \) | wc -l)
log "Remaining: ${REMAINING} file(s)"

log "─── DB backup completed (mode=${DB_KIND}) ───"
exit 0
