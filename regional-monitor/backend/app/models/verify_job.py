"""대용량 검증 작업(Job) 모델.

500건 청크 + 진행률 추적 + 취소 가능. 백엔드 in-process asyncio 워커가
이 레코드를 polling 하지 않고, /verify/job 엔드포인트가 생성과 동시에
asyncio.create_task 로 워커를 띄운다(같은 프로세스).

상태 (status):
  - queued        : 생성됐지만 아직 시작 안 됨 (보통 매우 짧은 순간)
  - running       : 실행 중
  - completed     : 정상 종료
  - cancelled     : 사용자가 취소
  - failed        : 예외 발생

cancel_requested 가 True 이면 워커가 다음 청크 시작 전에 멈춘다.
"""
from __future__ import annotations

from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VerifyJob(Base):
    __tablename__ = "verify_jobs"
    __table_args__ = (
        Index("ix_verify_jobs_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 진행 상태
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False, index=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 카운트
    total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ok_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    danger_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 청크/타이밍
    chunk_size: Mapped[int] = mapped_column(Integer, default=500, nullable=False)
    chunks_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    chunks_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )

    # 에러
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 어떤 place 들을 검증할지 (None 이면 사용자 전체)
    # 콤마 구분 ID 문자열로 저장 (PG/SQLite 모두 호환).
    place_ids_csv: Mapped[str | None] = mapped_column(Text, nullable=True)
