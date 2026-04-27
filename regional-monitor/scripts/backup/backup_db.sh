#!/usr/bin/env bash
# 타지역서비스 — DB 전체 핫 백업 (SQLite .backup + gzip)
# 매일 KST 01:00 실행 (systemd timer)
#
# 절차:
#   1. sqlite3 .backup 으로 hot copy (서비스 stop 없이 안전)
#   2. gzip -9 압축
#   3. /home/ubuntu/backups/db/db_<DATE>_<TIME>.sqlite.gz 저장
#   4. 7일 초과 파일 자동 삭제
#   5. (옵션) S3 업로드
set -euo pipefail

# ── 환경 ────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/regionwatch/regional-monitor}"
DB_PATH="${DB_PATH:-${APP_DIR}/backend/regional_monitor.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
BACKUP_DIR="${BACKUP_ROOT}/db"
LOG_DIR="${BACKUP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/backup_db.log"
RETENTION_DAYS=7

# 환경 변수 로드 (S3 등)
ENV_FILE="${APP_DIR}/backend/.env"
if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -o allexport
    source "${ENV_FILE}"
    set +o allexport
fi

mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" | tee -a "${LOG_FILE}"
}

log "─── DB backup start ───"

# DB 파일 존재 확인
if [[ ! -f "${DB_PATH}" ]]; then
    log "ERROR: DB file not found: ${DB_PATH}"
    exit 1
fi

# 파일명
TS=$(date '+%Y-%m-%d_%H%M%S')
TMP_DB="${BACKUP_DIR}/db_${TS}.sqlite"
OUT_FILE="${BACKUP_DIR}/db_${TS}.sqlite.gz"

# ── 1) Hot backup ──────────────────────────────
log "Step 1: sqlite3 .backup → ${TMP_DB}"
sqlite3 "${DB_PATH}" ".backup '${TMP_DB}'"

# 무결성 체크
INTEGRITY=$(sqlite3 "${TMP_DB}" "PRAGMA integrity_check;" 2>&1 || true)
if [[ "${INTEGRITY}" != "ok" ]]; then
    log "ERROR: integrity_check failed: ${INTEGRITY}"
    rm -f "${TMP_DB}"
    exit 2
fi
log "Integrity OK"

# ── 2) gzip 압축 ───────────────────────────────
log "Step 2: gzip -9 → ${OUT_FILE}"
gzip -9 "${TMP_DB}"   # produces ${TMP_DB}.gz == ${OUT_FILE}

SIZE=$(du -h "${OUT_FILE}" | awk '{print $1}')
log "Saved: ${OUT_FILE} (${SIZE})"

# ── 3) S3 업로드 (선택) ────────────────────────
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

# ── 4) 7일 초과 파일 정리 ─────────────────────
log "Step 4: removing files older than ${RETENTION_DAYS} days"
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "db_*.sqlite.gz" \
    -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log "Removed ${DELETED} old file(s)"

REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "db_*.sqlite.gz" | wc -l)
log "Remaining: ${REMAINING} file(s)"

log "─── DB backup completed ───"
exit 0
