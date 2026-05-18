"""WeeklyReportLog — 주간 리포트 메일 발송 이력.

매주 월요일 09:00 KST 자동 잡(또는 관리자 수동 트리거)이 회원 1명 처리할 때
1행씩 기록한다. 또한 잡 단위 요약 1행도 함께 기록(user_id=NULL)해
관리자가 회차별 결과를 빠르게 확인할 수 있게 한다.

용도:
  · 어드민의 발송 이력 페이지 (회차/회원별 status, activity, error 표시)
  · 'sent / skipped_no_activity / errors' 추이 집계
  · 특정 회원의 마지막 발송 시각·내용 추적
"""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Boolean, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time_utils import now_kst, KSTDateTime


class WeeklyReportLog(Base):
    """주간 리포트 1회 발송 = 1 row.

    user_id 가 NULL 인 행은 잡 전체 요약(run summary)을 의미한다.
    같은 run_id 로 묶여 있어 어드민에서 회차별로 그룹핑 가능.
    """
    __tablename__ = "weekly_report_log"
    __table_args__ = (
        Index("ix_wrl_run_user", "run_id", "user_id"),
        Index("ix_wrl_started", "started_at"),
        Index("ix_wrl_status_started", "status", "started_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    # 회차 식별자 — 같은 잡 실행에서 발송된 모든 row 가 같은 run_id 를 공유한다.
    # 형식: "weekly-YYYYMMDD-HHMMSS-{rand4}" (잡 시작 시 1번 생성)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # 트리거: 'scheduled' (월 09:00 자동) | 'manual' (관리자 수동) | 'manual_dry_run'
    trigger: Mapped[str] = mapped_column(String(30), nullable=False, default="scheduled", index=True)

    # 잡 시작 시각 (KST). user_id 와 무관하게 같은 run_id 행은 같은 값.
    started_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False, index=True,
    )

    # 발송 시도 시각 (KST). 회원별 행에서 의미가 있음.
    sent_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # 회원 — NULL 이면 잡 전체 요약 행 (status='run_summary')
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # 회원 이메일 스냅샷(회원이 추후 삭제돼도 기록 유지)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cc_emails: Mapped[str | None] = mapped_column(Text, nullable=True)  # 콤마 구분

    # 처리 결과 분류:
    #   'sent'                 — SMTP 발송 성공 (실제 메일)
    #   'sent_fallback'        — SMTP 미설정 → 콘솔 폴백 (드라이런/개발)
    #   'skipped_no_activity'  — 7일 활동 0건 → 스킵
    #   'skipped_disabled'     — email_alerts=false 등 발송 정책 미달
    #   'failed'               — SMTP 예외
    #   'run_summary'          — 회차 전체 요약(user_id NULL)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="sent", index=True)

    # 활동 요약 (user_id 행에서 의미). 잡 요약 행은 합계로 채운다.
    new_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    excluded_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    changed_exposure: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dead_exposure: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_override: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    activity_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 잡 요약 전용 카운트 (status='run_summary' 일 때만 채움)
    sent_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_no_activity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_disabled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_candidates: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 드라이런 여부 (실제 SMTP 호출 안 함)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    # 실패/스킵 사유 (있으면)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<WeeklyReportLog id={self.id} run={self.run_id} "
            f"user={self.user_id} status={self.status!r} dry_run={self.dry_run}>"
        )
