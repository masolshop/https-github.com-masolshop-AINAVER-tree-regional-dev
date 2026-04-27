#!/bin/bash
# RegionWatch — AWS Lightsail 재배포 스크립트
# 사용: ssh ubuntu@3.35.58.206 "bash -s" < deploy.sh
# 또는 서버에서: cd /opt/regionwatch && bash regional-monitor/deploy.sh

set -e

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'

REPO_DIR="/opt/regionwatch"
BACKEND_DIR="$REPO_DIR/regional-monitor/backend"
FRONTEND_DIR="$REPO_DIR/regional-monitor/frontend"

echo -e "${BLUE}=== [1/5] Git pull ===${NC}"
cd "$REPO_DIR"
git fetch origin genspark_ai_developer
git reset --hard origin/genspark_ai_developer

echo -e "${BLUE}=== [2/5] Backend deps update ===${NC}"
cd "$BACKEND_DIR"
./venv/bin/pip install -r requirements.txt --quiet 2>&1 | tail -3

echo -e "${BLUE}=== [3/5] Frontend build ===${NC}"
cd "$FRONTEND_DIR"
npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -8

echo -e "${BLUE}=== [4/5] Restart backend ===${NC}"
sudo systemctl restart regionwatch-backend.service
sleep 2
sudo systemctl status regionwatch-backend.service --no-pager | head -5

echo -e "${BLUE}=== [5/5] Reload nginx ===${NC}"
sudo nginx -t && sudo systemctl reload nginx

echo -e "${GREEN}=== Health check ===${NC}"
curl -s http://127.0.0.1/health && echo
curl -s -o /dev/null -w "Frontend HTTP %{http_code}\n" http://127.0.0.1/

echo -e "${GREEN}✅ 배포 완료${NC}"
echo "URL: http://3.35.58.206/"
