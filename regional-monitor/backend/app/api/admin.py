"""어드민 라우터 — /api/v1/admin/*

모든 엔드포인트는 require_superadmin 가드를 통과해야 한다.
일반 사용자가 호출 시 403.

엔드포인트:
  GET    /admin/stats                — 대시보드 통계
  GET    /admin/users                — 사용자 목록(검색/필터/페이징)
  GET    /admin/users/{id}           — 사용자 상세
  PATCH  /admin/users/{id}           — 플랜/quota/차단 변경
  DELETE /admin/users/{id}           — 사용자 + 모든 데이터 영구 삭제
  GET    /admin/payments             — 결제 목록(필터)
  POST   /admin/payments             — 어드민 수동 결제/플랜 부여
  PATCH  /admin/payments/{id}        — 결제 상태 변경(환불 등)
"""
from __future__ import annotations

from datetime import datetime, timedelta
from app.core.time_utils import now_kst, to_kst, KST
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models.user import User
from app.models.place import RegisteredPlace
from app.models.check import ChangeEvent, DailyHealthCheck
from app.models.payment import Payment
from app.schemas.admin import (
    AdminUserOut,
    AdminUserListOut,
    AdminUserPatch,
    AdminPaymentOut,
    AdminPaymentListOut,
    AdminPaymentCreate,
    AdminPaymentPatch,
    AdminStatsOut,
    AdminMonitorOut,
    AdminMonitorRow,
    AdminMonitorSummary,
)
from app.schemas.common import MessageResponse
from .deps import require_superadmin


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])


# ──────────────────────────────────────────────────────────────
# 대시보드 통계
# ──────────────────────────────────────────────────────────────

@router.get("/stats", response_model=AdminStatsOut)
async def get_stats(db: AsyncSession = Depends(get_db)) -> AdminStatsOut:
    """어드민 대시보드 — 전체 시스템 통계."""
    # 사용자
    users_total = (await db.execute(select(func.count(User.id)))).scalar_one()
    users_active = (await db.execute(
        select(func.count(User.id)).where(User.is_active.is_(True))
    )).scalar_one()
    users_blocked = users_total - users_active

    # 플랜별
    plan_q = await db.execute(
        select(User.plan, func.count(User.id)).group_by(User.plan)
    )
    users_by_plan = {p: int(c) for p, c in plan_q.all()}

    # 등록 / 이벤트
    places_total = (await db.execute(select(func.count(RegisteredPlace.id)))).scalar_one()
    events_total = (await db.execute(select(func.count(ChangeEvent.id)))).scalar_one()
    # 시스템 차원 "최근 24시간 신규 변경 이벤트" — admin 가시성용
    yesterday_24h = now_kst() - timedelta(hours=24)
    events_unread = (await db.execute(
        select(func.count(ChangeEvent.id)).where(ChangeEvent.detected_at >= yesterday_24h)
    )).scalar_one()

    # 결제
    payments_total = (await db.execute(select(func.count(Payment.id)))).scalar_one()
    revenue_q = await db.execute(
        select(func.coalesce(func.sum(Payment.amount_krw), 0))
        .where(Payment.status == "paid")
    )
    revenue_paid_krw = int(revenue_q.scalar_one())

    # 검증 활동
    yesterday = now_kst() - timedelta(hours=24)
    last_24h_checks = (await db.execute(
        select(func.count(DailyHealthCheck.id))
        .where(DailyHealthCheck.checked_at >= yesterday)
    )).scalar_one()

    return AdminStatsOut(
        users_total=int(users_total),
        users_active=int(users_active),
        users_blocked=int(users_blocked),
        users_by_plan=users_by_plan,
        places_total=int(places_total),
        events_total=int(events_total),
        events_unread=int(events_unread),
        payments_total=int(payments_total),
        revenue_paid_krw=revenue_paid_krw,
        last_24h_checks=int(last_24h_checks),
    )


# ──────────────────────────────────────────────────────────────
# 사용자 관리
# ──────────────────────────────────────────────────────────────

