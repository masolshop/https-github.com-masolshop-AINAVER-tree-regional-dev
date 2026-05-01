"""RegisteredPlace 모델 — 사용자가 등록한 070+Place ID 매핑."""
from datetime import datetime
from app.core.time_utils import now_kst, KSTDateTime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Index, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RegisteredPlace(Base):
    __tablename__ = "registered_places"
    __table_args__ = (
        Index("ix_user_phone", "user_id", "phone", unique=True),
        Index("ix_user_status", "user_id", "current_verdict"),
        Index("ix_user_in_latest", "user_id", "in_latest_upload"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 등록 정보 (사용자가 입력 + 자동 추출 보강)
    # phone만 등록 시 필수, 나머지는 추출 후 채워짐 (검증 시작 시 추출 또는 자동 검증 시 추출)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    place_id: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    registered_dong: Mapped[str | None] = mapped_column(String(120), nullable=True)  # 등록 시점 동
    business_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # 자동 추출 부가 정보
    full_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # 현재 검증 상태 (마지막 daily_health_check 결과 캐시)
    # OK / PHONE_MISMATCH / DONG_MISMATCH / NAME_MISMATCH / REGION_MISMATCH / DEAD / PENDING
    current_verdict: Mapped[str] = mapped_column(String(30), default="PENDING", nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # ── 미포함 번호(Excluded number) 추적 ──
    # 최근 업로드된 엑셀에 포함돼 있는지 여부.
    # · 신규 INSERT 시 True
    # · 재업로드(엑셀)에 같은 번호가 다시 있으면 True (excluded_at = NULL 로 복귀)
    # · 재업로드(엑셀)에 빠지면 False, excluded_at 기록 → UI 에서 "미포함 번호" 뱃지
    in_latest_upload: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )
    excluded_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # 타임스탬프
    created_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, onupdate=now_kst, nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<Place id={self.id} phone={self.phone} "
            f"place_id={self.place_id} verdict={self.current_verdict}>"
        )
