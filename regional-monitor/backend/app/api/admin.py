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
    AdminScheduleUserRow,
    AdminScheduleSummary,
    AdminScheduleListOut,
    AdminScheduleHeatmapCell,
    AdminScheduleHeatmapOut,
    AdminScheduleUserPatch,
    AdminScheduleRebalanceIn,
    AdminScheduleRebalanceOut,
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

    plan_changed = False
    if body.plan is not None:
        plan_changed = (u.plan != body.plan)
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
        # 슈퍼어드민으로 승격되면 자동 검증을 즉시 영구 정지
        if body.is_superadmin:
            u.verify_frequency = "paused"
    if body.name is not None:
        u.name = body.name.strip()
    if body.email is not None:
        new_email = body.email.strip().lower()
        if not new_email or "@" not in new_email:
            raise HTTPException(400, "유효한 이메일 형식이 아닙니다.")
        if new_email != (u.email or "").lower():
            # 중복 검사
            dup = (await db.execute(
                select(User).where(User.email == new_email, User.id != u.id)
            )).scalar_one_or_none()
            if dup:
                raise HTTPException(409, f"이미 사용 중인 이메일입니다: {new_email}")
            u.email = new_email
    if body.company is not None:
        u.company = body.company.strip() or None

    # 플랜이 바뀌면 자동 검증 주기도 새 플랜의 기본값으로 갱신.
    # ("항상 자동" 정책 — 회원이 paused 로 직접 바꿨으면 그건 보존되도록 overwrite=False)
    # 단, 슈퍼어드민은 apply_default_schedule 내부에서 paused 강제됨.
    if plan_changed:
        from app.services.schedule_assigner import apply_default_schedule
        await apply_default_schedule(db, u, overwrite=False)

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



# ──────────────────────────────────────────────────────────────
# 자동 검증 스케줄 v2 (슈퍼어드민 전용)
# ──────────────────────────────────────────────────────────────