@router.get("/users/monitor", response_model=AdminMonitorOut)
async def users_monitor(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(default=None, description="이메일/이름/업체명 부분 일치"),
    plan: str | None = Query(default=None),
    only_with_places: bool = Query(
        default=False,
        description="True면 등록건수 ≥ 1 인 회원만 반환",
    ),
    sort: Literal["places", "dead", "mismatch", "pending", "recent"] = "places",
    limit: int = Query(default=500, ge=1, le=2000),
) -> AdminMonitorOut:
    """슈퍼어드민 — 전 회원의 등록·검증상태 요약.

    회원 1명 = 1행:
        회원명 / 업체명 / 회원등급 / 등록갯수 / 정상노출 / 페이지삭제 / 불일치 (+ 검증대기)

    내부 구현 — 쿼리 2회로 압축:
      1) User 검색 + 페이지네이션
      2) registered_places 의 (user_id, current_verdict) 그룹 카운트
    """
    # ── 1) User 목록 ───────────────────────────────────────────
    user_q = select(User)
    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(
            User.email.ilike(like),
            User.name.ilike(like),
            User.company.ilike(like),
        ))
    if plan:
        filters.append(User.plan == plan)
    if filters:
        user_q = user_q.where(*filters)
    user_q = user_q.order_by(desc(User.created_at)).limit(limit)
    users = (await db.execute(user_q)).scalars().all()

    if not users:
        return AdminMonitorOut(
            summary=AdminMonitorSummary(
                users_total=0, users_with_places=0, places_total=0,
                ok_total=0, dead_total=0, mismatch_total=0, pending_total=0,
            ),
            items=[],
        )

    user_ids = [u.id for u in users]

    # ── 2) 검증상태 분포 — 한 쿼리로 모두 ─────────────────────
    verdict_q = await db.execute(
        select(
            RegisteredPlace.user_id,
            RegisteredPlace.current_verdict,
            func.count(RegisteredPlace.id),
        )
        .where(RegisteredPlace.user_id.in_(user_ids))
        .group_by(RegisteredPlace.user_id, RegisteredPlace.current_verdict)
    )

    # user_id → {ok, dead, mismatch, pending, total}
    bucket: dict[int, dict[str, int]] = {}
    for uid, verdict, cnt in verdict_q.all():
        b = bucket.setdefault(uid, {
            "ok": 0, "dead": 0, "mismatch": 0, "pending": 0, "total": 0,
        })
        v = (verdict or "").upper()
        # 'VerdictKind.OK' enum repr 도 안전 처리
        if v.endswith("OK"):
            b["ok"] += int(cnt)
        elif v.endswith("DEAD"):
            b["dead"] += int(cnt)
        elif v.endswith("PENDING"):
            b["pending"] += int(cnt)
        elif v.endswith(("PHONE_MISMATCH", "DONG_MISMATCH",
                         "NAME_MISMATCH", "REGION_MISMATCH")):
            b["mismatch"] += int(cnt)
        else:
            # 알 수 없는 verdict 도 mismatch 로 보수적 분류 (UI 누락 방지)
            b["mismatch"] += int(cnt)
        b["total"] += int(cnt)

    # ── 3) 회원 행 구성 ──────────────────────────────────────
    items: list[AdminMonitorRow] = []
    for u in users:
        b = bucket.get(u.id, {})
        place_count = int(b.get("total", 0))
        if only_with_places and place_count == 0:
            continue
        items.append(AdminMonitorRow(
            user_id=u.id,
            email=u.email,
            name=u.name,
            company=u.company,
            plan=u.plan,
            is_active=u.is_active,
            is_superadmin=u.is_superadmin,
            place_count=place_count,
            ok_count=int(b.get("ok", 0)),
            dead_count=int(b.get("dead", 0)),
            mismatch_count=int(b.get("mismatch", 0)),
            pending_count=int(b.get("pending", 0)),
            last_login_at=u.last_login_at,
            created_at=u.created_at,
        ))

    # ── 4) 정렬 ──────────────────────────────────────────────
    if sort == "places":
        items.sort(key=lambda x: x.place_count, reverse=True)
    elif sort == "dead":
        items.sort(key=lambda x: x.dead_count, reverse=True)
    elif sort == "mismatch":
        items.sort(key=lambda x: x.mismatch_count, reverse=True)
    elif sort == "pending":
        items.sort(key=lambda x: x.pending_count, reverse=True)
    # 'recent' 는 이미 created_at desc 로 정렬됨

    # ── 5) 합계 ──────────────────────────────────────────────
    summary = AdminMonitorSummary(
        users_total=len(users),
        users_with_places=sum(1 for it in items if it.place_count > 0),
        places_total=sum(it.place_count for it in items),
        ok_total=sum(it.ok_count for it in items),
        dead_total=sum(it.dead_count for it in items),
        mismatch_total=sum(it.mismatch_count for it in items),
        pending_total=sum(it.pending_count for it in items),
    )

    return AdminMonitorOut(summary=summary, items=items)


