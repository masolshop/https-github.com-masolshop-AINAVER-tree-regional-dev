# 타지역닷컴 — 성능 측정 리포트 (Day 3)

작성일: 2026-05-02

## 1. 빌드 번들 분석 (Day 1 → Day 3 비교)

| 지표 | Day 1 (직전) | Day 3 (현재) | 변화 |
|---|---|---|---|
| **메인 번들 (index.js)** | 582.46 KB | **369.75 KB** | **-36.5%** |
| 메인 gzip | 154.26 KB | **110.50 KB** | **-28.4%** |
| 500KB 경고 | ⚠️ 발생 | ✅ 사라짐 | - |
| 청크 개수 | 18개 | **22개** | +4개 |

### 청크 구성 (Day 3)

| 청크 | KB | gzip KB | 로드 시점 |
|---|---:|---:|---|
| index (vendor + Home + 공통) | 369.75 | 110.50 | 즉시 |
| xlsx | 424.76 | 141.51 | Discover/Monitor 진입 시 |
| Admin | 115.31 | 26.07 | /admin 진입 시 |
| Monitor | 73.19 | 20.12 | /monitor 진입 시 |
| KeywordLogic (About) | 55.23 | 11.40 | /about/keyword-logic |
| KeywordDna (도구) | 52.06 | 12.15 | /keyword-dna |
| Discover (도구) | 45.55 | 10.13 | /keyword |
| WhatIs (About) | 44.78 | 10.79 | /about/what-is |
| ExposureManagement (About) | 41.84 | 9.40 | /about/exposure-management |
| EssentialCategories (About) | 28.60 | 7.42 | /about/essential-categories |
| Competition (도구) | 23.94 | 6.65 | /competition |
| BulkUpload | 17.92 | 6.00 | Monitor 일괄 등록 시 |
| Intro | 17.81 | 5.64 | /intro |
| _shared (Solutions Layout) | 7.24 | 2.29 | /intro/* 진입 시 |
| KeywordDnaIntro | 4.80 | 2.44 | /intro/keyword-dna |
| KeywordDiscoverIntro | 4.61 | 2.23 | /intro/keyword-discover |
| MonitorIntro | 4.48 | 2.19 | /intro/monitor |
| CompetitionIntro | 4.43 | 2.16 | /intro/competition |
| RelatedLinks | 4.06 | 2.16 | About/Solutions 진입 시 |

### LCP 개선 효과 (이론적 추정)

홈(`/`) 첫 화면 진입 시 다운로드해야 하는 JS:
- **Day 1**: index.js (582 KB / gzip 154 KB)
- **Day 3**: index.js (370 KB / gzip 111 KB) — **약 43 KB 적게 다운로드**

3G 네트워크 (1.6 Mbps) 기준 추정:
- Day 1: 154 KB ÷ 200 KB/s = **약 770 ms**
- Day 3: 111 KB ÷ 200 KB/s = **약 555 ms**
- **다운로드 시간 약 215 ms 단축** → LCP 약 200~300 ms 개선 예상

4G 네트워크 (10 Mbps) 기준 추정:
- Day 1: 154 KB ÷ 1.25 MB/s = 약 123 ms
- Day 3: 111 KB ÷ 1.25 MB/s = 약 89 ms
- **다운로드 시간 약 34 ms 단축**

## 2. PSI(PageSpeed Insights) 수동 측정 가이드

샌드박스 환경의 Chrome 의존성 부재 + PSI API 무료 일일 한도 초과로 자동 측정 일시 중단. 사장님이 직접 측정하시면 가장 정확합니다.

### 측정 URL (브라우저에서 직접 실행 권장)

```
https://pagespeed.web.dev/analysis?url=https%3A%2F%2Ftaziyuk.com%2F
https://pagespeed.web.dev/analysis?url=https%3A%2F%2Ftaziyuk.com%2Fintro
https://pagespeed.web.dev/analysis?url=https%3A%2F%2Ftaziyuk.com%2Fintro%2Fkeyword-dna
https://pagespeed.web.dev/analysis?url=https%3A%2F%2Ftaziyuk.com%2Fabout%2Fwhat-is
```

각 URL에서 **모바일 / 데스크톱** 두 결과를 모두 확인합니다.

### 자동 측정 (PSI API Key 발급 시)

1. https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com → API 사용 설정
2. 사용자 인증 정보 → API 키 생성 (제한 없음 — IP 한도만 적용)
3. 발급된 키로 사용:
   ```bash
   cd /home/user/webapp/tools
   PSI_API_KEY=YOUR_KEY ./psi-all.sh
   ```

### 목표 지표 (Lighthouse Mobile 기준)

| 지표 | Good | Needs Improvement | Poor |
|---|---|---|---|
| LCP | ≤ 2.5s | 2.5~4.0s | > 4.0s |
| FCP | ≤ 1.8s | 1.8~3.0s | > 3.0s |
| CLS | ≤ 0.1 | 0.1~0.25 | > 0.25 |
| TBT | ≤ 200ms | 200~600ms | > 600ms |
| Performance Score | ≥ 90 | 50~89 | < 50 |

## 3. 추가 개선 후보 (Day 4 이후)

| 항목 | 예상 효과 | 우선순위 |
|---|---|---|
| xlsx 라이브러리 동적 import (424 KB) | -424 KB (Discover/Monitor에서만 로드) | 🔴 높음 |
| og-thumbnail.png 최적화 (현재 1024×510) | LCP 후보 이미지 -50% | 🟡 중간 |
| Pretendard 웹폰트 preload | FCP -100~200ms | 🟡 중간 |
| index.html `<link rel="preconnect">` (CDN) | TLS handshake 단축 | 🟢 낮음 |
| Service Worker 캐싱 | 재방문 시 LCP -90% | 🟢 낮음 (PWA 검토 필요) |
