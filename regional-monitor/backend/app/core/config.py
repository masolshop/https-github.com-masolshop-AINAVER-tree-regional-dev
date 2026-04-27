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
    SMTP_FROM_NAME: str = "RegionWatch"
    # 알림 자체를 완전히 끄려면 (테스트 시) NOTIFY_ENABLED=false
    NOTIFY_ENABLED: bool = True

    # ── CORS ──
    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://5173-inw0qfytlerazc1omo3uw-5634da27.sandbox.novita.ai",
    ]


settings = Settings()
