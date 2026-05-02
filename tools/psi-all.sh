#!/bin/bash
# 주요 라우트 일괄 측정
KEY="${1:-$PSI_API_KEY}"
URLS=(
  "https://taziyuk.com/"
  "https://taziyuk.com/intro"
  "https://taziyuk.com/intro/keyword-dna"
  "https://taziyuk.com/about/what-is"
)
for u in "${URLS[@]}"; do
  ./psi.sh "$u" mobile "$KEY"
  echo ""
  sleep 2
done
