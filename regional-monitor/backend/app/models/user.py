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
    # [DEPRECATED — Schedule v2 도입 후 verify_slot_15m 으로 대체]
    # 1단계 마이그레이션 기간(dry-run 1주) 동안 호환성 유지를 위해 컬럼은 남겨둔다.
    # 매 시각 정각 hourly 트리거가 이 컬럼으로 사용자를 선택해 실제 검증을 실행.
    verify_slot: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    # ── 자동 검증 스케줄 v2 (15분 슬롯 + 주기) ──
    # verify_frequency: 자동 검증 주기
    #   'daily'    — 매일 1회
    #   'every3d'  — 3일에 1회
    #   'every5d'  — 5일에 1회
    #   'weekly'   — 7일에 1회
    #   'paused'   — 자동 검증 중지 (수동만)
    # 가입 시 plan 매핑(default_frequency_for_plan)으로 자동 부여.
    verify_frequency: Mapped[str] = mapped_column(
        String(20), default="every3d", nullable=False, index=True,
    )

    # verify_slot_15m: 0~95 (하루 96개의 15분 슬롯 중 하나)
    #   slot N → KST (N//4):(N%4 * 15) 시각
    #   가입 시 균등 해시 (user_id × 7919) mod 96 으로 자동 배정.
    #   슬롯당 등록 합계가 임계치 초과 시 어드민이 rebalance 호출 → 인접 슬롯으로 이동.
    verify_slot_15m: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, index=True,
    )

    # last_auto_run_at: 마지막 자동 검증 실행 시각 (주기 충족 판정용)
    #   현재 슬롯에 진입했더라도 (now - last_auto_run_at) < frequency_seconds 면 skip.
    last_auto_run_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

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
