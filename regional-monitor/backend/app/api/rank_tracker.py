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
    match_one,
    serialize_candidates,
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
    cand_data = deserialize_candidates(p.match_candidates)
    candidates = [
        RankPlaceCandidate(
            place_id=str(c.get("place_id") or ""),
            name=str(c.get("name") or ""),
            category=str(c.get("category") or ""),
            phone=str(c.get("phone") or ""),
            virtual_phone=str(c.get("virtual_phone") or ""),
            address=str(c.get("address") or ""),
            score=int(c.get("score") or 0),
            reasons=list(c.get("reasons") or []),
        )
        for c in cand_data
    ]
    return RankPlaceOut(
        id=p.id,
        phone=p.phone,
        registered_dong=p.registered_dong,
        business_name=p.business_name,
        place_id=p.place_id,
        tracking_keywords=_csv_to_keywords(p.tracking_keywords),
        match_status=p.match_status,
        match_confidence=p.match_confidence,
        matched_at=p.matched_at,
        candidates=candidates,
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
            # 이미 매칭된 상태면 굳이 재매칭 안 함 (NOT_FOUND/REVIEW_NEEDED/None만 재시도)
            should_rematch = (
                existing.match_status in (None, "PENDING_MATCH", "NOT_FOUND", "REVIEW_NEEDED")
                or not existing.place_id
            )
            if should_rematch:
                existing.match_status = "PENDING_MATCH"
                existing.match_candidates = None
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
    """주어진 RegisteredPlace ID 목록에 대해 place_matcher.match_one 순차 실행."""
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
                p.match_confidence = result.confidence
                p.matched_at = now_kst()
                if result.place_id:
                    p.place_id = result.place_id
                p.match_candidates = serialize_candidates(result.candidates) if result.candidates else None
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
    """현재 사용자의 RankTracker 대상 행 목록 + 매칭 상태별 요약."""
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
    review = sum(1 for p in places if p.match_status == "REVIEW_NEEDED")
    notfound = sum(1 for p in places if p.match_status == "NOT_FOUND")
    pending = sum(1 for p in places if p.match_status in (None, "PENDING_MATCH"))
    confirmed = sum(1 for p in places if p.match_status == "CONFIRMED")

    return RankPlaceListOut(
        total=len(places),
        auto_matched=auto,
        review_needed=review,
        not_found=notfound,
        pending=pending,
        confirmed=confirmed,
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
    """매칭 재실행. place_ids 지정 시 그 행들만, 미지정 시 사용자의 PENDING_MATCH 전체."""
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
                RegisteredPlace.match_status.in_(("PENDING_MATCH", "NOT_FOUND", "REVIEW_NEEDED")),
            )
        )
    ids = [row[0] for row in q.all()]
    if ids:
        background_tasks.add_task(_run_matching_for_ids, user.id, ids)
    return RunMatchResponse(
        requested=len(ids),
        processed=0,
        auto_matched=0,
        review_needed=0,
        not_found=0,
        errors=0,
    )


# ─────────────────────────────────────────────────────────
# REVIEW_NEEDED 행의 후보 확정 (수동 선택)
# ─────────────────────────────────────────────────────────
@router.post("/places/{place_pk}/confirm-candidate")
async def confirm_candidate(
    place_pk: int,
    req: ConfirmCandidateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """REVIEW_NEEDED 행에서 사용자가 후보 1개를 확정."""
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_pk,
            RegisteredPlace.user_id == user.id,
        )
    )
    p = q.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "place not found")

    cand_data = deserialize_candidates(p.match_candidates)
    matched = next((c for c in cand_data if str(c.get("place_id")) == req.place_id), None)
    if not matched:
        raise HTTPException(400, "후보 목록에 없는 place_id 입니다.")

    p.place_id = req.place_id
    p.match_status = "CONFIRMED"
    p.match_confidence = int(matched.get("score") or 0)
    p.matched_at = now_kst()
    await db.commit()
    return {"status": "ok"}


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
# 수동 일일 배치 트리거 (관리자)
# ─────────────────────────────────────────────────────────
@router.post("/run-rank-check", response_model=RunRankCheckResponse)
async def trigger_rank_check_now(
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_superadmin),  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
) -> RunRankCheckResponse:
    """관리자 전용 — 전체 등록 회원의 일일 순위 체크를 즉시 실행 (백그라운드).

    실제 잡은 systemd timer가 매일 새벽 2시 KST에 자동 실행.
    수동 트리거는 운영/디버깅용.
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
