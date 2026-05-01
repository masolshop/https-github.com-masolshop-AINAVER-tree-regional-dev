"""앱 설정 (환경변수 우선)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── 앱 ──
    APP_NAME: str = "Regional Monitor API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True
    # SQLAlchemy 쿼리 로그 (개발 시에만 켤 것)
    SQL_ECHO: bool = False

    # ── DB ──
    # 개발: SQLite (파일 기반), 운영: PostgreSQL (asyncpg)
    DATABASE_URL: str = "sqlite+aiosqlite:///./regional_monitor.db"

    # ── 인증 ──
    JWT_SECRET: str = "dev-secret-change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRES_HOURS: int = 24 * 7   # 7일

    # Google OAuth (Step에서 설정)
    GOOGLE_CLIENT_ID: str = ""

    # ── 검증 정책 (Tab 3 설정 기본값) ──
    DONG_THRESHOLD: int = 70          # 0~100
    NAME_THRESHOLD: int = 40

    # ── 자동 검증 스케줄러 ──
    # 24시간 분산 (시간당 1회): 매 시각 정각에 verify_slot 일치 사용자만 검증
    # 테스트/개발 시 끄려면 SCHEDULER_ENABLED=false
    SCHEDULER_ENABLED: bool = True

    # ── 알림 (SMTP) ──
    # 미설정 시 notifier 가 콘솔 로그 폴백 — 개발/테스트 안전.
    # 운영에서는 SES / SendGrid / Gmail SMTP 등을 환경변수로 주입.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""                       # 비우면 SMTP_USER 사용
    SMTP_FROM_NAME: str = "타지역서비스"
    # 알림 자체를 완전히 끄려면 (테스트 시) NOTIFY_ENABLED=false
    NOTIFY_ENABLED: bool = True
    # 주간 리포트 메일(매주 월 09:00 KST) 활성화 토글 — 운영에서는 true 유지
    WEEKLY_REPORT_ENABLED: bool = True

    # ── Google Analytics 4 (방문자 분석 대시보드) ──
    # GA4 측정 ID(예: G-XXXXXXXXXX) — frontend gtag 주입에는 VITE_GA_MEASUREMENT_ID 사용.
    # 백엔드 Data API 호출에는 GA4_PROPERTY_ID(숫자) 와 서비스 계정 키 JSON 경로 필요.
    GA4_PROPERTY_ID: str = ""                       # 예: "486271234"
    GA4_CREDENTIALS_FILE: str = ""                  # 서비스 계정 JSON 경로 (절대 경로 권장)
    # 운영 자체 호스팅에서 키 파일 경로를 못 줄 때, 키 본문 자체를 환경변수로 주입 가능.
    GA4_CREDENTIALS_JSON: str = ""                  # JSON 문자열 (선택)

    # ── CORS ──
    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://5173-inw0qfytlerazc1omo3uw-5634da27.sandbox.novita.ai",
    ]


settings = Settings()
