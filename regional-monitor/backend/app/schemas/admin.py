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
    email: str | None = Field(default=None, min_length=3, max_length=255)
    company: str | None = Field(default=None, max_length=120)


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


# ──────────────────────────────────────────────────────────────
# 회원 모니터링 (전 회원 검증상태 요약 — 슈퍼어드민 전용)
# ──────────────────────────────────────────────────────────────

class AdminMonitorRow(BaseModel):
    """회원 1행 요약."""
    user_id: int
    email: str
    name: str
    company: str | None = None       # 업체명
    plan: str                        # 회원등급 (free / basic / pro / enterprise)
    is_active: bool
    is_superadmin: bool
    place_count: int = 0             # 등록 갯수
    # 검증상태 분포 (registered_places.current_verdict)
    ok_count: int = 0                # 정상 노출
    dead_count: int = 0              # 페이지 삭제
    mismatch_count: int = 0          # 불일치 (PHONE/DONG/NAME/REGION MISMATCH 합산)
    pending_count: int = 0           # 검증 대기
    # 최근 자동/수동 검증 1회의 모드/시각 — UI 뱃지로 표시
    last_run_mode: str | None = None        # 'full' / 'fast' / None
    last_run_trigger: str | None = None     # 'scheduler' / 'manual' / None
    last_run_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime


class AdminMonitorSummary(BaseModel):
    """전체 합계 — 페이지 상단 카드용."""
    users_total: int
    users_with_places: int           # 등록건수 ≥ 1 인 회원 수
    places_total: int
    ok_total: int
    dead_total: int
    mismatch_total: int
    pending_total: int


class AdminMonitorOut(BaseModel):
    summary: AdminMonitorSummary
    items: list[AdminMonitorRow]


# ──────────────────────────────────────────────────────────────
# 자동 검증 스케줄 v2 — 어드민 관리 (슈퍼어드민 전용)
# ──────────────────────────────────────────────────────────────

class AdminScheduleUserRow(BaseModel):
    """회원별 스케줄 1행."""
    user_id: int
    email: str
    name: str
    company: str | None = None
    plan: str
    is_active: bool
    verify_frequency: str            # daily / every3d / every5d / weekly / paused
    verify_slot_15m: int             # 0~95
    verify_slot_label: str           # '00:00' 형식
    place_count: int = 0
    last_auto_run_at: datetime | None = None
    next_due_at: datetime | None = None       # 추정 다음 실행 시각
    is_due_now: bool = False                  # 현재 due 여부
    # 최근 24시간 동안 자동 ↔ 수동 충돌로 양보된 횟수 (skipped_manual)
    skipped_manual_24h: int = 0


class AdminScheduleSummary(BaseModel):
    """스케줄 요약 카드용."""
    users_total: int                 # 활성 회원 (paused 제외)
    users_paused: int
    places_total: int
    slot_max_load: int               # 가장 붐비는 슬롯의 등록 합계
    slot_avg_load: float
    slot_over_limit: int             # SLOT_PLACES_LIMIT 초과 슬롯 수
    by_frequency: dict[str, int]     # {'daily': 12, 'every3d': 30, ...}
    # 최근 24시간 verify_schedule_log 집계
    skipped_manual_24h: int = 0      # 자동 ↔ 수동 충돌로 양보된 총 회수
    skipped_manual_users_24h: int = 0  # 양보된 distinct 회원 수
    executed_24h: int = 0            # 실제 검증 수행 회수
    dry_run_recorded_24h: int = 0    # dry-run 기록 회수


class AdminScheduleListOut(BaseModel):
    summary: AdminScheduleSummary
    items: list[AdminScheduleUserRow]


class AdminScheduleHeatmapCell(BaseModel):
    slot: int                        # 0~95
    label: str                       # '00:00'
    user_count: int
    place_count: int


class AdminScheduleHeatmapOut(BaseModel):
    cells: list[AdminScheduleHeatmapCell]   # 길이 96
    slot_limit: int                          # SLOT_PLACES_LIMIT
    max_load: int
    over_limit_slots: list[int]


class AdminScheduleUserPatch(BaseModel):
    """회원 스케줄 수동 조정."""
    verify_frequency: Literal["daily", "every3d", "every5d", "weekly", "paused"] | None = None
    verify_slot_15m: int | None = Field(default=None, ge=0, le=95)


class AdminScheduleRebalanceIn(BaseModel):
    """리밸런스 옵션."""
    target_max: int = Field(default=80, ge=1, le=10000)
    max_passes: int = Field(default=3, ge=1, le=20)
    dry_run: bool = False


class AdminScheduleRebalanceOut(BaseModel):
    before_max: int
    after_max: int
    moved: int
    passes: int
    target_max: int
    dry_run: bool
    plan: list[dict]
