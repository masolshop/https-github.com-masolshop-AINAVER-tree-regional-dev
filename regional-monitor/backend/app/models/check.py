"""DailyHealthCheck + ChangeEvent 모델."""
from datetime import datetime
from app.core.time_utils import now_kst, KSTDateTime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DailyHealthCheck(Base):
    """일별 검증 결과 — Place ID 기반 4중 검증의 raw 결과."""
    __tablename__ = "daily_health_checks"
    __table_args__ = (
        Index("ix_place_date", "place_id_ref", "checked_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    place_id_ref: Mapped[int] = mapped_column(
        ForeignKey("registered_places.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 4중 검증 raw 결과
    alive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    phone_match: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dong_match: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    name_match: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 실제 노출된 값
    actual_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_dong: Mapped[str | None] = mapped_column(String(120), nullable=True)
    actual_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actual_address: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # 종합 판정
    verdict: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    # 메타
    response_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    http_status: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)

    checked_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False, index=True
    )


class ChangeEvent(Base):
    """노출 상태 변경 이벤트 — 알림 트리거 단위."""
    __tablename__ = "change_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    place_id_ref: Mapped[int] = mapped_column(
        ForeignKey("registered_places.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 이벤트 종류:
    #   EXPOSURE_LOST       — OK → 비정상 (노출 사라짐, 가장 심각)
    #   DONG_CHANGED        — 동 변경
    #   NAME_CHANGED        — 상호 변경
    #   REGION_CHANGED      — 시/도 단위 이동 (가장 심각한 동 변경)
    #   PAGE_DELETED        — 플레이스 페이지 자체가 삭제됨 (404)
    #   RECOVERED           — 비정상 → OK (재노출 성공)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    # 변경 전/후 verdict
    prev_verdict: Mapped[str] = mapped_column(String(30), nullable=False)
    new_verdict: Mapped[str] = mapped_column(String(30), nullable=False)

    # 사람이 읽을 수 있는 변경 요약
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")

    # 알림 발송 상태
    notified_email: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notified_kakao: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notified_slack: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    detected_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False, index=True
    )
