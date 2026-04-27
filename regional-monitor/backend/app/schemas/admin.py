"""어드민 API 스키마."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────
# 사용자 관리
# ──────────────────────────────────────────────────────────────

class AdminUserOut(BaseModel):
    id: int
    email: str
    name: str
    phone: str | None = None
    company: str | None = None
    plan: str
    quota_places: int
    is_profile_complete: bool
    is_superadmin: bool
    is_active: bool
    blocked_reason: str | None = None
    verify_slot: int
    place_count: int = 0           # registered_places 갯수
    last_login_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class AdminUserListOut(BaseModel):
    total: int
    items: list[AdminUserOut]


class AdminUserPatch(BaseModel):
    """어드민이 사용자 필드를 변경할 때 사용. 전부 optional."""
    plan: Literal["free", "basic", "pro", "enterprise"] | None = None
    quota_places: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None
    blocked_reason: str | None = Field(default=None, max_length=500)
    is_superadmin: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)


# ──────────────────────────────────────────────────────────────
# 결제 관리
# ──────────────────────────────────────────────────────────────

class AdminPaymentOut(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    user_name: str | None = None
    plan: str
    amount_krw: int
    currency: str
    status: str
    method: str | None = None
    gateway: str | None = None
    gateway_tx_id: str | None = None
    memo: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    created_at: datetime
    paid_at: datetime | None = None
    refunded_at: datetime | None = None

    class Config:
        from_attributes = True


class AdminPaymentListOut(BaseModel):
    total: int
    items: list[AdminPaymentOut]


class AdminPaymentCreate(BaseModel):
    """어드민이 수동으로 결제(또는 무료 부여) 레코드를 만들 때 사용."""
    user_id: int
    plan: Literal["free", "basic", "pro", "enterprise"]
    amount_krw: int = Field(default=0, ge=0)
    method: Literal["card", "kakao_pay", "naver_pay", "bank", "admin_grant"] = "admin_grant"
    gateway: str | None = "admin"
    gateway_tx_id: str | None = None
    memo: str | None = Field(default=None, max_length=500)
    period_days: int = Field(default=30, ge=1, le=3650)
    mark_paid: bool = True
    apply_plan_to_user: bool = True   # True면 user.plan 도 업데이트


class AdminPaymentPatch(BaseModel):
    """결제 상태 변경 (환불/실패 등)."""
    status: Literal["pending", "paid", "failed", "refunded", "canceled"] | None = None
    memo: str | None = Field(default=None, max_length=500)


# ──────────────────────────────────────────────────────────────
# 시스템 통계
# ──────────────────────────────────────────────────────────────

class AdminStatsOut(BaseModel):
    users_total: int
    users_active: int
    users_blocked: int
    users_by_plan: dict[str, int]                   # {'free': 1234, 'pro': 56}
    places_total: int
    events_total: int
    events_unread: int
    payments_total: int
    revenue_paid_krw: int                           # 누적 결제 완료 금액
    last_24h_checks: int                            # 최근 24시간 검증 수
