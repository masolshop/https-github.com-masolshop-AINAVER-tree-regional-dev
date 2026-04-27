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

    # ── CORS ──
    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://5173-inw0qfytlerazc1omo3uw-5634da27.sandbox.novita.ai",
    ]


settings = Settings()
