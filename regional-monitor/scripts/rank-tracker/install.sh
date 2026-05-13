#!/usr/bin/env bash
# 타지역 순위 자동체크 — systemd 타이머 설치 스크립트
# 사용:
#   sudo bash /opt/regionwatch/regional-monitor/scripts/rank-tracker/install.sh
set -euo pipefail

SRC_DIR="/opt/regionwatch/regional-monitor/scripts/rank-tracker/systemd"
SYSTEMD_DIR="/etc/systemd/system"

echo "[1/4] copying unit files..."
cp "${SRC_DIR}/regionwatch-rank-tracker.service" "${SYSTEMD_DIR}/"
cp "${SRC_DIR}/regionwatch-rank-tracker.timer"   "${SYSTEMD_DIR}/"

echo "[2/4] systemctl daemon-reload..."
systemctl daemon-reload

echo "[3/4] enable + start timer..."
systemctl enable --now regionwatch-rank-tracker.timer

echo "[4/4] verification..."
systemctl list-timers regionwatch-rank-tracker.timer --no-pager || true
systemctl status regionwatch-rank-tracker.timer --no-pager || true

echo ""
echo "DONE. 수동 1회 실행:  sudo systemctl start regionwatch-rank-tracker.service"
echo "로그 확인:           journalctl -u regionwatch-rank-tracker.service -n 200 --no-pager"
