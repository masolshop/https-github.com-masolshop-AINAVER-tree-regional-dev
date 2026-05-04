# 🤝 AI 채팅 인수인계 문서 (HANDOFF)

> **목적**: AI 채팅이 바뀌어도 새 AI가 즉시 작업을 이어받을 수 있도록 모든 컨텍스트를 한 문서에 정리
> **마지막 업데이트**: 2026-05-04
> **프로젝트**: 페마연 / 타지역서비스 (RegionWatch / regional-monitor)

---

## 0. 새 AI에게 — 가장 먼저 할 일

새 채팅 시작 시 다음 순서로 진행하세요:

```bash
# 1. 작업 디렉터리 확인
cd /home/user/webapp && pwd && ls -la

# 2. 이 인수인계 문서 정독
cat /home/user/webapp/HANDOFF.md

# 3. SSH 키 설치 (사용자가 .pem 파일 첨부 후)
mkdir -p ~/.ssh
cp "/home/user/uploaded_files/LightsailDefaultKey-ap-northeast-2 (22).pem" ~/.ssh/lightsail_seoul.pem
chmod 600 ~/.ssh/lightsail_seoul.pem

# 4. 서버 접속 헬스체크
ssh -i ~/.ssh/lightsail_seoul.pem -o StrictHostKeyChecking=no ubuntu@3.35.58.206 \
  "uptime && curl -sS http://127.0.0.1:8000/health"
```

⚠️ **새 샌드박스에서는 `~/.ssh/lightsail_seoul.pem`이 없을 수 있습니다.** 사용자에게 키 파일 재첨부 요청.

---

## 1. 프로젝트 개요

| 항목 | 값 |
|---|---|
| **프로젝트명** | RegionWatch / 타지역서비스 (페마연) |
| **회사** | 주식회사 페마연 (대표: 이종근, 사업자번호: 266-81-01215) |
| **서비스 URL** | http://3.35.58.206/ (Cloudflare 도메인 경유) |
| **Repo** | https://github.com/masolshop/https-github.com-masolshop-AINAVER-tree-regional-dev |
| **개발 브랜치** | `genspark_ai_developer` |
| **활성 PR** | #1 — https://github.com/masolshop/https-github.com-masolshop-AINAVER-tree-regional-dev/pull/1 |
| **로컬 작업 경로** | `/home/user/webapp` |

### 솔루션 구조
- **Backend**: Python 3.11 + FastAPI + uvicorn + PostgreSQL 14 + asyncpg + apscheduler + slowapi
- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Infra**: AWS Lightsail (Ubuntu 22.04, ap-northeast-2 서울) + Cloudflare + nginx
- **인증**: JWT + Google OAuth + bcrypt (super-admin: `ceo@femayeon.com`)
- **핵심 기능**: 4개 솔루션 (Monitor / Competition / KeywordDiscover / KeywordDna) + Naver 노출 검증 자동화

### 디렉터리 구조 (간략)
```
/home/user/webapp/
├── HANDOFF.md                    # ★ 이 문서
├── README.md
├── deploy/
│   └── aws-lightsail-deploy.md   # 운영 가이드 (※ 앱 경로 정보 outdated)
├── tools/                         # PSI 등 운영 스크립트
├── regional-monitor/              # ★ 메인 솔루션
│   ├── backend/                  # FastAPI
│   │   ├── main.py
│   │   ├── app/
│   │   │   ├── api/             # 라우트
│   │   │   ├── models/          # SQLAlchemy
│   │   │   ├── schemas/         # Pydantic
│   │   │   ├── services/        # 비즈니스 로직
│   │   │   └── core/            # 설정/보안
│   │   ├── requirements.txt
│   │   └── venv/                 # (서버 측에만 존재)
│   ├── frontend/                # React + Vite
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   │   └── layout/
│   │   │   │       └── Sidebar.tsx  # ★ 최근 작업 파일
│   │   │   ├── api/
│   │   │   ├── hooks/
│   │   │   └── ...
│   │   ├── public/
│   │   ├── tailwind.config.js
│   │   └── package.json
│   ├── deploy/cloudflare/        # Cloudflare 연동
│   ├── scripts/backup/           # 자동 백업
│   └── deploy.sh                 # 재배포 스크립트
├── keyword-poc/
└── competition-poc/
```

---

## 2. 🔑 SSH 키 & 서버 접속 정보 (★ 매우 중요 — 새 채팅마다 망각됨)

### SSH 키 파일
- **Genspark 업로드 다운로드 URL**:
  ```
  https://www.genspark.ai/api/files/s/aul1zh6o
  ```
  - 파일명: `LightsailDefaultKey-ap-northeast-2 (22).pem` (1679 bytes, RSA)
  - AWS Lightsail 기본 키페어 (서울 ap-northeast-2)
