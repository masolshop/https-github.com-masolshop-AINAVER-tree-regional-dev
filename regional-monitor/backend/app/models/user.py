"""User 모델.

가입/로그인 흐름:
  1) Google OAuth 로 email + google_sub 확보 → User 생성/조회 (is_profile_complete=False)
  2) 추가정보 입력 폼: phone / company / (job_title) + 약관 동의 → is_profile_complete=True
  3) 이후 로그인은 1단계만 거치고 바로 서비스 진입
"""
from datetime import datetime
from app.core.time_utils import now_kst, KSTDateTime
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
    agreed_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # ── 가입 완료 플래그 ──
    is_profile_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    # ── 비밀번호 로그인 (어드민/직접가입용, Google OAuth 사용자는 NULL) ──
    # username: 직접가입 시 사용자가 정한 아이디 (4~30자 영문/숫자/_/.).
    # 이메일이 아니라 아이디로 로그인할 수 있게 함. Google OAuth 사용자는 NULL.
    username: Mapped[str | None] = mapped_column(String(60), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── 비밀번호 재설정 (이메일 링크 토큰) ──
    reset_token: Mapped[str | None] = mapped_column(String(120), unique=True, index=True, nullable=True)
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # ── 권한 ──
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    blocked_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # ── 자동 검증 시간 슬롯 (0~23, "매일 N시 검증") ──
    # 사용자 분산을 위해 가입 시 id % 24 로 자동 배정.
    # 1만 명일 때 슬롯당 ~417명 × 5건 = 2,085건/시간 → 0.6 RPS (네이버 안전).
    verify_slot: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

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
        KSTDateTime, default=now_kst, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, onupdate=now_kst, nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} email={self.email!r} complete={self.is_profile_complete}>"