@router.get("/users", response_model=AdminUserListOut)
async def list_users(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(default=None, description="이메일/이름/회사 부분 일치 검색"),
    plan: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    is_superadmin: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    sort: Literal["recent", "oldest", "email", "places"] = "recent",
) -> AdminUserListOut:
    """사용자 목록 — 검색 / 플랜 / 활성여부 / 관리자 필터 + 페이지네이션."""
    base = select(User)
    count_base = select(func.count(User.id))

    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(
            User.email.ilike(like),
            User.name.ilike(like),
            User.company.ilike(like),
        ))
    if plan:
        filters.append(User.plan == plan)
    if is_active is not None:
        filters.append(User.is_active.is_(is_active))
    if is_superadmin is not None:
        filters.append(User.is_superadmin.is_(is_superadmin))

    if filters:
        base = base.where(*filters)
        count_base = count_base.where(*filters)

    # 정렬
    if sort == "recent":
        base = base.order_by(desc(User.created_at))
    elif sort == "oldest":
        base = base.order_by(User.created_at.asc())
    elif sort == "email":
        base = base.order_by(User.email.asc())
    # 'places' 정렬은 place_count 가 별도 쿼리이므로 메모리 정렬 (아래)

    total = (await db.execute(count_base)).scalar_one()
    rows = (await db.execute(base.limit(limit).offset(offset))).scalars().all()

    # place_count 한 번에 조회
    if rows:
        ids = [u.id for u in rows]
        pc_q = await db.execute(
            select(RegisteredPlace.user_id, func.count(RegisteredPlace.id))
            .where(RegisteredPlace.user_id.in_(ids))
            .group_by(RegisteredPlace.user_id)
        )
        pc_map = {uid: int(c) for uid, c in pc_q.all()}
    else:
        pc_map = {}

    items = []
    for u in rows:
        items.append(AdminUserOut(
            id=u.id, email=u.email, name=u.name,
            phone=u.phone, company=u.company,
            plan=u.plan, quota_places=u.quota_places,
            is_profile_complete=u.is_profile_complete,
            is_superadmin=u.is_superadmin,
            is_active=u.is_active,
            blocked_reason=u.blocked_reason,
            verify_slot=u.verify_slot,
            place_count=pc_map.get(u.id, 0),
            last_login_at=u.last_login_at,
            created_at=u.created_at,
        ))

    if sort == "places":
        items.sort(key=lambda x: x.place_count, reverse=True)

    return AdminUserListOut(total=int(total), items=items)


