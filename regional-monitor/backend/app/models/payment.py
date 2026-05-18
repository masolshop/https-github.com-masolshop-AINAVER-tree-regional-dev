"""Payment 모델 — 플랜 구독·결제 이력.

설계 원칙:
  · 결제 게이트웨이(이니시스/토스/포트원/스트라이프 등) 와 무관한 우리 측 정규화 레코드.
  · 외부 PG의 raw payload 는 raw_payload(JSON) 에 보존해 추후 재처리/감사 가능.
  · 상태 전이: pending → paid → (refunded | failed)
  · 어드민 페이지에서 수동 마킹(`paid_admin`)도 가능하도록 method 에 'admin_grant' 허용.
"""
from datetime import datetime
from app.core.time_utils import now_kst, KSTDateTime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)

    # ── 사용자 ──
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # ── 플랜/금액 ──
    plan: Mapped[str] = mapped_column(String(20), nullable=False)            # 'free' | 'basic' | 'pro' | 'enterprise'
    amount_krw: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KRW")

    # ── 상태 ──
    # pending: 결제 시도, paid: 정상 입금, failed: 결제 실패, refunded: 환불, canceled: 사용자 취소
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)

    # ── 수단 / 외부 PG ──
    method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 'card' | 'kakao_pay' | 'naver_pay' | 'bank' | 'admin_grant' (어드민 수동 부여)
    gateway: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 'inicis' | 'toss' | 'portone' | 'stripe' | 'admin'
    gateway_tx_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)

    # ── 메모/원본 ──
    memo: Mapped[str | None] = mapped_column(String(500), nullable=True)        # 어드민 메모
    raw_payload: Mapped[str | None] = mapped_column(Text, nullable=True)        # 외부 PG raw JSON

    # ── 구독 기간 ──
    period_start: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    # ── 타임스탬프 ──
    created_at: Mapped[datetime] = mapped_column(KSTDateTime, default=now_kst, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, onupdate=now_kst, nullable=False
    )
    paid_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(KSTDateTime, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Payment id={self.id} user={self.user_id} plan={self.plan} status={self.status} amount={self.amount_krw}>"


__all__ = ["Payment"]
