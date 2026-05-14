"""RankTracker (솔루션 #5) API — Excel 업로드 + place_id 자동 매칭 + 일별 순위 이력 조회."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.core.time_utils import now_kst
from app.models.place import RegisteredPlace
from app.models.rank_history import PlaceRankHistory
from app.models.user import User
from app.schemas.rank_tracker import (
    ConfirmCandidateRequest,
    DongChangedItem,
    DongChangedListOut,
    LatestRankCell,
    LatestRanksResponse,
    RankHistoryPoint,
    RankHistoryResponse,
    RankHistorySeries,
    RankPlaceCandidate,
    RankPlaceListOut,
    RankPlaceOut,
    RankUploadRequest,
    RankUploadResponse,
    RankUploadRowResult,
    RunMatchRequest,
    RunMatchResponse,
    RunRankCheckResponse,
)
from app.services.place_matcher import (
    deserialize_candidates,
    deserialize_match,
    match_one,
    serialize_match,
)
from app.services.rank_checker import run_rank_check_for_places

from .deps import get_current_user, require_superadmin

log = logging.getLogger(__name__)

router = APIRouter(prefix="/rank-tracker", tags=["rank-tracker"])


# ─────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────
_PHONE_RE = re.compile(r"^070-\d{3,4}-\d{4}$")


def _normalize_phone(p: str) -> str:
    """다양한 입력을 070-XXXX-XXXX 형식으로 정규화."""
    digits = re.sub(r"\D+", "", p or "")
    if len(digits) == 11 and digits.startswith("070"):
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10 and digits.startswith("070"):
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return (p or "").strip()


def _keywords_to_csv(keywords: list[str]) -> str:
    return ",".join(k.strip() for k in keywords if k and k.strip())[:500]


def _csv_to_keywords(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()]


def _place_to_out(p: RegisteredPlace) -> RankPlaceOut:
    """RegisteredPlace → API 응답. 070+동 정책에선 매칭된 단일 플레이스만 노출."""
    m = deserialize_match(p.match_candidates)
    matched: RankPlaceCandidate | None = None
    if m:
        matched = RankPlaceCandidate(
            place_id=str(m.get("place_id") or ""),
            name=str(m.get("name") or ""),
            category=str(m.get("category") or ""),
            phone=str(m.get("phone") or ""),
            virtual_phone=str(m.get("virtual_phone") or ""),
            address=str(m.get("address") or ""),
            reasons=list(m.get("reasons") or []),
        )
    return RankPlaceOut(
        id=p.id,
        phone=p.phone,
        registered_dong=p.registered_dong,
        business_name=p.business_name,
        place_id=p.place_id,
        tracking_keywords=_csv_to_keywords(p.tracking_keywords),
        match_status=p.match_status,
        matched_at=p.matched_at,
        matched=matched,
        dong_changed=bool(getattr(p, "dong_changed", False)),
        actual_dong=getattr(p, "actual_dong", None),
    )


# ─────────────────────────────────────────────────────────
# 업로드 + 매칭 큐 적재
# ─────────────────────────────────────────────────────────
@router.post("/upload", response_model=RankUploadResponse)
async def upload_rank_rows(
    req: RankUploadRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RankUploadResponse:
    """엑셀 4컬럼(070전번 | 등록동 | 상호 | 추적키워드) 일괄 업로드 → 매칭 큐 적재.

    동작:
      · 기존 RegisteredPlace에 같은 phone이 있으면 등록동/상호/추적키워드 UPDATE
      · 없으면 새로 INSERT (match_status='PENDING_MATCH')
      · 모든 PENDING_MATCH 행은 백그라운드 매칭 워커가 즉시 처리
    """
    rows = req.rows or []
    if not rows:
        return RankUploadResponse(
            total=0, created=0, updated=0, skipped=0, errors=0, rows=[],
        )

    results: list[RankUploadRowResult] = []
    created = updated = skipped = errors = 0
    enqueue_ids: list[int] = []

    for idx, row in enumerate(rows):
        phone = _normalize_phone(row.phone)
        if not _PHONE_RE.match(phone):
            errors += 1
            results.append(RankUploadRowResult(
                row_index=idx,
                phone=row.phone,
                status="ERROR",
                message="070-XXXX-XXXX 형식이 아닙니다.",
            ))
            continue
        dong = (row.registered_dong or "").strip()
        biz = (row.business_name or "").strip()
        kw_csv = _keywords_to_csv(row.tracking_keywords or [])
        if not dong or not biz:
            errors += 1
            results.append(RankUploadRowResult(
                row_index=idx,
                phone=phone,
                status="ERROR",
                message="등록동 또는 상호가 비어 있습니다.",
            ))
            continue
        if not kw_csv:
            errors += 1
            results.append(RankUploadRowResult(
                row_index=idx,
                phone=phone,
                status="ERROR",
                message="추적 키워드가 1개 이상 필요합니다.",
            ))
            continue

        # 기존 행 검색
        q = await db.execute(
            select(RegisteredPlace).where(
                RegisteredPlace.user_id == user.id,
                RegisteredPlace.phone == phone,
            )
        )
        existing = q.scalar_one_or_none()
        if existing:
            existing.registered_dong = dong
            existing.business_name = biz
            existing.tracking_keywords = kw_csv
            # 이미 매칭된 상태면 굳이 재매칭 안 함.
            # 재매칭 대상: PENDING_MATCH / NEEDS_MANUAL / place_id 없음
            #             (레거시 NOT_FOUND/REVIEW_NEEDED는 백필되지만 보호용으로 함께 처리)
            should_rematch = (
                existing.match_status in (
                    None, "PENDING_MATCH", "NEEDS_MANUAL",
                    "REVIEW_NEEDED", "NOT_FOUND",  # 레거시 호환
                )
                or not existing.place_id
            )
            if should_rematch:
                existing.match_status = "PENDING_MATCH"
                existing.match_candidates = None
                existing.dong_changed = False
                existing.actual_dong = None
                enqueue_ids.append(existing.id)
            existing.in_latest_upload = True
            existing.excluded_at = None
            await db.flush()
            updated += 1
            results.append(RankUploadRowResult(
                row_index=idx,
                phone=phone,
                status="UPDATED",
                place_pk=existing.id,
            ))
        else:
            new = RegisteredPlace(
                user_id=user.id,
                phone=phone,
                registered_dong=dong,
                business_name=biz,
                tracking_keywords=kw_csv,
                match_status="PENDING_MATCH",
                in_latest_upload=True,
            )
            db.add(new)
            await db.flush()
            enqueue_ids.append(new.id)
            created += 1
            results.append(RankUploadRowResult(
                row_index=idx,
                phone=phone,
                status="CREATED",
                place_pk=new.id,
            ))

    await db.commit()

    if enqueue_ids:
        background_tasks.add_task(_run_matching_for_ids, user.id, enqueue_ids)

    return RankUploadResponse(
        total=len(rows),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
        rows=results,
    )


# ─────────────────────────────────────────────────────────
# 매칭 워커 (백그라운드 — BackgroundTasks)
# ─────────────────────────────────────────────────────────
async def _run_matching_for_ids(user_id: int, place_ids: list[int]) -> None:
    """주어진 RegisteredPlace ID 목록에 대해 place_matcher.match_one 순차 실행.

    정책 (070+동 단일 매칭):
      · 070 매칭 성공 → AUTO_MATCHED (등록동 다르면 dong_changed=True 플래그)
      · 070 매칭 0건 → NEEDS_MANUAL (이론상 거의 없음)
    """
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        for pid in place_ids:
            try:
                q = await db.execute(
                    select(RegisteredPlace).where(
                        RegisteredPlace.id == pid,
                        RegisteredPlace.user_id == user_id,
                    )
                )
                p = q.scalar_one_or_none()
                if not p:
                    continue
                result = await match_one(
                    phone_070=p.phone,
                    business_name=p.business_name or "",
                    registered_dong=p.registered_dong or "",
                )
                p.match_status = result.status
                # match_confidence는 레거시 호환용. AUTO_MATCHED=100, NEEDS_MANUAL=0
                p.match_confidence = 100 if result.status == "AUTO_MATCHED" else 0
                p.matched_at = now_kst()
                if result.place_id:
                    p.place_id = result.place_id
                p.match_candidates = serialize_match(result.matched) if result.matched else None
                p.dong_changed = bool(result.dong_changed)
                p.actual_dong = result.actual_dong
                await db.commit()
            except Exception as e:  # noqa: BLE001
                log.exception("matching worker failed for place_id=%s: %s", pid, e)
                await db.rollback()
                await asyncio.sleep(0.5)


# ─────────────────────────────────────────────────────────
# 매칭 결과 조회 (사용자)
# ─────────────────────────────────────────────────────────
@router.get("/places", response_model=RankPlaceListOut)
async def list_rank_places(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RankPlaceListOut:
    """현재 사용자의 RankTracker 대상 행 목록 + 매칭 상태별 요약.

    070+동 정책으로 단순화:
      · auto_matched   — 070 매칭 완료 (자동 확정)
      · dong_changed   — 그 중 등록동과 실제 노출동이 다른 케이스 (배너용)
      · needs_manual   — 070 매칭 0건 등 예외 (이론상 거의 0)
      · pending        — 매칭 대기
    """
    q = await db.execute(
        select(RegisteredPlace)
        .where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.tracking_keywords.is_not(None),
        )
        .order_by(RegisteredPlace.created_at.desc())
    )
    places = list(q.scalars().all())

    auto = sum(1 for p in places if p.match_status == "AUTO_MATCHED")
    needs_manual = sum(1 for p in places if p.match_status == "NEEDS_MANUAL")
    pending = sum(1 for p in places if p.match_status in (None, "PENDING_MATCH"))
    dong_changed_count = sum(
        1 for p in places
        if p.match_status == "AUTO_MATCHED" and bool(getattr(p, "dong_changed", False))
    )

    return RankPlaceListOut(
        total=len(places),
        auto_matched=auto,
        needs_manual=needs_manual,
        pending=pending,
        dong_changed_count=dong_changed_count,
        items=[_place_to_out(p) for p in places],
    )


# ─────────────────────────────────────────────────────────
# 매칭 재실행 (수동 트리거)
# ─────────────────────────────────────────────────────────
@router.post("/run-match", response_model=RunMatchResponse)
async def run_match(
    req: RunMatchRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RunMatchResponse:
    """매칭 재실행. place_ids 지정 시 그 행들만, 미지정 시 사용자의 미완료 매칭 전체.

    재매칭 대상: PENDING_MATCH / NEEDS_MANUAL
                (레거시 REVIEW_NEEDED/NOT_FOUND는 마이그레이션에서 NEEDS_MANUAL로 백필됨)
    """
    if req.place_ids:
        q = await db.execute(
            select(RegisteredPlace.id).where(
                RegisteredPlace.user_id == user.id,
                RegisteredPlace.id.in_(req.place_ids),
            )
        )
    else:
        q = await db.execute(
            select(RegisteredPlace.id).where(
                RegisteredPlace.user_id == user.id,
                RegisteredPlace.tracking_keywords.is_not(None),
                RegisteredPlace.match_status.in_(("PENDING_MATCH", "NEEDS_MANUAL")),
            )
        )
    ids = [row[0] for row in q.all()]
    if ids:
        background_tasks.add_task(_run_matching_for_ids, user.id, ids)
    return RunMatchResponse(
        requested=len(ids),
        processed=0,
        auto_matched=0,
        needs_manual=0,
        errors=0,
    )


# ─────────────────────────────────────────────────────────
# 변경 노출 배너 — 등록동 ≠ 실제 노출동인 행 목록 (대시보드 상단)
# ─────────────────────────────────────────────────────────
@router.get("/dong-changed", response_model=DongChangedListOut)
async def list_dong_changed(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DongChangedListOut:
    """변경 노출 N건 — 등록동과 실제 노출동이 다른 케이스 목록.

    대시보드 상단 배너에 "변경 노출 N건 발견" + 상세보기 테이블로 사용.
    070 매칭은 시스템이 자동 확정했으므로 사용자가 클릭할 액션은 없고,
    "내 가게 노출동이 바뀌었다"는 정보 노출만 한다.
    """
    q = await db.execute(
        select(RegisteredPlace)
        .where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.match_status == "AUTO_MATCHED",
            RegisteredPlace.dong_changed.is_(True),
        )
        .order_by(RegisteredPlace.matched_at.desc().nullslast())
    )
    rows = list(q.scalars().all())

    items: list[DongChangedItem] = []
    for p in rows:
        m = deserialize_match(p.match_candidates)
        items.append(DongChangedItem(
            id=p.id,
            phone=p.phone,
            business_name=p.business_name,
            registered_dong=p.registered_dong,
            actual_dong=p.actual_dong,
            place_id=p.place_id,
            address=str(m.get("address")) if m and m.get("address") else None,
        ))
    return DongChangedListOut(count=len(items), items=items)


# ─────────────────────────────────────────────────────────
# (Deprecated) 후보 확정 — 070+동 단일 매칭 정책에서는 사용 안 함
# ─────────────────────────────────────────────────────────
@router.post("/places/{place_pk}/confirm-candidate", deprecated=True)
async def confirm_candidate(
    place_pk: int,
    req: ConfirmCandidateRequest,
    user: User = Depends(get_current_user),  # noqa: ARG001
    db: AsyncSession = Depends(get_db),  # noqa: ARG001
) -> dict[str, str]:
    """[DEPRECATED] 후보 확정 엔드포인트.

    070+동 정책 도입 후 단일 매칭으로 단순화되어 사용자가 후보를 고를 일이 없다.
    구버전 클라이언트 호환을 위해 410 Gone 응답만 반환한다.
    """
    raise HTTPException(
        status_code=410,
        detail=(
            "후보 확정 엔드포인트는 폐기되었습니다. "
            "070 매칭은 시스템이 자동 확정하며, 변경 노출은 대시보드 배너로 안내됩니다."
        ),
    )


# ─────────────────────────────────────────────────────────
# 순위 이력 조회
# ─────────────────────────────────────────────────────────
@router.get("/history/{place_pk}", response_model=RankHistoryResponse)
async def get_rank_history(
    place_pk: int,
    days: int = 30,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RankHistoryResponse:
    """특정 행의 최근 N일(기본 30) 키워드별 순위 추이."""
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_pk,
            RegisteredPlace.user_id == user.id,
        )
    )
    p = q.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "place not found")

    today = now_kst().date()
    since = today - timedelta(days=max(1, min(180, days)) - 1)

    hist_q = await db.execute(
        select(PlaceRankHistory)
        .where(
            PlaceRankHistory.place_pk == place_pk,
            PlaceRankHistory.check_date >= since,
        )
        .order_by(PlaceRankHistory.keyword.asc(), PlaceRankHistory.check_date.asc())
    )
    histories = list(hist_q.scalars().all())

    grouped: dict[str, list[PlaceRankHistory]] = {}
    for h in histories:
        grouped.setdefault(h.keyword, []).append(h)

    series_list: list[RankHistorySeries] = []
    for kw, items in grouped.items():
        series_list.append(RankHistorySeries(
            keyword=kw,
            points=[
                RankHistoryPoint(
                    check_date=it.check_date,
                    rank=it.rank,
                    out_of_range=it.out_of_range,
                    rank_delta=it.rank_delta,
                    total_results=it.total_results,
                )
                for it in items
            ],
        ))

    return RankHistoryResponse(
        place_pk=p.id,
        business_name=p.business_name,
        registered_dong=p.registered_dong,
        series=series_list,
    )


# ─────────────────────────────────────────────────────────
# 매트릭스용 벌크 — 모든 (place_pk, keyword)의 최신 순위 한 방에 반환
# ─────────────────────────────────────────────────────────
@router.get("/latest-ranks", response_model=LatestRanksResponse)
async def list_latest_ranks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LatestRanksResponse:
    """프론트 매트릭스용 — DB 한 번 조회로 (place_pk, keyword) 별 최신 순위 반환.

    - 네이버 검색 호출 없음 (PlaceRankHistory에서 SELECT만)
    - 매트릭스가 296×N 번 /history 호출하던 패턴을 1회 호출로 치환
    - 아직 순위 기록이 없는 (place, keyword) 조합은 rank=None 으로 채워서 반환
    """
    # 1) 사용자의 등록 플레이스 + 추적 키워드 로드
    q_places = await db.execute(
        select(RegisteredPlace)
        .where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.match_status == "AUTO_MATCHED",
            RegisteredPlace.place_id.is_not(None),
            RegisteredPlace.tracking_keywords.is_not(None),
        )
    )
    places = list(q_places.scalars().all())
    if not places:
        return LatestRanksResponse(count=0, cells=[])

    place_ids = [p.id for p in places]

    # 2) 해당 플레이스들의 최근 N일 히스토리 (최근 7일이면 충분)
    today = now_kst().date()
    since = today - timedelta(days=7)

    hist_q = await db.execute(
        select(PlaceRankHistory)
        .where(
            PlaceRankHistory.place_pk.in_(place_ids),
            PlaceRankHistory.check_date >= since,
        )
        .order_by(PlaceRankHistory.check_date.desc())
    )
    histories = list(hist_q.scalars().all())

    # 3) (place_pk, keyword) → 가장 최근 1건만 보관
    latest: dict[tuple[int, str], PlaceRankHistory] = {}
    for h in histories:
        key = (h.place_pk, h.keyword)
        if key not in latest:
            latest[key] = h

    # 4) 모든 (place × tracked_keyword) 조합으로 셀 채움 (기록 없으면 rank=None)
    cells: list[LatestRankCell] = []
    for p in places:
        kws = _csv_to_keywords(p.tracking_keywords)
        for kw in kws:
            h = latest.get((p.id, kw))
            if h is None:
                cells.append(LatestRankCell(
                    place_pk=p.id,
                    keyword=kw,
                    rank=None,
                    out_of_range=False,
                    check_date=None,
                ))
            else:
                cells.append(LatestRankCell(
                    place_pk=p.id,
                    keyword=kw,
                    rank=h.rank,
                    out_of_range=bool(h.out_of_range),
                    check_date=h.check_date,
                ))

    return LatestRanksResponse(count=len(cells), cells=cells)


# ─────────────────────────────────────────────────────────
# 수동 일일 배치 트리거 (관리자)
# ─────────────────────────────────────────────────────────
@router.post("/run-rank-check", response_model=RunRankCheckResponse)
async def trigger_rank_check_now(
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_superadmin),  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
) -> RunRankCheckResponse:
    """관리자 전용 — 전체 등록 회원의 일일 순위 체크를 즉시 실행 (백그라운드).

    현재 정책: 자동 배치(systemd timer)는 비활성. 운영자가 본 엔드포인트로
    매일 자동체크를 수동 트리거하여 모든 매칭 완료 회원의 추적 키워드를 일괄 체크한다.
    """
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.match_status.in_(("AUTO_MATCHED", "CONFIRMED")),
            RegisteredPlace.place_id.is_not(None),
            RegisteredPlace.tracking_keywords.is_not(None),
        )
    )
    places = list(q.scalars().all())
    started = len(places)

    async def _run() -> None:
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as worker_db:
            try:
                await run_rank_check_for_places(worker_db, places)
            except Exception as e:  # noqa: BLE001
                log.exception("manual rank-check failed: %s", e)

    background_tasks.add_task(_run)
    return RunRankCheckResponse(
        started=started,
        skipped_unmatched=0,
        message=f"{started}개 대상으로 백그라운드 실행 시작",
    )
