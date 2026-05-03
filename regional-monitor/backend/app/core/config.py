"""앱 설정 (환경변수 우선)."""
import logging
import os
import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

_log = logging.getLogger("config")

# 개발 기본값 (운영에서 절대 사용 금지)
_DEV_JWT_DEFAULT = "dev-secret-change-me-in-production"


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
    # 운영(DEBUG=False) 환경에서는 반드시 환경변수 JWT_SECRET을 설정해야 함.
    # 기본 dev 값으로 운영 시작 시 startup 가드에서 거부.
    JWT_SECRET: str = _DEV_JWT_DEFAULT
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

    # ── GA4 OAuth (서비스 계정 권한 부여 불가 시 개인 Gmail 인증) ──
    GA4_OAUTH_CLIENT_ID: str = ""
    GA4_OAUTH_CLIENT_SECRET: str = ""
    GA4_OAUTH_REDIRECT_URI: str = ""                # 예: https://taziyuk.com/api/v1/admin/analytics/oauth/callback
    GA4_OAUTH_TOKEN_FILE: str = "/etc/regionwatch/ga4-oauth-token.json"
    # 인증 후 어드민 대시보드로 돌아갈 URL (콜백 처리 후 redirect 대상)
    GA4_OAUTH_SUCCESS_REDIRECT: str = "/admin?tab=analytics"

    # ── CORS ──
    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://5173-inw0qfytlerazc1omo3uw-5634da27.sandbox.novita.ai",
    ]


settings = Settings()


# ── 운영 환경 보안 가드 ──
# DEBUG=False (운영) 일 때 JWT_SECRET이 dev 기본값이거나 너무 짧으면 거부.
# 환경변수 ALLOW_INSECURE_JWT=1 로 명시적으로 비활성화 가능 (긴급 우회용).
if not settings.DEBUG:
    _allow_insecure = os.getenv("ALLOW_INSECURE_JWT") == "1"
    if settings.JWT_SECRET == _DEV_JWT_DEFAULT or len(settings.JWT_SECRET) < 32:
        if _allow_insecure:
            _log.warning(
                "⚠️ JWT_SECRET 이 안전하지 않습니다. ALLOW_INSECURE_JWT=1 로 무시 — "
                "즉시 환경변수 JWT_SECRET 을 32자 이상 랜덤 값으로 교체하세요."
            )
        else:
            raise RuntimeError(
                "보안: 운영(DEBUG=False) 환경에서 JWT_SECRET 이 dev 기본값이거나 32자 미만입니다. "
                "환경변수 JWT_SECRET 을 강력한 랜덤 값(예: `python -c \"import secrets;print(secrets.token_urlsafe(48))\"`)"
                "으로 설정한 후 재시작하세요."
            )
