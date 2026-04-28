"""변경 이벤트 (ChangeEvent) 조회 API.

자동 검증 스케줄러가 노출 상태 변경(노출 상실/지역 변경/상호 변경/페이지 삭제 등)을
감지할 때마다 ChangeEvent 가 INSERT 된다. 이 라우터는 그 이력을 사용자별로 조회.

엔드포인트:
  GET /api/v1/events           — 내 변경 이력 (최근 N건, 미열람 우선)
  GET /api/v1/events/unread    — 미열람 카운트 (TopBar 종 배지용)
  POST /api/v1/events/mark-read — 모두 읽음 처리 (마지막 조회 시각 갱신)
  GET /api/v1/scheduler/status — 다음 자동 검증 시각
"""
from __future__ import annotations

from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models.check import ChangeEvent, VerificationRun
from app.models.place import RegisteredPlace
from app.models.user import User
from app.services.scheduler import KST, get_next_run_at
from .deps import get_current_user


router = APIRouter(tags=["events"])


# ─────────────── 스키마 ───────────────


class ChangeEventOut(BaseModel):
    id: int
    place_id_ref: int
    phone: str                # join 결과
    business_name: str        # join 결과
    event_type: str           # EXPOSURE_LOST / DONG_CHANGED / NAME_CHANGED / REGION_CHANGED / PAGE_DELETED / RECOVERED / OTHER_CHANGED
    severity: Literal["danger", "warning", "info"]
    prev_verdict: str
    new_verdict: str
    summary: str
    detected_at: datetime

    class Config:
        from_attributes = True


class EventListOut(BaseModel):
    items: list[ChangeEventOut]
    total: int


class UnreadCountOut(BaseModel):
    unread: int
    last_read_at: datetime | None


class SchedulerStatusOut(BaseModel):
    next_run_at: datetime | None       # 다음 실행 시각 (KST, timezone-aware)
    verify_slot: int                   # 0~23, 사용자가 배정받은 시각 (KST 기준)
    verify_slot_label: str             # "매일 03:00 (KST)" 같은 사람용 라벨
    timezone: str = "Asia/Seoul (KST, UTC+9)"


# ─────────────── 유틸 ───────────────


_SEVERITY_MAP: dict[str, Literal["danger", "warning", "info"]] = {
    "PAGE_DELETED":   "danger",
    "EXPOSURE_LOST":  "danger",
    "REGION_CHANGED": "danger",
    "DONG_CHANGED":   "warning",
    "NAME_CHANGED":   "warning",
    "OTHER_CHANGED":  "info",
    "RECOVERED":      "info",
}


# ─────────────── 라우트 ───────────────