- **샌드박스 임시 경로** (사용자 첨부 시): `/home/user/uploaded_files/LightsailDefaultKey-ap-northeast-2 (22).pem`
- **설치 후 경로**: `~/.ssh/lightsail_seoul.pem` (권한 600)

### 새 샌드박스에서 키 설치 절차
```bash
mkdir -p ~/.ssh
cp "/home/user/uploaded_files/LightsailDefaultKey-ap-northeast-2 (22).pem" ~/.ssh/lightsail_seoul.pem
chmod 600 ~/.ssh/lightsail_seoul.pem
```

### 서버 정보
| 항목 | 값 |
|---|---|
| **IP (Static)** | `3.35.58.206` |
| **사용자** | `ubuntu` |
| **OS** | Ubuntu 22.04.5 LTS, kernel 6.8.0-1052-aws |
| **스펙** | 2GB RAM, 78GB SSD (현재 사용 12GB) |
| **앱 실제 경로** | `/opt/regionwatch/regional-monitor` ⚠️ |
| **앱 문서상 경로 (outdated)** | `/home/ubuntu/apps/regionwatch/regional-monitor` (실제 다름!) |
| **DB** | PostgreSQL 14, localhost:5432 (비밀번호: `/home/ubuntu/.regionwatch_db_pw`) |
| **빌드 산출물** | `/opt/regionwatch/regional-monitor/frontend/dist` |

### 접속 명령
```bash
ssh -i ~/.ssh/lightsail_seoul.pem -o StrictHostKeyChecking=no ubuntu@3.35.58.206
```

### 운영 중 systemd 서비스
| 서비스 | 설명 | 포트 |
|---|---|---|
| `regionwatch-backend.service` | uvicorn (1 worker, FastAPI) | 127.0.0.1:8000 |
| `nginx.service` | Reverse proxy + 정적 dist 서빙 | 0.0.0.0:80, 0.0.0.0:443 |
| `sshd` | SSH | 0.0.0.0:22 |

### ⚠️ 보안 주의사항
- **IP 직접 접속 차단됨**: nginx에서 `return 444` (커밋 `d519135`) — 의도된 동작
- 외부 사용자는 **Cloudflare 도메인 경유로만** 접근 가능
- 헬스체크는 서버 내부에서 `curl http://127.0.0.1:8000/health`로만 가능
- super-admin 비번 변경 권장 (현재 운영 가이드 문서에 평문 노출됨)

---

## 3. 🚀 표준 재배포 절차 (검증 완료)

### 일반 재배포 (프론트엔드 변경)
```bash
ssh -i ~/.ssh/lightsail_seoul.pem -o StrictHostKeyChecking=no ubuntu@3.35.58.206 "
  cd /opt/regionwatch && git pull origin genspark_ai_developer &&
  cd regional-monitor/frontend && npm run build &&
  sudo systemctl reload nginx
"
```

### 백엔드 변경 시 추가 단계
```bash
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "
  cd /opt/regionwatch/regional-monitor/backend &&
  ./venv/bin/pip install -q -r requirements.txt &&
  sudo systemctl restart regionwatch-backend &&
  sudo journalctl -u regionwatch-backend -n 30 --no-pager
"
```

### 배포 검증
```bash
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "
  curl -sS http://127.0.0.1:8000/health &&
  ls -la /opt/regionwatch/regional-monitor/frontend/dist/index.html
"
```

### 로그 확인
```bash
# 백엔드
sudo journalctl -u regionwatch-backend -f
tail -f /home/ubuntu/logs/regionwatch-backend.log
tail -f /home/ubuntu/logs/regionwatch-backend.err.log

# nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 4. 📝 Git 워크플로우 (반드시 준수)

### 필수 절차
1. **모든 코드 변경 후 즉시 커밋** — 예외 없음
2. **`genspark_ai_developer` 브랜치에서 작업**
3. **푸시 전 원격 동기화**: `git fetch origin main && git rebase origin/main` (필요 시)
4. **PR #1이 이미 열려있음** — 새 커밋은 자동으로 PR에 추가됨 (별도 PR 생성 불필요)
5. **충돌 시 원격 우선** (단, 사용자 의도 확인 후)

### 표준 커밋 패턴
```bash
cd /home/user/webapp
git add <files>
git commit -m "type(scope): 한국어 또는 영어 요약

