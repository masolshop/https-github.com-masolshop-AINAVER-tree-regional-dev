#!/usr/bin/env bash
# 타지역 순위 자동체크 — systemd 유닛 설치 스크립트
#
# 현재 정책: 자동 timer 는 비활성. 운영자가 수동(또는 관리자 API)으로
#           매일 자동체크를 트리거한다. 본 스크립트는 유닛 파일만 배포하고
#           타이머는 enable 하지 않는다.
#
# 사용:
#   sudo bash /opt/regionwatch/regional-monitor/scripts/rank-tracker/install.sh
#
# 수동 1회 실행:
#   sudo systemctl start regionwatch-rank-tracker.service
#
# 관리자 API 트리거 (백그라운드 실행):
#   POST /api/v1/rank-tracker/run-rank-check  (superadmin 인증 필요)
#
# 향후 자동 배치를 재활성화하려면:
#   sudo systemctl enable --now regionwatch-rank-tracker.timer
set -euo pipefail

SRC_DIR="/opt/regionwatch/regional-monitor/scripts/rank-tracker/systemd"
SYSTEMD_DIR="/etc/systemd/system"

echo "[1/4] copying unit files..."
cp "${SRC_DIR}/regionwatch-rank-tracker.service" "${SYSTEMD_DIR}/"
cp "${SRC_DIR}/regionwatch-rank-tracker.timer"   "${SYSTEMD_DIR}/"

echo "[2/4] systemctl daemon-reload..."
systemctl daemon-reload

echo "[3/4] ensuring timer is DISABLED (current policy: manual / daily auto-check via API)..."
# 기존 환경에서 이미 활성 상태였을 수도 있으므로 명시적으로 끈다 (idempotent).
systemctl disable --now regionwatch-rank-tracker.timer 2>/dev/null || true

echo "[4/4] verification..."
systemctl status regionwatch-rank-tracker.timer --no-pager 2>/dev/null || true
echo ""
echo "DONE."
echo "  · service unit installed (manual trigger ready)"
echo "  · timer kept DISABLED — daily auto-check runs via admin API"
echo ""
echo "수동 1회 실행:        sudo systemctl start regionwatch-rank-tracker.service"
echo "관리자 API 트리거:    POST /api/v1/rank-tracker/run-rank-check (superadmin)"
echo "로그 확인:            journalctl -u regionwatch-rank-tracker.service -n 200 --no-pager"
