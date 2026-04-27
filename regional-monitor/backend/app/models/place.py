"""RegisteredPlace 모델 — 사용자가 등록한 070+Place ID 매핑."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RegisteredPlace(Base):
    __tablename__ = "registered_places"
    __table_args__ = (
        Index("ix_user_phone", "user_id", "phone", unique=True),
        Index("ix_user_status", "user_id", "current_verdict"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 등록 정보 (사용자가 입력 + 자동 추출 보강)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    place_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    registered_dong: Mapped[str] = mapped_column(String(120), nullable=False)  # 등록 시점 동
    business_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # 자동 추출 부가 정보
    full_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # 현재 검증 상태 (마지막 daily_health_check 결과 캐시)
    # OK / PHONE_MISMATCH / DONG_MISMATCH / NAME_MISMATCH / REGION_MISMATCH / DEAD / PENDING
    current_verdict: Mapped[str] = mapped_column(String(30), default="PENDING", nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 타임스탬프
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<Place id={self.id} phone={self.phone} "
            f"place_id={self.place_id} verdict={self.current_verdict}>"
        )