- 변경 내용 1
- 변경 내용 2
- 변경 내용 3"
git push origin genspark_ai_developer
```

### 커밋 타입
- `feat(scope)`: 신기능
- `fix(scope)`: 버그 수정
- `refactor(scope)`: 리팩토링
- `chore(scope)`: 잡무
- `security(scope)`: 보안 강화
- `docs(scope)`: 문서

### scope 예시
`sidebar`, `auth`, `home`, `monitor`, `verify`, `nginx`, `deploy`, `intro`, `about`

---

## 5. 🎨 프론트엔드 디자인 시스템

### 자주 쓰는 Tailwind 토큰 (커스텀)
| 클래스 | 용도 |
|---|---|
| `text-ink` | 주요 텍스트 (진한 색) |
| `text-ink-muted` | 보조 텍스트/라벨 (중간 색) |
| `text-ink-soft` | 약한 텍스트 (회색) |
| `bg-bg-subtle` | 옅은 배경 |
| `border-bg-subtle` | 구분선 |
| `bg-brand-500` / `hover:bg-brand-600` | 브랜드 컬러 (CTA 버튼) |
| `text-brand-600` | 브랜드 컬러 텍스트 (호버용) |
| `bg-ink-watermark` | 워터마크 배경 |

### 코드 스타일 규칙
- **clsx 사용**: 조건부 클래스는 `clsx()` 활용
- **외부 링크**: `target="_blank" rel="noopener noreferrer"` 필수
- **전화번호**: `<a href="tel:...">` 사용
- **이메일**: `<a href="mailto:...">` 사용

---

## 6. 📊 최근 작업 이력 (시간 역순)

### 2026-05-04 (오늘) — 사이드바 푸터 회사정보 작업
| 커밋 | 내용 |
|---|---|
| `d440703` | feat(sidebar): 이메일·카톡상담 링크 추가 |
| `182c60d` | feat(sidebar): 푸터 글씨 11px → 13px (20% 확대) |
| `221fad0` | feat(sidebar): "© 2026 타지역서비스 / v0.1.0..." 제거하고 회사정보로 교체 |

**변경 파일**: `regional-monitor/frontend/src/components/layout/Sidebar.tsx` (라인 410~458)

**현재 푸터 표시 내용**:
```
─────────────────────────────
상호  주식회사 페마연
대표  이종근
사업자등록번호  266-81-01215
통신판매업신고  2024-서울서초-3721

☎ 1688-8750            (tel: 링크)
이메일  ceo@femayeon.com (mailto: 링크)
카톡상담  pf.kakao.com/_qemTX (target="_blank" 새 탭)
─────────────────────────────
```

### 이전 주요 작업 (참고)
- `c3587e6` fix(auth): slowapi rate limit 500 에러 수정
- `da26a48` fix(auth): Pydantic v2 + slowapi 호환성
- `d519135` security(nginx): IP 직접 접속 차단 (444)
- `293f19c` security(ddos-2): fail2ban + slowapi + Cloudflare 연동
- `afc290a` fix(verify-scheduler): 자동 검증 2회 실행/토요일 미실행 수정
- `6a9f093` security(ddos): nginx rate limiting + slowloris timeout

---

## 7. ⚠️ 알려진 이슈 / 주의사항

### 7.1 서버에 stash 보관 중인 변경사항
서버에서 운영 중 직접 수정된 hotfix 2개가 stash에 있음:
```
stash@{0}: On genspark_ai_developer: pre-deploy-stash-20260504-021940
  - regional-monitor/backend/app/api/sitemap.py
  - regional-monitor/deploy/cloudflare/update-cf-ips.sh
```
**복원 명령**:
```bash
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "cd /opt/regionwatch && git stash pop"
```
**TODO**: 이 hotfix들을 검토 후 정식 커밋으로 정리 (서버에서 직접 수정된 운영 임시 픽스)

### 7.2 서버에 미커밋 백업 파일들
서버 `/opt/regionwatch/`에 다음 백업 파일/폴더가 untracked 상태로 누적 중:
```
redeploy.sh
regional-monitor/backend/app/api/sitemap.py.bak.20260504-082733
regional-monitor/deploy/cloudflare/update-cf-ips.sh.bak.20260503-224539
regional-monitor/deploy/cloudflare/update-cf-ips.sh.bak.20260504-091000
regional-monitor/frontend/dist.bak.20260503-222957/
regional-monitor/frontend/dist.bak.20260503-232655/
regional-monitor/frontend/dist.bak.20260504-083528/
regional-monitor/frontend/dist.bak.20260504-092906/
```
**TODO**: 디스크 공간 확보 위해 30일 이상 된 백업 정리 스크립트 추가 검토

### 7.3 운영 문서와 실제 경로 불일치
- `deploy/aws-lightsail-deploy.md`: `/home/ubuntu/apps/regionwatch/regional-monitor`
- 실제: `/opt/regionwatch/regional-monitor`
- **TODO**: 문서를 실제 경로로 업데이트 필요

### 7.4 새 샌드박스 시작 시 주의사항
새 채팅에서는 다음이 모두 초기화됨:
- ✅ Git 저장소(`/home/user/webapp`)는 자동 복원됨
- ❌ `~/.ssh/lightsail_seoul.pem` SSH 키 → 사용자 재업로드 필요
- ❌ `node_modules/` → `npm install` 재실행 필요 (~10초)
- ❌ Python venv → 일반적으로 로컬 빌드 시 불필요 (서버에만 존재)
- ❌ 업로드된 이미지/파일 → 사용자 재첨부 필요

---

## 8. 🛠️ 자주 쓰는 명령어 모음

### 로컬 개발
```bash
# 의존성 설치
cd /home/user/webapp/regional-monitor/frontend && npm install --no-audit --no-fund --silent

