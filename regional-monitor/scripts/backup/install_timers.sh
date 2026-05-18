#!/usr/bin/env bash
# 타지역서비스 — 백업 systemd 타이머 설치/재설치
# 사용:  sudo bash /opt/regionwatch/regional-monitor/scripts/backup/install_timers.sh
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
    echo "ERROR: must run as root (sudo)"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_SRC="${SCRIPT_DIR}/systemd"
SYSTEMD_DST="/etc/systemd/system"

echo "[1/5] 백업 디렉터리 준비..."
sudo -u ubuntu mkdir -p \
    /home/ubuntu/backups/db \
    /home/ubuntu/backups/users \
    /home/ubuntu/backups/code \
    /home/ubuntu/backups/logs

echo "[2/5] 스크립트 실행 권한..."
chmod +x "${SCRIPT_DIR}/backup_db.sh" "${SCRIPT_DIR}/backup_code.sh"
chmod +x "${SCRIPT_DIR}/backup_users.py"

echo "[3/6] systemd 유닛 복사..."
for f in regionwatch-backup-db.service \
         regionwatch-backup-db.timer \
         regionwatch-backup-users.service \
         regionwatch-backup-users.timer \
         regionwatch-backup-code.service \
         regionwatch-backup-code.timer; do
    cp "${SYSTEMD_SRC}/${f}" "${SYSTEMD_DST}/${f}"
    echo "  ✔ ${f}"
done

echo "[4/6] sudoers 드롭인 설치 (어드민 UI '지금 실행' 버튼용)..."
SUDOERS_SRC="${SCRIPT_DIR}/sudoers.d/regionwatch-backup"
SUDOERS_DST="/etc/sudoers.d/regionwatch-backup"
if [[ -f "${SUDOERS_SRC}" ]]; then
    install -m 0440 -o root -g root "${SUDOERS_SRC}" "${SUDOERS_DST}"
    if visudo -cf "${SUDOERS_DST}" >/dev/null 2>&1; then
        echo "  ✔ ${SUDOERS_DST} (visudo OK)"
    else
        echo "  ✘ ${SUDOERS_DST} 검증 실패 — 제거함"
        rm -f "${SUDOERS_DST}"
    fi
fi

echo "[5/6] systemd reload + enable..."
systemctl daemon-reload
systemctl enable --now \
    regionwatch-backup-db.timer \
    regionwatch-backup-users.timer \
    regionwatch-backup-code.timer

echo "[6/6] 상태 확인..."
systemctl list-timers --all | grep -E "regionwatch|NEXT" | head -10 || true

echo
echo "✅ 설치 완료"
echo
echo "다음 실행 예정:"
systemctl list-timers regionwatch-backup-*.timer --all 2>/dev/null || true
echo
echo "수동 실행 테스트:"
echo "  sudo systemctl start regionwatch-backup-db.service"
echo "  sudo systemctl start regionwatch-backup-users.service"
echo "  sudo systemctl start regionwatch-backup-code.service"
echo
echo "로그 확인:"
echo "  sudo journalctl -u regionwatch-backup-db.service -n 50"
echo "  tail -f /home/ubuntu/backups/logs/backup_*.log"
