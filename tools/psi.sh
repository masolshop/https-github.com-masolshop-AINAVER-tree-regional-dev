#!/bin/bash
# PageSpeed Insights 측정 스크립트
# 사용: ./psi.sh <url> <strategy(mobile|desktop)> [API_KEY]
URL="${1:-https://taziyuk.com/}"
STRATEGY="${2:-mobile}"
API_KEY="${3:-$PSI_API_KEY}"

ENC_URL=$(printf '%s' "$URL" | jq -sRr @uri)
KEY_PARAM=""
[ -n "$API_KEY" ] && KEY_PARAM="&key=$API_KEY"

API="https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${ENC_URL}&strategy=${STRATEGY}&category=PERFORMANCE&category=SEO&category=ACCESSIBILITY&category=BEST_PRACTICES${KEY_PARAM}"

echo "=== Measuring: $URL ($STRATEGY) ==="
RESULT=$(curl -s "$API")

# 에러 체크
ERR=$(echo "$RESULT" | jq -r '.error.message // empty')
if [ -n "$ERR" ]; then
  echo "❌ ERROR: $ERR"
  exit 1
fi

# 점수
echo "$RESULT" | jq -r '
  .lighthouseResult.categories | to_entries[] |
  "  \(.key | ascii_upcase): \((.value.score * 100 | floor))점"
'

# Core Web Vitals
echo "  --- Core Web Vitals ---"
echo "$RESULT" | jq -r '
  .lighthouseResult.audits |
  "  FCP (First Contentful Paint): \(.["first-contentful-paint"].displayValue // "N/A")
  LCP (Largest Contentful Paint): \(.["largest-contentful-paint"].displayValue // "N/A")
  TBT (Total Blocking Time): \(.["total-blocking-time"].displayValue // "N/A")
  CLS (Cumulative Layout Shift): \(.["cumulative-layout-shift"].displayValue // "N/A")
  Speed Index: \(.["speed-index"].displayValue // "N/A")
  TTI (Time to Interactive): \(.["interactive"].displayValue // "N/A")"
'