@router.get("/schedule/users", response_model=AdminScheduleListOut)
async def list_schedule_users(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(default=None, description="이름/이메일/회사 부분일치"),
    plan: str | None = Query(default=None),
    frequency: str | None = Query(default=None, description="daily/every3d/every5d/weekly/paused"),
    only_with_places: bool = Query(default=False),
    sort: Literal["slot", "places", "frequency", "last_run"] = Query(default="slot"),
    limit: int = Query(default=2000, ge=1, le=5000),
) -> AdminScheduleListOut:
    """전 회원 자동 검증 스케줄 목록 + 요약."""
    from app.services.schedule_assigner import (
        SLOT_COUNT_15M,
        SLOT_PLACES_LIMIT,
        FREQUENCY_INTERVAL_SEC,
        slot_index_to_label,
        is_due_for_run,
    )
    import time as _time

    from app.models.verify_schedule_log import VerifyScheduleLog

    base = select(User)
    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(User.email.ilike(like), User.name.ilike(like), User.company.ilike(like)))
    if plan:
        filters.append(User.plan == plan)
    if frequency:
        filters.append(User.verify_frequency == frequency)
    if filters:
        base = base.where(*filters)

    rows = (await db.execute(base.limit(limit))).scalars().all()

    # place_count 일괄 조회
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

    if only_with_places:
        rows = [u for u in rows if pc_map.get(u.id, 0) > 0]

    # verify_schedule_log 24시간 집계 (skipped_manual 카운트)
    skipped_manual_map: dict[int, int] = {}
    if rows:
        since = now_kst() - timedelta(hours=24)
        sm_q = await db.execute(
            select(VerifyScheduleLog.user_id, func.count(VerifyScheduleLog.id))
            .where(VerifyScheduleLog.user_id.in_([u.id for u in rows]))
            .where(VerifyScheduleLog.status == "skipped_manual")
            .where(VerifyScheduleLog.scheduled_at >= since)
            .group_by(VerifyScheduleLog.user_id)
        )
        skipped_manual_map = {int(uid): int(c) for uid, c in sm_q.all()}

    # 행 구성
    now_dt = now_kst()
    now_ts = now_dt.timestamp()
    items: list[AdminScheduleUserRow] = []
    for u in rows:
        freq = u.verify_frequency or "every3d"
        slot = int(u.verify_slot_15m or 0)
        slot = max(0, min(SLOT_COUNT_15M - 1, slot))
        interval = FREQUENCY_INTERVAL_SEC.get(freq, FREQUENCY_INTERVAL_SEC["every3d"])
        next_due = None
        if u.last_auto_run_at is not None and freq != "paused":
            next_due = u.last_auto_run_at + timedelta(seconds=interval)
        due_now, _ = is_due_for_run(u, now_ts=now_ts)
        items.append(AdminScheduleUserRow(
            user_id=u.id,
            email=u.email,
            name=u.name,
            company=u.company,
            plan=u.plan,
            is_active=u.is_active,
            verify_frequency=freq,
            verify_slot_15m=slot,
            verify_slot_label=slot_index_to_label(slot),
            place_count=pc_map.get(u.id, 0),
            last_auto_run_at=u.last_auto_run_at,
            next_due_at=next_due,
            is_due_now=due_now,
            skipped_manual_24h=skipped_manual_map.get(u.id, 0),
        ))

    # 정렬
    if sort == "slot":
        items.sort(key=lambda x: (x.verify_slot_15m, -x.place_count))
    elif sort == "places":
        items.sort(key=lambda x: x.place_count, reverse=True)
    elif sort == "frequency":
        order = {"daily": 0, "every3d": 1, "every5d": 2, "weekly": 3, "paused": 4}
        items.sort(key=lambda x: (order.get(x.verify_frequency, 9), x.verify_slot_15m))
    elif sort == "last_run":
        items.sort(
            key=lambda x: (x.last_auto_run_at or datetime(1970, 1, 1, tzinfo=KST)),
        )

    # 요약
    by_freq: dict[str, int] = {}
    paused_n = 0
    for it in items:
        by_freq[it.verify_frequency] = by_freq.get(it.verify_frequency, 0) + 1
        if it.verify_frequency == "paused":
            paused_n += 1

    # 슬롯 부하(활성·!paused 만)
    slot_load: dict[int, int] = {i: 0 for i in range(SLOT_COUNT_15M)}
    active_users_n = 0
    for it in items:
        if not it.is_active or it.verify_frequency == "paused":
            continue
        active_users_n += 1
        slot_load[it.verify_slot_15m] = slot_load.get(it.verify_slot_15m, 0) + it.place_count
    loads = list(slot_load.values())
    max_load = max(loads) if loads else 0
    avg_load = (sum(loads) / len(loads)) if loads else 0.0
    over_n = sum(1 for v in loads if v > SLOT_PLACES_LIMIT)

    # 24시간 verify_schedule_log 전체 status 집계 (요약 카드용)
    since_24h = now_kst() - timedelta(hours=24)
    status_q = await db.execute(
        select(VerifyScheduleLog.status, func.count(VerifyScheduleLog.id))
        .where(VerifyScheduleLog.scheduled_at >= since_24h)
        .group_by(VerifyScheduleLog.status)
    )
    status_counts = {str(s): int(c) for s, c in status_q.all()}
    skipped_manual_total = status_counts.get("skipped_manual", 0)
    executed_total = status_counts.get("executed", 0)
    dry_run_total = status_counts.get("dry_run_recorded", 0)
    skipped_manual_users = sum(1 for v in skipped_manual_map.values() if v > 0)

    summary = AdminScheduleSummary(
        users_total=active_users_n,
        users_paused=paused_n,
        places_total=sum(it.place_count for it in items),
        slot_max_load=max_load,
        slot_avg_load=round(avg_load, 2),
        slot_over_limit=over_n,
        by_frequency=by_freq,
        skipped_manual_24h=skipped_manual_total,
        skipped_manual_users_24h=skipped_manual_users,
        executed_24h=executed_total,
        dry_run_recorded_24h=dry_run_total,
    )
    return AdminScheduleListOut(summary=summary, items=items)


@router.get("/schedule/heatmap", response_model=AdminScheduleHeatmapOut)
async def get_schedule_heatmap(db: AsyncSession = Depends(get_db)) -> AdminScheduleHeatmapOut:
    """96 슬롯 부하 히트맵 (회원 수 + 등록 합계)."""
    from app.services.schedule_assigner import (
        SLOT_COUNT_15M,
        SLOT_PLACES_LIMIT,
        slot_index_to_label,
    )

    # 활성 + paused 아닌 회원만
    user_q = await db.execute(
        select(User.verify_slot_15m, func.count(User.id))
        .where(User.is_active.is_(True))
        .where(User.verify_frequency != "paused")
        .group_by(User.verify_slot_15m)
    )
    user_map: dict[int, int] = {i: 0 for i in range(SLOT_COUNT_15M)}
    for slot, cnt in user_q.all():
        idx = max(0, min(SLOT_COUNT_15M - 1, int(slot or 0)))
        user_map[idx] += int(cnt or 0)

    place_q = await db.execute(
        select(User.verify_slot_15m, func.count(RegisteredPlace.id))
        .join(RegisteredPlace, RegisteredPlace.user_id == User.id)
        .where(User.is_active.is_(True))
        .where(User.verify_frequency != "paused")
        .group_by(User.verify_slot_15m)
    )
    place_map: dict[int, int] = {i: 0 for i in range(SLOT_COUNT_15M)}
    for slot, cnt in place_q.all():
        idx = max(0, min(SLOT_COUNT_15M - 1, int(slot or 0)))
        place_map[idx] += int(cnt or 0)

    cells = [
        AdminScheduleHeatmapCell(
            slot=i,
            label=slot_index_to_label(i),
            user_count=user_map[i],
            place_count=place_map[i],
        )
        for i in range(SLOT_COUNT_15M)
    ]
    max_load = max(place_map.values()) if place_map else 0
    over = [i for i, v in place_map.items() if v > SLOT_PLACES_LIMIT]
    return AdminScheduleHeatmapOut(
        cells=cells,
        slot_limit=SLOT_PLACES_LIMIT,
        max_load=max_load,
        over_limit_slots=over,
    )