@router.get("/users/{user_id}", response_model=AdminUserOut)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")
    pc = (await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user_id)
    )).scalar_one()
    return AdminUserOut(
        id=u.id, email=u.email, name=u.name,
        phone=u.phone, company=u.company,
        plan=u.plan, quota_places=u.quota_places,
        is_profile_complete=u.is_profile_complete,
        is_superadmin=u.is_superadmin,
        is_active=u.is_active,
        blocked_reason=u.blocked_reason,
        verify_slot=u.verify_slot,
        place_count=int(pc),
        last_login_at=u.last_login_at,
        created_at=u.created_at,
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: int,
    body: AdminUserPatch,
    me: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    """사용자 정보 변경 — 플랜/quota/차단/관리자 권한.

    안전장치:
      - 자기 자신의 is_superadmin 을 끄지 못하게 (lockout 방지)
      - 자기 자신을 차단(is_active=False) 하지 못하게
    """
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")

    if u.id == me.id and body.is_superadmin is False:
        raise HTTPException(400, "자기 자신의 관리자 권한은 해제할 수 없습니다.")
    if u.id == me.id and body.is_active is False:
        raise HTTPException(400, "자기 자신을 차단할 수 없습니다.")

    if body.plan is not None:
        u.plan = body.plan
        # 플랜에 맞는 quota 자동 (어드민이 명시적으로 quota_places 도 보냈으면 그게 우선)
        DEFAULT_QUOTA = {"free": 5, "basic": 50, "pro": 500, "enterprise": 10000}
        if body.quota_places is None:
            u.quota_places = DEFAULT_QUOTA.get(body.plan, u.quota_places)
    if body.quota_places is not None:
        u.quota_places = body.quota_places
    if body.is_active is not None:
        u.is_active = body.is_active
        if body.is_active:
            u.blocked_reason = None
    if body.blocked_reason is not None:
        u.blocked_reason = body.blocked_reason or None
    if body.is_superadmin is not None:
        u.is_superadmin = body.is_superadmin
    if body.name is not None:
        u.name = body.name

    await db.commit()
    await db.refresh(u)

    pc = (await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user_id)
    )).scalar_one()
    return AdminUserOut(
        id=u.id, email=u.email, name=u.name,
        phone=u.phone, company=u.company,
        plan=u.plan, quota_places=u.quota_places,
        is_profile_complete=u.is_profile_complete,
        is_superadmin=u.is_superadmin,
        is_active=u.is_active,
        blocked_reason=u.blocked_reason,
        verify_slot=u.verify_slot,
        place_count=int(pc),
        last_login_at=u.last_login_at,
        created_at=u.created_at,
    )


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: int,
    me: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """사용자 + 그 사용자의 모든 데이터(등록/이벤트/검증이력/결제) 영구 삭제.

    cascade 가 모델에 설정되어 있다면 한 번에, 아니면 명시적으로 정리.
    """
    if user_id == me.id:
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다.")
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")

    # 외래키 cascade 가 없을 수 있으니 안전하게 직접 삭제
    place_ids = [
        pid for (pid,) in (await db.execute(
            select(RegisteredPlace.id).where(RegisteredPlace.user_id == user_id)
        )).all()
    ]
    if place_ids:
        from sqlalchemy import delete
        await db.execute(delete(DailyHealthCheck).where(DailyHealthCheck.place_id_ref.in_(place_ids)))
        await db.execute(delete(ChangeEvent).where(ChangeEvent.place_id_ref.in_(place_ids)))
        await db.execute(delete(RegisteredPlace).where(RegisteredPlace.id.in_(place_ids)))
    from sqlalchemy import delete
    await db.execute(delete(Payment).where(Payment.user_id == user_id))
    await db.delete(u)
    await db.commit()

    return MessageResponse(message=f"사용자 #{user_id} 가 모든 데이터와 함께 삭제되었습니다.")


# ──────────────────────────────────────────────────────────────
# 결제 관리
# ──────────────────────────────────────────────────────────────

