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
# Playwright Chromium 바이너리 + 시스템 deps (이미 설치돼 있으면 즉시 종료).
# (sudo 없이 install-deps 는 실패하지만 이미 깔려있다면 무시 가능)
if ./venv/bin/playwright --version >/dev/null 2>&1; then
  echo "  → playwright detected, ensuring chromium binary…"
  ./venv/bin/playwright install chromium 2>&1 | tail -3 || true
  # install-deps 는 root 권한 필요. 실패해도 (이미 깔린 경우) 무시.
  sudo ./venv/bin/playwright install-deps chromium 2>&1 | tail -3 || true
fi

echo -e "${BLUE}=== [3/5] Frontend build ===${NC}"
cd "$FRONTEND_DIR"
npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -8

echo -e "${BLUE}=== [4/5] Restart backend ===${NC}"
sudo systemctl restart regionwatch-backend.service
sleep 2
sudo systemctl status regionwatch-backend.service --no-pager | head -5

echo -e "${BLUE}=== [5/5] Sync nginx config & reload ===${NC}"
# nginx 설정 파일을 레포의 deploy/nginx-regionwatch.conf 와 동기화
NGINX_SRC="$REPO_DIR/regional-monitor/deploy/nginx-regionwatch.conf"
NGINX_DST="/etc/nginx/sites-available/regionwatch"
if [ -f "$NGINX_SRC" ]; then
  if ! sudo diff -q "$NGINX_SRC" "$NGINX_DST" >/dev/null 2>&1; then
    echo "  → nginx site config changed, updating $NGINX_DST"
    sudo cp "$NGINX_SRC" "$NGINX_DST"
    # 심볼릭 링크 보장
    [ -L /etc/nginx/sites-enabled/regionwatch ] || sudo ln -sf "$NGINX_DST" /etc/nginx/sites-enabled/regionwatch
    # 기본 default 비활성화 (있을 경우)
    [ -f /etc/nginx/sites-enabled/default ] && sudo rm -f /etc/nginx/sites-enabled/default
  else
    echo "  → nginx site config unchanged"
  fi
fi

# Rate limit zone 정의 (http 컨텍스트 — conf.d/* 자동 include)
RL_SRC="$REPO_DIR/regional-monitor/deploy/nginx-ratelimit.conf"
RL_DST="/etc/nginx/conf.d/regionwatch-ratelimit.conf"
if [ -f "$RL_SRC" ]; then
  if ! sudo diff -q "$RL_SRC" "$RL_DST" >/dev/null 2>&1; then
    echo "  → nginx rate-limit config changed, updating $RL_DST"
    sudo cp "$RL_SRC" "$RL_DST"
  else
    echo "  → nginx rate-limit config unchanged"
  fi
fi

sudo nginx -t && sudo systemctl reload nginx

echo -e "${GREEN}=== Health check ===${NC}"
curl -s http://127.0.0.1/health && echo
curl -s -o /dev/null -w "Frontend HTTP %{http_code}\n" http://127.0.0.1/

echo -e "${GREEN}✅ 배포 완료${NC}"
echo "URL: http://3.35.58.206/"
