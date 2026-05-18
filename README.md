# 타지역서비스 실시간 노출 관리 솔루션

> Regional Service Real-Time Exposure Monitoring SaaS  
> 통신사 가상번호(070)의 네이버 플레이스 노출 상태를 매일 자동 검증하고,
> 변경 발견 즉시 알림을 발송하는 SaaS.

---

## 📐 프로젝트 구조

```
/home/user/webapp/
├── regional-monitor/          ← 신규 프로젝트 (현재 진행 중)
│   ├── frontend/              React + Vite + TypeScript + Tailwind
│   └── backend/               FastAPI + SQLAlchemy + APScheduler (예정)
└── (legacy/poc/server_check)  ← .gitignore 처리 (제외)
```

---

## 🎨 디자인 시스템

- **Palette**: Page `#F4F6FA` / Card `#FFFFFF` / Subtle `#ECEFF4`
- **Brand**: Primary `#536FC6` / Deep Navy `#2F3F73`
- **Typography**: Pretendard Variable (Korean) + Inter (English)
- **Cards**: 24~28px radius · soft shadow `0 4px 24px rgba(20,30,60,.08)`
- **워터마크 번호**: 56px · light · `#C9D2E6`

---

## 🛠 기술 스택

| Layer    | Stack                                                                  |
| -------- | ---------------------------------------------------------------------- |
| Frontend | React 19 · Vite 8 · TypeScript · Tailwind CSS v3 · React Router v6 · TanStack Query · Zustand · lucide-react |
| Backend  | FastAPI · SQLAlchemy · APScheduler · httpx (예정)                       |
| Auth     | Google OAuth                                                           |
| DB       | SQLite (dev) → PostgreSQL (prod)                                       |
| Sync     | Google Sheets API (gspread)                                            |

---

## 🗺 사이드바 / 라우트

| Path        | 메뉴                          | 인증 |
| ----------- | ----------------------------- | ---- |
| `/`         | 홈 (대시보드)                 | 공개 |
| `/intro`    | 솔루션 소개                   | 공개 |
| `/monitor`  | 실시간 노출 관리              | 필요 |
| `/history`  | 실시간 노출 관리 이력         | 필요 |

---

## 🚀 개발 진행 상황

- [x] **Step 1** — 디자인 시스템 + 레이아웃 (사이드바 / 상단바 / 4카드 비대칭 그리드)
- [x] **Step 2** — Home 대시보드 (KPI 메트릭 + DATA DRIVEN + 워크플로우) / 솔루션 소개 (페인포인트 + 4중 검증 + 요금제 + FAQ)
- [ ] Step 3 — Google OAuth 로그인 + 라우트 가드 (실 인증 연동)
- [ ] Step 4 — 실시간 노출 관리 UI (3탭: 등록 / 즉시 검증 / 설정)
- [ ] Step 5 — 070 → Place ID 자동 추출 모듈
- [ ] Step 6 — 구글시트 실시간 연동
- [ ] Step 7 — APScheduler 매일 03:00 자동 검증 + 이메일·카톡 알림
- [ ] Step 8 — 이력 페이지 + PDF 보고서

---

## 🏃 로컬 실행

```bash
cd regional-monitor/frontend
npm install
npm run dev   # http://localhost:5173
```