@router.patch("/schedule/users/{user_id}", response_model=AdminScheduleUserRow)
async def update_schedule_user(
    user_id: int,
    body: AdminScheduleUserPatch,
    db: AsyncSession = Depends(get_db),
) -> AdminScheduleUserRow:
    """회원 1명의 frequency / slot 수동 조정 (paused 토글 포함)."""
    from app.services.schedule_assigner import (
        SLOT_COUNT_15M,
        FREQUENCY_INTERVAL_SEC,
        slot_index_to_label,
        is_due_for_run,
        is_valid_frequency,
    )

    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "사용자를 찾을 수 없습니다.")

    # 슈퍼어드민은 자동 검증 대상에서 영구 제외 — frequency 는 항상 'paused' 강제
    if u.is_superadmin:
        if u.verify_frequency != "paused":
            u.verify_frequency = "paused"
            await db.commit()
            await db.refresh(u)
        raise HTTPException(
            400,
            "슈퍼어드민 계정은 자동 검증 대상에서 영구 제외됩니다(paused 고정).",
        )

    if body.verify_frequency is not None:
        if not is_valid_frequency(body.verify_frequency):
            raise HTTPException(400, f"유효하지 않은 verify_frequency: {body.verify_frequency}")
        u.verify_frequency = body.verify_frequency
    if body.verify_slot_15m is not None:
        slot = max(0, min(SLOT_COUNT_15M - 1, int(body.verify_slot_15m)))
        u.verify_slot_15m = slot
        u.verify_slot = slot // 4   # 호환

    await db.commit()
    await db.refresh(u)

    pc = (await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user_id)
    )).scalar_one()

    now_ts = now_kst().timestamp()
    interval = FREQUENCY_INTERVAL_SEC.get(u.verify_frequency or "every3d", FREQUENCY_INTERVAL_SEC["every3d"])
    next_due = None
    if u.last_auto_run_at is not None and (u.verify_frequency or "") != "paused":
        next_due = u.last_auto_run_at + timedelta(seconds=interval)
    due_now, _ = is_due_for_run(u, now_ts=now_ts)

    slot_idx = int(u.verify_slot_15m or 0)
    return AdminScheduleUserRow(
        user_id=u.id,
        email=u.email,
        name=u.name,
        company=u.company,
        plan=u.plan,
        is_active=u.is_active,
        verify_frequency=u.verify_frequency or "every3d",
        verify_slot_15m=slot_idx,
        verify_slot_label=slot_index_to_label(slot_idx),
        place_count=int(pc),
        last_auto_run_at=u.last_auto_run_at,
        next_due_at=next_due,
        is_due_now=due_now,
    )


@router.post("/schedule/rebalance", response_model=AdminScheduleRebalanceOut)
async def rebalance_schedule(
    body: AdminScheduleRebalanceIn,
    db: AsyncSession = Depends(get_db),
) -> AdminScheduleRebalanceOut:
    """슬롯당 등록 합계가 target_max 를 넘는 경우 자동 리밸런스.

    dry_run=True 면 이동 계획만 반환하고 실제 변경하지 않음.
    """
    from app.services.schedule_assigner import rebalance_all_users

    result = await rebalance_all_users(
        db,
        target_max=body.target_max,
        max_passes=body.max_passes,
        dry_run=body.dry_run,
    )
    if not body.dry_run:
        await db.commit()

    return AdminScheduleRebalanceOut(
        before_max=int(result["before_max"]),
        after_max=int(result["after_max"]),
        moved=int(result["moved"]),
        passes=int(result["passes"]),
        target_max=int(result["target_max"]),
        dry_run=bool(result["dry_run"]),
        plan=result["plan"],
    )


__all__ = ["router"]
