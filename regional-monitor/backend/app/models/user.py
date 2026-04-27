"""User 모델.

가입/로그인 흐름:
  1) Google OAuth 로 email + google_sub 확보 → User 생성/조회 (is_profile_complete=False)
  2) 추가정보 입력 폼: phone / company / (job_title) + 약관 동의 → is_profile_complete=True
  3) 이후 로그인은 1단계만 거치고 바로 서비스 진입
"""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    # ── 기본 정보 (Google OAuth로 확보) ──
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    picture: Mapped[str | None] = mapped_column(String(500), nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String(120), unique=True, index=True, nullable=True)

    # ── 추가 정보 (가입 2단계에서 수집, 필수) ──
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)              # 010-XXXX-XXXX
    company: Mapped[str | None] = mapped_column(String(120), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)         # 선택

    # ── 약관 동의 (가입 2단계 마지막에서 수집) ──
    agreed_privacy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)   # [필수]
    agreed_terms: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)     # [필수]
    agreed_marketing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False) # [선택]
    agreed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ── 가입 완료 플래그 ──
    is_profile_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    # ── 플랜 ──
    plan: Mapped[str] = mapped_column(String(20), default="free", nullable=False)
    quota_places: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    # ── 구글시트 연동 ──
    sheet_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sheet_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ── 알림 설정 ──
    email_alerts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    kakao_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    slack_webhook: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # ── 타임스탬프 ──
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} email={self.email!r} complete={self.is_profile_complete}>"
