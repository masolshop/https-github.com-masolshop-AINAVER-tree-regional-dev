#!/usr/bin/env bash
# 타지역서비스 — 코드 전체 스냅샷 (tar.gz)
# 매일 KST 02:00 실행 (systemd timer)
#
# /opt/regionwatch 전체에서 가벼운 노이즈(__pycache__, node_modules, venv,
# .git/objects 등)는 제외하고 압축한다.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/regionwatch/regional-monitor}"
SOURCE_ROOT="${SOURCE_ROOT:-/opt/regionwatch}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/backups}"
BACKUP_DIR="${BACKUP_ROOT}/code"
LOG_DIR="${BACKUP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/backup_code.log"
RETENTION_DAYS=7

# .env 로드 (S3)
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

log "─── Code backup start ───"

if [[ ! -d "${SOURCE_ROOT}" ]]; then
    log "ERROR: source root not found: ${SOURCE_ROOT}"
    exit 1
fi

TS=$(date '+%Y-%m-%d_%H%M%S')
OUT_FILE="${BACKUP_DIR}/code_${TS}.tar.gz"

log "Step 1: tar -czf ${OUT_FILE}"

# 제외 패턴
#  - node_modules / __pycache__ / venv : 재생성 가능, 큼
#  - dist : 빌드 산출물 (재빌드 가능; 그러나 즉시 복원 위해 포함)
#  - *.log / *.sqlite-journal : 임시
#  - .git/objects: 체크아웃 가능 (히스토리는 보존하되 파일들만 제외하지 않음 — 전체 .git 포함하되 hooks 제외)
tar -czf "${OUT_FILE}" \
    --exclude='*/node_modules' \
    --exclude='*/__pycache__' \
    --exclude='*/.pytest_cache' \
    --exclude='*/.mypy_cache' \
    --exclude='*/venv' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='*.log' \
    --exclude='*.sqlite-journal' \
    --exclude='*.sqlite-wal' \
    --exclude='*.sqlite-shm' \
    --exclude='regional_monitor.db' \
    -C "$(dirname "${SOURCE_ROOT}")" \
    "$(basename "${SOURCE_ROOT}")" 2>>"${LOG_FILE}"

SIZE=$(du -h "${OUT_FILE}" | awk '{print $1}')
log "Saved: ${OUT_FILE} (${SIZE})"

# ── S3 업로드 (선택) ──
if [[ "${BACKUP_S3_ENABLED:-false}" == "true" ]] && [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    if command -v aws >/dev/null 2>&1; then
        S3_KEY="code/$(basename "${OUT_FILE}")"
        log "Step 2: aws s3 cp → s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
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
    log "Step 2: S3 upload disabled (set BACKUP_S3_ENABLED=true to activate)"
fi

# ── Google Drive 업로드 (선택, GDRIVE_ENABLED=true) ──
if [[ "${GDRIVE_ENABLED:-false}" == "true" ]]; then
    GDRIVE_SCRIPT="${APP_DIR}/scripts/backup/gdrive_upload.py"
    if [[ -f "${GDRIVE_SCRIPT}" ]]; then
        log "Step 2b: Google Drive upload (cat=code)"
        PY_BIN="${APP_DIR}/backend/venv/bin/python"
        [[ ! -x "${PY_BIN}" ]] && PY_BIN="/usr/bin/python3"
        "${PY_BIN}" "${GDRIVE_SCRIPT}" code "${OUT_FILE}" >>"${LOG_FILE}" 2>&1 || \
            log "WARN: gdrive upload returned non-zero (see logs/gdrive_upload.log)"
    else
        log "WARN: GDRIVE_ENABLED=true but ${GDRIVE_SCRIPT} not found"
    fi
fi

# ── 7일 초과 정리 ──
log "Step 3: removing files older than ${RETENTION_DAYS} days"
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "code_*.tar.gz" \
    -mtime +${RETENTION_DAYS} -print -delete | wc -l)
log "Removed ${DELETED} old file(s)"

REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "code_*.tar.gz" | wc -l)
log "Remaining: ${REMAINING} file(s)"

log "─── Code backup completed ───"
exit 0
