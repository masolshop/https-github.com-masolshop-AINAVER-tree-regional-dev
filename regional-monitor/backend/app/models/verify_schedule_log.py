"""VerifyScheduleLog 모델 — 자동 검증 스케줄 v2 의 슬롯 실행 기록.

매 15분 슬롯마다 어떤 사용자가 처리됐는지(또는 dry-run 시뮬레이션 결과인지)
1행씩 기록한다. 어드민의 슬롯별 부하 그래프·dry-run 시뮬레이션 검증·문제
회원 추적에 사용.

dry-run 운영(1주일):
  · status='dry_run_skipped' 로 기록만 남기고 실제 검증은 hourly 로직이 수행
  · 어드민에서 1주일치 분포를 확인 후 환경변수 OFF → v2 본가동
"""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time_utils import now_kst, KSTDateTime


class VerifyScheduleLog(Base):
    """슬롯 1회 × 사용자 1명 = 1 row.

    어드민 화면에서 다음 용도로 활용:
      · 슬롯별 부하 히트맵 (slot_index 0~95 × 회원 수)
      · dry-run 결과 검증 (예정 부하가 임계 안에 들어오는지)
      · 자동/수동 회차 추적 (trigger 컬럼)
    """
    __tablename__ = "verify_schedule_log"
    __table_args__ = (
        Index("ix_vsl_slot_scheduled", "slot_index", "scheduled_at"),
        Index("ix_vsl_user_scheduled", "user_id", "scheduled_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # 0~95 — 어느 15분 슬롯에서 실행됐는가
    slot_index: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # 슬롯이 깨어난 KST 시각 (스케줄러 정각 기준)
    scheduled_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False, index=True,
    )

    # 그 시점에 회원이 가지고 있던 주기 ('daily'/'every3d'/'every5d'/'weekly'/'paused')
    frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="every3d")

    # 처리한 등록 수 (dry-run 이면 처리 예정 수)
    places_checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 실행 소요 시간 (ms). dry-run 이면 0.
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 처리 결과 분류:
    #   'executed'           — 실제 검증 수행됨 (v2 본가동)
    #   'dry_run_recorded'   — dry-run 기간: 기록만 남김, 실제 검증 안 함
    #   'skipped_frequency'  — 주기 미충족 (예: every3d 인데 어제 검증)
    #   'skipped_paused'     — frequency='paused' 라서 건너뜀
    #   'skipped_incomplete' — 프로필 미완성 회원
    #   'failed'             — 실행 도중 예외
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="dry_run_recorded", index=True)

    # 실패/스킵 사유 텍스트 (있으면)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # dry-run 여부 (status 와 별개로 빠른 필터용)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<VerifyScheduleLog id={self.id} user={self.user_id} "
            f"slot={self.slot_index} status={self.status!r} dry_run={self.dry_run}>"
        )