@router.get("/events", response_model=EventListOut)
async def list_my_events(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventListOut:
    """내 등록 070들에서 발생한 변경 이벤트 목록 (최신순)."""
    # 내 RegisteredPlace.id 추출
    q_pids = await db.execute(
        select(RegisteredPlace.id, RegisteredPlace.phone, RegisteredPlace.business_name)
        .where(RegisteredPlace.user_id == user.id)
    )
    place_rows = q_pids.all()
    if not place_rows:
        return EventListOut(items=[], total=0)

    pid_meta = {pid: (phone, name) for pid, phone, name in place_rows}
    pids = list(pid_meta.keys())

    q = await db.execute(
        select(ChangeEvent)
        .where(ChangeEvent.place_id_ref.in_(pids))
        .order_by(ChangeEvent.detected_at.desc())
        .limit(limit)
    )
    events = list(q.scalars().all())

    # 전체 카운트 (limit 무관)
    q_total = await db.execute(
        select(func.count(ChangeEvent.id)).where(ChangeEvent.place_id_ref.in_(pids))
    )
    total = int(q_total.scalar() or 0)

    items = []
    for e in events:
        phone, name = pid_meta.get(e.place_id_ref, ("?", "?"))
        items.append(ChangeEventOut(
            id=e.id,
            place_id_ref=e.place_id_ref,
            phone=phone,
            business_name=name,
            event_type=e.event_type,
            severity=_SEVERITY_MAP.get(e.event_type, "info"),
            prev_verdict=e.prev_verdict,
            new_verdict=e.new_verdict,
            summary=e.summary,
            detected_at=e.detected_at,
        ))

    return EventListOut(items=items, total=total)


@router.get("/events/unread", response_model=UnreadCountOut)
async def get_unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UnreadCountOut:
    """TopBar 종 아이콘 배지용 — 마지막 열람 시각 이후 발생한 이벤트 수.

    Phase 1 단순화: User.last_login_at 을 last_read_at 대용으로 사용.
    Phase 2에서 별도 last_events_read_at 컬럼 추가 예정.
    """
    last_read = user.last_login_at

    # 내 places
    q_pids = await db.execute(
        select(RegisteredPlace.id).where(RegisteredPlace.user_id == user.id)
    )
    pids = [row[0] for row in q_pids.all()]
    if not pids:
        return UnreadCountOut(unread=0, last_read_at=last_read)

    where = [ChangeEvent.place_id_ref.in_(pids)]
    if last_read:
        where.append(ChangeEvent.detected_at > last_read)

    q = await db.execute(select(func.count(ChangeEvent.id)).where(and_(*where)))
    return UnreadCountOut(
        unread=int(q.scalar() or 0),
        last_read_at=last_read,
    )


@router.post("/events/mark-read")
async def mark_events_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """모두 읽음 처리 (단순히 last_login_at 을 갱신)."""
    user.last_login_at = now_kst()
    await db.commit()
    return {"ok": True, "last_read_at": user.last_login_at}


@router.get("/scheduler/status", response_model=SchedulerStatusOut)
async def scheduler_status(
    user: User = Depends(get_current_user),
) -> SchedulerStatusOut:
    """내 검증 슬롯 + 다음 자동 검증 시각 (마이페이지/Home 노출용).

    모든 시각은 한국 표준시(KST, UTC+9) 기준.
    """
    next_run = get_next_run_at()
    # APScheduler 가 timezone-aware datetime 을 반환하므로 KST 로 변환
    if next_run is not None and next_run.tzinfo is not None:
        next_run = next_run.astimezone(KST)

    return SchedulerStatusOut(
        next_run_at=next_run,
        verify_slot=user.verify_slot,
        verify_slot_label=f"매일 {user.verify_slot:02d}:00 (KST)",
    )


# ──────────────────────────────────────────────────────────────
# 자동검증 회차별 요약 (History 페이지)
# ──────────────────────────────────────────────────────────────


class VerificationRunOut(BaseModel):
    id: int
    trigger: str               # 'scheduler' | 'manual'
    mode: str                  # 'fast' | 'full'
    slot_hour: int             # 0~23 (스케줄러), -1 (수동)
    total_count: int
    ok_count: int
    dead_count: int
    pending_count: int
    events_count: int
    elapsed_ms: int
    started_at: datetime

    class Config:
        from_attributes = True


class VerificationRunListOut(BaseModel):
    items: list[VerificationRunOut]
    total: int


@router.get("/verification-runs", response_model=VerificationRunListOut)
async def list_verification_runs(
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerificationRunListOut:
    """내 자동검증 회차 목록 (최근순).

    History 페이지에서 회차별 요약 카드를 표시하기 위한 데이터.
    `trigger='scheduler'` = 자동, `trigger='manual'` = 사용자 직접 실행.
    """
    q = await db.execute(
        select(VerificationRun)
        .where(VerificationRun.user_id == user.id)
        .order_by(VerificationRun.started_at.desc())
        .limit(limit)
    )
    runs = list(q.scalars().all())

    cnt_q = await db.execute(
        select(func.count(VerificationRun.id))
        .where(VerificationRun.user_id == user.id)
    )
    total = int(cnt_q.scalar_one() or 0)

    return VerificationRunListOut(
        items=[VerificationRunOut.model_validate(r) for r in runs],
        total=total,
    )
