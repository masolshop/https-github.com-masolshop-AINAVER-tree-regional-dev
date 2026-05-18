#!/bin/bash
# ============================================================
# 타지역닷컴 — fail2ban 설치/적용 스크립트
# 사용: sudo bash regional-monitor/deploy/fail2ban/install.sh
# ============================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAIL_SRC="${DEPLOY_DIR}/jail.d-regionwatch.conf"
FILTER_SRC="${DEPLOY_DIR}/filter.d-nginx-limit-req.conf"
JAIL_DST="/etc/fail2ban/jail.d/regionwatch.conf"
FILTER_DST="/etc/fail2ban/filter.d/nginx-limit-req.conf"

echo "=== [1/4] fail2ban 설치 (이미 있으면 스킵) ==="
if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y fail2ban
else
  echo "  → fail2ban already installed: $(fail2ban-client --version | head -1)"
fi

echo "=== [2/4] jail / filter 동기화 ==="
install -m 0644 "${JAIL_SRC}" "${JAIL_DST}"
install -m 0644 "${FILTER_SRC}" "${FILTER_DST}"
echo "  → ${JAIL_DST}"
echo "  → ${FILTER_DST}"

echo "=== [3/4] 설정 검증 ==="
fail2ban-client -t

echo "=== [4/4] fail2ban 재시작 + 상태 확인 ==="
systemctl enable --now fail2ban
systemctl restart fail2ban
sleep 2
fail2ban-client status
echo
fail2ban-client status nginx-limit-req || true
echo
echo "✅ fail2ban 적용 완료"
echo "   · 차단 IP 보기:  sudo fail2ban-client status nginx-limit-req"
echo "   · 수동 ban:      sudo fail2ban-client set nginx-limit-req banip <IP>"
echo "   · 수동 unban:    sudo fail2ban-client set nginx-limit-req unbanip <IP>"
echo "   · 로그 모니터링: sudo tail -f /var/log/fail2ban.log"
