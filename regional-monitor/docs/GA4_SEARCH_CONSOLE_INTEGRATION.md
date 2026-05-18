# GA4 + Google Search Console 연동 가이드

작성일: 2026-05-02
대상: 타지역닷컴 (https://taziyuk.com)

## 0. 현재 상태

| 항목 | 상태 |
|---|---|
| GA4 Measurement ID | ✅ `G-7HP34KJDR2` (운영 활성) |
| GA4 SPA 자동 page_view | ✅ `useGaPageView` 훅 (App.tsx) |
| Google Search Console 인증 | ✅ `021DO_QtjPGG6sRmyeEHcRK45Hu37vkI8KBYT-e0JvQ` |
| Naver Search Advisor 인증 | ✅ `e3fb823bddc57cd05c76398487d8afe49ad37eaf` |
| sitemap.xml | ✅ 동적 생성 (백엔드 `/api/v1/seo/sitemap.xml`) |
| rss.xml | ✅ 동적 생성 (백엔드 `/api/v1/seo/rss.xml`) |

## 1. GA4 ↔ Search Console 연동 (양방향)

### 왜 연동해야 하는가?

- **GSC 데이터를 GA4에서 보기**: 실제 검색어, 노출수, 클릭수, CTR을 GA4 보고서 안에서 확인
- **GA4 데이터를 GSC에서 보기**: 검색을 통해 들어온 사용자의 행동(체류시간, 전환) 추적
- **Looker Studio 연동 시**: 두 데이터 소스를 하나의 대시보드로 통합 가능

### 연동 절차 (5분)

#### Step 1. GA4 속성 ID 확인
1. https://analytics.google.com 접속
2. 우측 하단 ⚙️ **관리** → **속성 설정**
3. "속성 ID"(예: `123456789`) 메모

#### Step 2. Search Console에서 GA4 연결
1. https://search.google.com/search-console 접속 → `https://taziyuk.com` 속성 선택
2. 좌측 하단 ⚙️ **설정** → **연결**
3. **Google Analytics 연결** → "연결" 클릭
4. GA4 속성 선택 (`G-7HP34KJDR2` 보유 속성) → 확인

#### Step 3. GA4에서 Search Console 연결
1. https://analytics.google.com → 좌측 ⚙️ **관리**
2. 속성 열 → **제품 링크** → **Search Console 링크**
3. **연결** → "계정 선택" → `taziyuk.com` 속성 → 다음
4. 웹 스트림 선택 → 다음 → 제출

#### Step 4. GA4에 Search Console 보고서 게시
1. GA4 좌측 메뉴 → **보고서** → **라이브러리** (가장 아래)
2. **컬렉션 만들기** → "Search Console" 카드 게시(Publish)
3. 좌측 메뉴에 "Search Console" 섹션 등장 → "쿼리", "Google 자연 검색 트래픽" 보고서 사용 가능

## 2. 측정 이벤트 추가 (선택, 매출 분석에 권장)

현재 `src/utils/ga.ts` 의 `trackEvent()` 헬퍼로 다음 이벤트를 추가하면 마케팅 ROI를 계산할 수 있습니다.

```typescript
import { trackEvent } from '@/utils/ga'

// 무료 신청하기 클릭
trackEvent('cta_click', { cta_type: 'free_signup', solution: 'keyword-dna' })

// 키워드 분석 시작
trackEvent('analysis_start', { keyword: '에어컨청소', tab: 'keyword-dna' })

// 070 등록 완료
trackEvent('register_complete', { phone: '070-xxxx-xxxx' })

// 검색 결과 노출 → 클릭(외부 링크)
trackEvent('outbound_click', { url: 'naver.me/...' })
```

### 권장 이벤트 매핑 (4종 솔루션 × 단계별)

| 이벤트 이름 | 발생 위치 | 파라미터 |
|---|---|---|
| `cta_click` | 모든 인트로/About CTA 버튼 | `cta_type`, `page` |
| `solution_enter` | 4종 도구 페이지 첫 진입 | `solution`, `referrer` |
| `analysis_submit` | 키워드 분석/경쟁도/Place 등록 폼 제출 | `solution`, `param_keyword` |
| `analysis_success` | 분석 성공 응답 수신 | `solution`, `result_count`, `latency_ms` |
| `analysis_error` | 분석 에러 발생 | `solution`, `error_code` |
| `auth_login` | 로그인 성공 | `method` (phone/email) |
| `auth_signup` | 회원가입 성공 | `method` |
| `outbound_click` | 네이버 플레이스/지도로 이동 | `url`, `place_id` |

## 3. 측정 검증 (실시간 확인)

### GA4 실시간 보고서
1. https://analytics.google.com → 좌측 **보고서** → **실시간**
2. 다른 탭에서 https://taziyuk.com 접속 → 1~5초 내 카드에 사용자 1명 표시
3. SPA 라우트 이동 (예: `/intro/keyword-dna` 클릭) → 페이지 조회 카드 즉시 갱신

### GSC 인덱스 확인
1. GSC → **URL 검사** 도구
2. `https://taziyuk.com/intro/keyword-dna` 입력 → 인덱싱 상태 확인
3. 미색인 시 **색인 생성 요청** 버튼 클릭 (페이지당 1회/일)

### Naver Search Advisor 검증
1. https://searchadvisor.naver.com → **검증** → **웹 페이지 수집**
2. 4종 솔루션 + 4 About URL 입력 → 수집 요청
3. **검증** → **robots.txt** → 사이트맵 정상 인식 확인

## 4. 추적 KPI 대시보드 (Looker Studio 권장)

### 만들어야 할 대시보드

| 대시보드 | 데이터 소스 | 주요 위젯 |
|---|---|---|
| **유입 분석** | GSC + GA4 | 검색 키워드 TOP 30, CTR, 페이지별 노출수 |
| **솔루션 사용 분석** | GA4 | 4종 도구별 사용자 수·평균 체류·이탈률 |
| **전환 깔때기** | GA4 | `solution_enter → analysis_submit → register_complete` |
| **에러 모니터링** | GA4 | `analysis_error` 이벤트 빈도·트렌드 |
| **검색 가시성** | GSC | 평균 게재순위 변화, 신규 노출 페이지 |

### Looker Studio 시작 방법
1. https://lookerstudio.google.com 접속
2. **만들기** → **보고서** → 데이터 소스 선택
3. **Google Analytics** 커넥터 → 속성 선택
4. **Search Console** 커넥터 추가 → "사이트 노출수" 또는 "URL 노출수" 선택
5. 표·차트 위젯으로 자유롭게 구성

## 5. 자주 발생하는 문제와 해결법

| 증상 | 원인 | 해결 |
|---|---|---|
| GA4에 사용자가 안 보임 | 빌드 시 `VITE_GA_MEASUREMENT_ID` 누락 | `.env.production` 확인 후 재빌드 |
| Search Console 연결 실패 | GSC 속성 소유권 미확인 | GSC 메타태그 인증 다시 확인 |
| 사이트맵에서 일부 URL "발견되지 않음" | 색인 차단된 페이지 | robots.txt + `noindex` 메타 점검 |
| GA4 지표가 GSC와 차이 큼 | GA4는 페이지뷰, GSC는 노출수 (다른 지표) | 정상 동작 — 비교 시 단위 주의 |
| `404 errors`만 GSC에 표시됨 | SPA fallback 미설정 | nginx `try_files $uri /index.html` 확인 |

## 6. 다음 단계 (Day 4 이후)

1. **GA4 사용자 정의 이벤트 추가** (위 § 2 표 참고) — 4종 솔루션 전환 추적
2. **Looker Studio 대시보드 1개** 제작 — 사장님 일일 모니터링용
3. **GSC Performance API 자동 수집** — 매일 검색어 데이터를 DB에 저장하여 트렌드 분석
4. **A/B 테스트 인프라** — 헤드라인/CTA 버튼 효과 측정 (GA4 + Optimize 후속)