# 타입체크 (빠름)
cd /home/user/webapp/regional-monitor/frontend && npx tsc --noEmit

# 프로덕션 빌드 테스트
cd /home/user/webapp/regional-monitor/frontend && npm run build

# 텍스트 검색 (특정 문구 위치 찾기)
cd /home/user/webapp && grep -rn "검색문구" regional-monitor/frontend/src/ --include="*.tsx"
```

### 서버 운영
```bash
# 빠른 헬스체크
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "
  uptime && df -h / && free -h &&
  sudo systemctl is-active regionwatch-backend nginx &&
  curl -sS http://127.0.0.1:8000/health
"

# 서비스 재시작
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "sudo systemctl restart regionwatch-backend"
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "sudo systemctl reload nginx"

# 디스크 사용량 확인
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206 "df -h && du -sh /opt/regionwatch/regional-monitor/frontend/dist*"
```

---

## 9. 📞 연락처 / 회사 정보 (사이드바 푸터에 표시 중)

| 항목 | 값 |
|---|---|
| 상호 | 주식회사 페마연 |
| 대표 | 이종근 |
| 사업자등록번호 | 266-81-01215 |
| 통신판매업신고 | 2024-서울서초-3721 |
| 대표전화 | 1688-8750 |
| 이메일 | ceo@femayeon.com |
| 카톡상담 | http://pf.kakao.com/_qemTX |

---

## 10. 🎯 사용자 작업 스타일 / 선호도

- **언어**: 한국어로 응답 우선
- **응답 형식**: 표/체크리스트로 구조화된 결과 선호
- **배포까지 한 번에**: 코드 수정 → 커밋 → 푸시 → 서버 배포까지 일괄 처리하기를 선호
- **검증 중시**: 빌드 결과/번들 검증/헬스체크까지 확인 후 보고
- **문서 자동화**: 반복되는 정보는 인수인계 문서로 정리 요청
- **이미지 작업**: 이미지 없이 텍스트로만 처리하는 것도 OK
- **AI 망각 대비**: SSH 키, 서버 정보 등 자주 잊히는 정보는 명시적 기록 선호

---

## 11. 🔄 새 채팅 시작 시 표준 프롬프트 (사용자가 복사해서 쓸 것)

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
프로젝트 인수인계 — 페마연/타지역서비스 (RegionWatch)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

먼저 /home/user/webapp/HANDOFF.md 를 읽고 모든 컨텍스트를 파악해줘.

서버 접속용 SSH 키:
  https://www.genspark.ai/api/files/s/aul1zh6o
  파일명: LightsailDefaultKey-ap-northeast-2 (22).pem

서버: ubuntu@3.35.58.206 (서울 Lightsail)
앱 경로: /opt/regionwatch/regional-monitor
브랜치: genspark_ai_developer (PR #1)

키 파일은 곧 첨부할게.
키 받으면 ~/.ssh/lightsail_seoul.pem 으로 설치 후 권한 600 줘.

그 다음 작업:
[여기에 새 작업 내용 입력]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 12. 📚 참고 문서 위치

| 문서 | 경로 | 용도 |
|---|---|---|
| 본 인수인계 | `/home/user/webapp/HANDOFF.md` | ★ 항상 먼저 읽기 |
| Lightsail 운영 가이드 | `/home/user/webapp/deploy/aws-lightsail-deploy.md` | (※ 앱 경로 outdated) |
| 프로젝트 README | `/home/user/webapp/README.md` | 프로젝트 개요 |
| Cloudflare 가이드 | `/home/user/webapp/regional-monitor/deploy/cloudflare/README.md` | Cloudflare 연동 |
| 백업 가이드 | `/home/user/webapp/regional-monitor/scripts/backup/README.md` | 자동 백업 시스템 |
| 재배포 스크립트 | `/home/user/webapp/regional-monitor/deploy.sh` | bash 자동 배포 |
| PSI 도구 | `/home/user/webapp/tools/psi.sh` | PageSpeed Insights 점검 |

---

> **📝 이 문서를 업데이트하는 것도 작업의 일부입니다.**
> 작업 완료 후 "최근 작업 이력"(섹션 6) 및 "알려진 이슈"(섹션 7)을 갱신하고 함께 커밋하세요.