@router.get("/payments", response_model=AdminPaymentListOut)
async def list_payments(
    db: AsyncSession = Depends(get_db),
    user_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    plan: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AdminPaymentListOut:
    base = select(Payment)
    count_base = select(func.count(Payment.id))
    filters = []
    if user_id is not None:
        filters.append(Payment.user_id == user_id)
    if status_filter:
        filters.append(Payment.status == status_filter)
    if plan:
        filters.append(Payment.plan == plan)
    if filters:
        base = base.where(*filters)
        count_base = count_base.where(*filters)

    total = (await db.execute(count_base)).scalar_one()
    rows = (await db.execute(
        base.order_by(desc(Payment.created_at)).limit(limit).offset(offset)
    )).scalars().all()

    # 사용자 매핑
    if rows:
        uids = list({p.user_id for p in rows})
        users_q = await db.execute(select(User.id, User.email, User.name).where(User.id.in_(uids)))
        umap = {uid: (em, nm) for uid, em, nm in users_q.all()}
    else:
        umap = {}

    items = []
    for p in rows:
        em, nm = umap.get(p.user_id, (None, None))
        items.append(AdminPaymentOut(
            id=p.id, user_id=p.user_id,
            user_email=em, user_name=nm,
            plan=p.plan, amount_krw=p.amount_krw, currency=p.currency,
            status=p.status, method=p.method, gateway=p.gateway,
            gateway_tx_id=p.gateway_tx_id, memo=p.memo,
            period_start=p.period_start, period_end=p.period_end,
            created_at=p.created_at, paid_at=p.paid_at, refunded_at=p.refunded_at,
        ))

    return AdminPaymentListOut(total=int(total), items=items)


@router.post("/payments", response_model=AdminPaymentOut, status_code=201)
async def create_payment(
    body: AdminPaymentCreate,
    db: AsyncSession = Depends(get_db),
) -> AdminPaymentOut:
    """어드민이 수동으로 결제 레코드 생성. apply_plan_to_user=True 면 user.plan 도 업데이트."""
    u = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "대상 사용자를 찾을 수 없습니다.")

    now = now_kst()
    period_end = now + timedelta(days=body.period_days)

    p = Payment(
        user_id=body.user_id,
        plan=body.plan,
        amount_krw=body.amount_krw,
        currency="KRW",
        status="paid" if body.mark_paid else "pending",
        method=body.method,
        gateway=body.gateway,
        gateway_tx_id=body.gateway_tx_id,
        memo=body.memo,
        period_start=now,
        period_end=period_end,
        paid_at=now if body.mark_paid else None,
    )
    db.add(p)

    if body.apply_plan_to_user:
        DEFAULT_QUOTA = {"free": 5, "basic": 50, "pro": 500, "enterprise": 10000}
        u.plan = body.plan
        u.quota_places = DEFAULT_QUOTA.get(body.plan, u.quota_places)

    await db.commit()
    await db.refresh(p)

    return AdminPaymentOut(
        id=p.id, user_id=p.user_id,
        user_email=u.email, user_name=u.name,
        plan=p.plan, amount_krw=p.amount_krw, currency=p.currency,
        status=p.status, method=p.method, gateway=p.gateway,
        gateway_tx_id=p.gateway_tx_id, memo=p.memo,
        period_start=p.period_start, period_end=p.period_end,
        created_at=p.created_at, paid_at=p.paid_at, refunded_at=p.refunded_at,
    )


@router.patch("/payments/{payment_id}", response_model=AdminPaymentOut)
async def update_payment(
    payment_id: int,
    body: AdminPaymentPatch,
    db: AsyncSession = Depends(get_db),
) -> AdminPaymentOut:
    p = (await db.execute(select(Payment).where(Payment.id == payment_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "결제를 찾을 수 없습니다.")

    if body.status is not None:
        prev = p.status
        p.status = body.status
        now = now_kst()
        if body.status == "paid" and prev != "paid":
            p.paid_at = now
        if body.status == "refunded" and prev != "refunded":
            p.refunded_at = now
    if body.memo is not None:
        p.memo = body.memo

    await db.commit()
    await db.refresh(p)

    u = (await db.execute(select(User).where(User.id == p.user_id))).scalar_one_or_none()
    em = u.email if u else None
    nm = u.name if u else None

    return AdminPaymentOut(
        id=p.id, user_id=p.user_id,
        user_email=em, user_name=nm,
        plan=p.plan, amount_krw=p.amount_krw, currency=p.currency,
        status=p.status, method=p.method, gateway=p.gateway,
        gateway_tx_id=p.gateway_tx_id, memo=p.memo,
        period_start=p.period_start, period_end=p.period_end,
        created_at=p.created_at, paid_at=p.paid_at, refunded_at=p.refunded_at,
    )


__all__ = ["router"]
