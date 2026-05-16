"""RankTracker (솔루션 #5) API — Excel 업로드 + place_id 자동 매칭 + 일별 순위 이력 조회."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.core.time_utils import now_kst
from app.models.place import RegisteredPlace
from app.models.rank_history import PlaceRankHistory
from app.models.user import User
from app.schemas.rank_tracker import (
    BulkKeywordsRequest,
    BulkKeywordsResponse,
    CompetitionItem,
    CompetitionResponse,
    ConfirmCandidateRequest,
    ConfirmPlaceIdRequest,
    ConfirmPlaceIdResponse,
    DongChangedItem,
    DongChangedListOut,
    LatestRankCell,
    LatestRanksResponse,
    RankCheckProgress,
    RankHistoryPoint,
    ResetAllResponse,
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
    ManualRankCheckRequest,
    ManualRankCheckResponse,
    UpdateKeywordsRequest,
    UpdateKeywordsResponse,
)
from app.services.place_matcher import (
    MatchCandidate,
    deserialize_candidates,
    deserialize_match,
    match_one,
    serialize_match,
)
from app.services.naver_map import search_map
from app.services.rank_checker import run_rank_check_for_places

from .deps import get_current_user, require_superadmin

log = logging.getLogger(__name__)

router = APIRouter(prefix="/rank-tracker", tags=["rank-tracker"])


# ─────────────────────────────────────────────────────────
# Phase 7 — 사용자별 "수동 검증 실행 중" 플래그 (in-memory)
# ─────────────────────────────────────────────────────────
# 사용자가 '지금 검증' 을 누르면 백그라운드 워커가 분 단위로 돌지만,
# 기존엔 POST 응답이 즉시 돌아와서 프론트의 manualChecking 이 곧바로 false 가
# 되어 사용자가 중복 클릭으로 동일 job 을 여러 번 띄울 수 있었다.
#
# 본 딕셔너리는 사용자별로 "지금 백그라운드에서 검증중인 잡이 있는지"를
# 단순 기록한다. /progress 응답에 그대로 노출되며, /manual-rank-check 는
# 이 값이 set 되어 있으면 409 로 거절한다.
#
# 프로세스 재시작 시 자연 초기화됨 (workers 도 함께 죽으므로 일관성 유지).
# 멀티프로세스 환경이라면 Redis 로 옮겨야 하지만, 현재는 uvicorn 1워커이므로
# 메모리 dict 로 충분.
_user_rank_busy: dict[int, dict[str, object]] = {}


def _mark_rank_busy(user_id: int, started: int, label: str = "manual") -> None:
    """`started` = 이번 잡에 투입된 RegisteredPlace 개수.
    label 은 후일 다른 트리거(스케줄러 등) 와 구분이 필요할 때 사용.
    """
    _user_rank_busy[user_id] = {
        "started_at": now_kst().isoformat(),
        "started": int(started),
        "label": label,
    }


def _clear_rank_busy(user_id: int) -> None:
    _user_rank_busy.pop(user_id, None)


def _get_rank_busy(user_id: int) -> dict[str, object] | None:
    return _user_rank_busy.get(user_id)


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
    keywords = _csv_to_keywords(p.tracking_keywords)
    return RankPlaceOut(
        id=p.id,
        phone=p.phone,
        registered_dong=p.registered_dong,
        business_name=p.business_name,
        place_id=p.place_id,
        tracking_keywords=keywords,
        match_status=p.match_status,
        matched_at=p.matched_at,
        matched=matched,
        dong_changed=bool(getattr(p, "dong_changed", False)),
        actual_dong=getattr(p, "actual_dong", None),
        has_keywords=bool(keywords),
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
    """주어진 RegisteredPlace ID 목록에 대해 place_matcher.match_one 을 동시 실행.

    정책 (070+동 단일 매칭):
      · 070 매칭 성공 → AUTO_MATCHED (등록동 다르면 dong_changed=True 플래그)
      · 070 매칭 0건 → NEEDS_MANUAL (이론상 거의 없음)

    이전: 순차 for 루프 (1건씩 처리) → 296건 매칭에 5분+
    개선: asyncio.Semaphore(MATCH_CONCURRENCY) + gather 동시 실행.
    각 worker 는 별도 DB 세션을 사용해 commit 충돌을 회피한다.

    매칭 완료 후, 새로 AUTO_MATCHED 된 행에 대해 자동으로 rank check 까지 실행하여
    업로드 직후 매트릭스에 순위가 바로 채워지도록 한다.
    """
    from app.core.database import AsyncSessionLocal

    if not place_ids:
        return

    # 매칭 동시성 — competition 솔루션의 CHUNK_CONCURRENCY=10 과 동등 수준.
    MATCH_CONCURRENCY = 8
    sem = asyncio.Semaphore(MATCH_CONCURRENCY)
    newly_auto_matched_ids: list[int] = []
    lock = asyncio.Lock()

    async def worker(pid: int) -> None:
        async with sem:
            # 워커마다 독립 세션 — 동시 commit 충돌 없이 폴링 가시성 유지.
            async with AsyncSessionLocal() as db:
                try:
                    q = await db.execute(
                        select(RegisteredPlace).where(
                            RegisteredPlace.id == pid,
                            RegisteredPlace.user_id == user_id,
                        )
                    )
                    p = q.scalar_one_or_none()
                    if not p:
                        return

                    # ★ A안+Y안: monitor가 이미 검증/추출해둔 place_id를 그대로 채택.
                    #   네이버 호출 0회 — rank-tracker는 매칭이 본질이 아니라 순위 파악이 본질.
                    #   monitor(노출관리 자동체크)와 rank-tracker(순위 자동체크)는 한 세트이므로
                    #   동일한 RegisteredPlace row 의 place_id 를 신뢰한다.
                    if p.place_id:
                        p.match_status = "AUTO_MATCHED"
                        p.match_confidence = 100  # 레거시 호환
                        p.matched_at = now_kst()
                        # UI 표시용 — monitor 가 채워둔 정보로 단일 매칭 결과 직렬화
                        p.match_candidates = json.dumps(
                            {
                                "place_id": p.place_id,
                                "name": p.business_name or "",
                                "category": p.category or "",
                                "phone": p.phone or "",
                                "virtual_phone": "",
                                "address": p.full_address or "",
                                "reasons": ["reused_from_monitor"],
                            },
                            ensure_ascii=False,
                        )
                        # dong_changed / actual_dong 는 monitor 검증 결과를 그대로 보존
                        await db.commit()
                        async with lock:
                            newly_auto_matched_ids.append(pid)
                        return

                    # monitor 가 아직 place_id 를 채우지 않은 행 — 자동 매칭 시도하지 않고
                    # NEEDS_MANUAL 로 표시 (C안: "monitor 에 먼저 등록해주세요" 안내).
                    # 프론트엔드는 NEEDS_MANUAL 행을 매트릭스에서 제외하고 안내 배너를 띄운다.
                    p.match_status = "NEEDS_MANUAL"
                    p.match_confidence = 0
                    p.matched_at = now_kst()
                    p.match_candidates = json.dumps(
                        {"error": "needs_monitor_registration"},
                        ensure_ascii=False,
                    )
                    await db.commit()
                except Exception as e:  # noqa: BLE001
                    log.exception("matching worker failed for place_id=%s: %s", pid, e)
                    try:
                        await db.rollback()
                    except Exception:  # noqa: BLE001
                        pass

    await asyncio.gather(*(worker(pid) for pid in place_ids))

    # 타지역 환경에서는 자동 순위 추적이 의미가 없어 비활성화.
    # 사용자가 명시적으로 POST /run-rank-check 를 호출해야 순위 검증이 실행된다.
    # (참고) newly_auto_matched_ids 는 통계/로그용으로만 보관.
    if newly_auto_matched_ids:
        log.info(
            "auto rank-check skipped (manual-only policy) for %d places: %s",
            len(newly_auto_matched_ids),
            newly_auto_matched_ids,
        )


async def _run_rank_check_for_ids(user_id: int, place_ids: list[int]) -> None:
    """주어진 RegisteredPlace ID들에 대해 rank_checker.run_rank_check_for_places 호출.

    [정책] 타지역 환경에서는 자동 순위 추적이 의미가 없어 자동 트리거를 모두 비활성화함.
    이 함수는 오직 수동 트리거 (POST /run-rank-check, POST /run-rank-check-ids) 에서만 호출된다.

    [Phase 5 - Fix B] places 조회용 세션과 rank-check 본체를 명확히 분리.
    이전엔 fetch 세션을 rank_check 본체에 넘겼다가 워커들이 동시 commit 하는 사이
    fetch 세션이 'prepared/closed' 상태로 어그러져 IllegalStateChangeError 가 났다.
    이제는 places 만 가져온 뒤 fetch 세션을 닫고, run_rank_check_for_places 는
    자체 워커 세션만 사용한다.
    """
    from app.core.database import AsyncSessionLocal

    # Phase 7 — 전체 워커 라이프사이클을 try/finally 로 감싸 busy 누수 방지.
    # 엔드포인트(_mark_rank_busy)와 워커 종료(_clear_rank_busy)의 짝을 보장한다.
    # fetch 단계에서 places=0 으로 조기 return 하더라도 finally 가 실행되므로 안전.
    try:
        # 1) places fetch 전용 세션 — 즉시 닫는다.
        async with AsyncSessionLocal() as fetch_db:
            q = await fetch_db.execute(
                select(RegisteredPlace).where(
                    RegisteredPlace.id.in_(place_ids),
                    RegisteredPlace.user_id == user_id,
                    RegisteredPlace.match_status == "AUTO_MATCHED",
                    RegisteredPlace.place_id.is_not(None),
                    RegisteredPlace.tracking_keywords.is_not(None),
                )
            )
            places = list(q.scalars().all())
            # NOTE: fetch_db 는 with 블록을 빠져나가면서 자동으로 닫힌다.

        if not places:
            log.info("auto rank-check no-op: user_id=%s places=0", user_id)
            return
        log.info(
            "auto rank-check starting: user_id=%s places=%d",
            user_id, len(places),
        )
        # 엔드포인트에서 이미 set 했지만, 직접 함수가 다른 경로로 호출될 가능성
        # (관리자 페이지 등) 을 대비해 동일 키로 갱신. 멱등 — 같은 데이터로 덮어씀.
        _mark_rank_busy(user_id, started=len(places), label="manual")
        # 2) rank_check 본체 — 자체 워커 세션만 사용. 외부 db 인자는 None.
        stats = await run_rank_check_for_places(None, places)
        log.info("auto rank-check done: user_id=%s stats=%s", user_id, stats)
    finally:
        # 정상/예외/early-return 모두 — 잡 종료 시 busy 해제 보장
        _clear_rank_busy(user_id)


# ─────────────────────────────────────────────────────────
# 매칭 결과 조회 (사용자)
# ─────────────────────────────────────────────────────────
@router.get("/places", response_model=RankPlaceListOut)
async def list_rank_places(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RankPlaceListOut:
    """현재 사용자의 RankTracker 대상 행 목록 + 매칭 상태별 요약.

    2단계 UX: monitor (노출관리 자동체크) 에 등록된 업체를 그대로 노출.
      · place_id 가 채워진 행은 monitor 가 검증한 업체 — rank-tracker 후보
      · tracking_keywords 가 있는 행은 이미 순위 추적 중
      · 둘 다 비어있으면 (legacy 잔여) 표시하지 않음

    상태 분류:
      · auto_matched     — AUTO_MATCHED (rank check 가능)
      · needs_manual     — 매우 예외적
      · pending          — 매칭 대기 (PENDING_MATCH)
      · no_keywords_count — monitor 에 등록되었지만 키워드 미입력 (인라인 등록 대상)
    """
    from sqlalchemy import or_, and_

    q = await db.execute(
        select(RegisteredPlace)
        .where(
            RegisteredPlace.user_id == user.id,
            or_(
                # monitor 가 검증한 업체 (place_id 있음)
                RegisteredPlace.place_id.is_not(None),
                # 또는 이미 키워드가 등록된 업체 (legacy 호환)
                and_(
                    RegisteredPlace.tracking_keywords.is_not(None),
                    RegisteredPlace.tracking_keywords != "",
                ),
            ),
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
    no_keywords_count = sum(
        1 for p in places
        if not _csv_to_keywords(p.tracking_keywords)
    )

    return RankPlaceListOut(
        total=len(places),
        auto_matched=auto,
        needs_manual=needs_manual,
        pending=pending,
        dong_changed_count=dong_changed_count,
        no_keywords_count=no_keywords_count,
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
# 추적 키워드 인라인 편집 (2단계 UX — 엑셀 업로드 대체)
# ─────────────────────────────────────────────────────────
@router.patch(
    "/places/{place_pk}/keywords",
    response_model=UpdateKeywordsResponse,
)
async def update_place_keywords(
    place_pk: int,
    req: UpdateKeywordsRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UpdateKeywordsResponse:
    """단일 업체의 추적 키워드 인라인 업데이트.

    monitor (노출관리 자동체크) 에 이미 등록된 RegisteredPlace 행에 대해
    추적 키워드만 추가/수정한다. 070/동/상호는 monitor 가 채워둔 값을 그대로 사용.

    동작:
      · monitor 가 검증해둔 place_id 있으면 → 즉시 AUTO_MATCHED + 백그라운드 rank check
      · monitor 검증 전(place_id 없음) → PENDING_MATCH 로 마킹 + 매칭 큐 적재
      · 빈 배열로 PATCH 하면 추적 해제 (tracking_keywords=NULL)
    """
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_pk,
            RegisteredPlace.user_id == user.id,
        )
    )
    p = q.scalar_one_or_none()
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 업체를 찾을 수 없습니다. (monitor 에 먼저 등록해주세요)",
        )

    # 중복 제거 + 공백 제거
    new_kws: list[str] = []
    for k in req.tracking_keywords or []:
        kk = (k or "").strip()
        if kk and kk not in new_kws:
            new_kws.append(kk)
    new_csv = _keywords_to_csv(new_kws)

    # 빈 배열 → 추적 해제
    if not new_kws:
        p.tracking_keywords = None
        # 매칭 상태는 그대로 두되, 매트릭스에서는 제외됨 (키워드 없음)
        await db.commit()
        return UpdateKeywordsResponse(
            place_pk=p.id,
            tracking_keywords=[],
            match_status=p.match_status,
            auto_matched=False,
            rank_check_enqueued=False,
        )

    # 키워드 업데이트
    p.tracking_keywords = new_csv

    # Y안 매칭 로직 인라인 — monitor 가 검증한 place_id 있으면 즉시 AUTO_MATCHED
    auto_matched = False
    rank_check_enqueued = False

    if p.place_id:
        p.match_status = "AUTO_MATCHED"
        p.match_confidence = 100
        p.matched_at = now_kst()
        p.match_candidates = json.dumps(
            {
                "place_id": p.place_id,
                "name": p.business_name or "",
                "category": p.category or "",
                "phone": p.phone or "",
                "virtual_phone": "",
                "address": p.full_address or "",
                "reasons": ["reused_from_monitor"],
            },
            ensure_ascii=False,
        )
        auto_matched = True
        await db.commit()
        # 자동 rank check 비활성화 (타지역 정책: 수동 검증만).
        # 사용자가 매트릭스의 "지금 검증" 또는 POST /run-rank-check 로 명시적으로 트리거해야 함.
        rank_check_enqueued = False
    else:
        # monitor 가 아직 검증 전 — 매칭 대기 큐로
        p.match_status = "PENDING_MATCH"
        p.matched_at = None
        p.match_candidates = None
        await db.commit()
        background_tasks.add_task(_run_matching_for_ids, user.id, [p.id])

    return UpdateKeywordsResponse(
        place_pk=p.id,
        tracking_keywords=new_kws,
        match_status=p.match_status,
        auto_matched=auto_matched,
        rank_check_enqueued=rank_check_enqueued,
    )


# ─────────────────────────────────────────────────────────
# 일괄 키워드 적용 (A안 — 한 번에 N건 동일 키워드 셋 적용)
# ─────────────────────────────────────────────────────────
def _extract_sido_from_address(addr: str | None) -> str:
    """full_address 의 첫 토큰(시도)을 추출.

    예: '전라남도 목포시 삼학동' -> '전라남도'
    """
    if not addr:
        return ""
    return addr.strip().split()[0] if addr.strip() else ""


@router.post(
    "/places/bulk-keywords",
    response_model=BulkKeywordsResponse,
)
async def bulk_apply_keywords(
    req: BulkKeywordsRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BulkKeywordsResponse:
    """N건의 등록 업체에 동일한 추적 키워드 셋을 한 번에 적용.

    monitor 에 등록된 RegisteredPlace 중 필터에 매칭되는 행 전체에
    같은 추적 키워드 셋을 1회 호출로 적용한다. (288건 일일이 클릭하는 비효율 해소)

    동작:
      · mode='replace' — 기존 tracking_keywords 를 새 셋으로 덮어쓰기
      · mode='append'  — 기존에 추가 (5개 한도 초과시 잘라냄, 중복 제거)
      · filter.only_no_keywords — True 면 미등록 행만 (안전)
      · filter.sido / business_name_contains — 추가 좁히기
      · place_id 가 있는 행 → 즉시 AUTO_MATCHED 마킹 (즉시 순위체크 가능)
      · place_id 가 없는 행 → PENDING_MATCH 로 매칭 큐 적재 (백그라운드)
      · 동일 키워드라 변화 없는 행 → skipped_no_change 로 집계
    """
    # 1) 입력 키워드 정규화 (중복/공백 제거 + 5개 한도)
    new_kws: list[str] = []
    for k in req.tracking_keywords or []:
        kk = (k or "").strip()
        if kk and kk not in new_kws:
            new_kws.append(kk)
        if len(new_kws) >= 5:
            break
    if not new_kws:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효한 추적 키워드가 1개 이상 필요합니다.",
        )

    # 2) 필터 적용한 RegisteredPlace 조회
    stmt = select(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
    if req.filter.only_no_keywords:
        # 키워드 없음 = NULL 또는 빈 문자열
        from sqlalchemy import or_
        stmt = stmt.where(
            or_(
                RegisteredPlace.tracking_keywords.is_(None),
                RegisteredPlace.tracking_keywords == "",
            )
        )
    if req.filter.business_name_contains:
        needle = req.filter.business_name_contains.strip()
        if needle:
            stmt = stmt.where(RegisteredPlace.business_name.ilike(f"%{needle}%"))

    q = await db.execute(stmt)
    candidates: list[RegisteredPlace] = list(q.scalars().all())

    # 시도 필터는 full_address 첫 토큰으로 — DB 인덱스 없으니 파이썬에서 필터
    if req.filter.sido:
        sido_needle = req.filter.sido.strip()
        candidates = [
            p for p in candidates
            if _extract_sido_from_address(p.full_address) == sido_needle
        ]

    total_matched = len(candidates)
    if total_matched == 0:
        return BulkKeywordsResponse(
            total_matched=0,
            updated=0,
            skipped_no_change=0,
            auto_matched=0,
            pending_match=0,
            sample_place_pks=[],
        )

    # 3) 행별로 새 키워드 셋 결정 (replace / append) + 업데이트
    updated = 0
    skipped_no_change = 0
    auto_matched_count = 0
    pending_match_count = 0
    pending_pks: list[int] = []
    sample_pks: list[int] = []

    for p in candidates:
        existing = _csv_to_keywords(p.tracking_keywords)

        if req.mode == "append":
            merged: list[str] = list(existing)
            for kw in new_kws:
                if kw not in merged:
                    merged.append(kw)
                if len(merged) >= 5:
                    break
            final_kws = merged
        else:  # replace
            final_kws = list(new_kws)

        # 변화 없음 → skip
        if final_kws == existing:
            skipped_no_change += 1
            continue

        p.tracking_keywords = _keywords_to_csv(final_kws)

        # 매칭 상태 갱신 — 단건 PATCH 와 동일한 로직
        if p.place_id:
            p.match_status = "AUTO_MATCHED"
            p.match_confidence = 100
            p.matched_at = now_kst()
            p.match_candidates = json.dumps(
                {
                    "place_id": p.place_id,
                    "name": p.business_name or "",
                    "category": p.category or "",
                    "phone": p.phone or "",
                    "virtual_phone": "",
                    "address": p.full_address or "",
                    "reasons": ["reused_from_monitor"],
                },
                ensure_ascii=False,
            )
            auto_matched_count += 1
        else:
            p.match_status = "PENDING_MATCH"
            p.matched_at = None
            p.match_candidates = None
            pending_pks.append(p.id)
            pending_match_count += 1

        updated += 1
        if len(sample_pks) < 10:
            sample_pks.append(p.id)

    await db.commit()

    # 4) PENDING_MATCH 행은 백그라운드 매칭 큐로 (덩어리째)
    if pending_pks:
        background_tasks.add_task(_run_matching_for_ids, user.id, pending_pks)

    return BulkKeywordsResponse(
        total_matched=total_matched,
        updated=updated,
        skipped_no_change=skipped_no_change,
        auto_matched=auto_matched_count,
        pending_match=pending_match_count,
        sample_place_pks=sample_pks,
    )


# ─────────────────────────────────────────────────────────
# 전체 초기화 — 사용자 본인의 데이터를 비우기 (재업로드 전)
# ─────────────────────────────────────────────────────────
@router.delete("/reset-all", response_model=ResetAllResponse)
async def reset_all_data(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResetAllResponse:
    """현재 사용자의 RankTracker **순위 데이터**만 초기화.

    🚨 중요: `registered_places` 테이블은 `/monitor` 페이지와 **공유**되는 테이블이다.
    따라서 DELETE 하면 안 되고, RankTracker 전용 컬럼만 NULL/False 로 리셋해야 한다.

    삭제 대상 (진짜 DELETE):
      · 본인 places 의 PlaceRankHistory 전체 (키워드별 일별 순위 이력 — 순위 전용)

    초기화 대상 (UPDATE → NULL/False, DELETE 금지):
      · tracking_keywords  : 추적 키워드 CSV
      · match_status       : AUTO_MATCHED / NEEDS_MANUAL / PENDING_MATCH
      · match_confidence   : 자동 매칭 신뢰도
      · match_candidates   : 후보 JSON
      · matched_at         : 매칭 시각
      · dong_changed       : 변경 노출 플래그
      · actual_dong        : 실제 노출 동

    보존 대상 (절대 건드리지 않음 — /monitor 등록 정보):
      · phone, place_id, registered_dong, business_name
      · full_address, category
      · current_verdict, last_checked_at
      · in_latest_upload, excluded_at, created_at, updated_at

    사용 시나리오:
      · 매칭/순위 결과가 꼬여서 다시 매칭하고 싶을 때
      · 다른 사용자 데이터에는 영향 없음 (user_id 필터)
    """
    # 1) 본인 place_pk 목록 확보 (PlaceRankHistory 삭제 대상 추출용)
    q_ids = await db.execute(
        select(RegisteredPlace.id).where(RegisteredPlace.user_id == user.id)
    )
    place_ids = [row[0] for row in q_ids.all()]

    deleted_history = 0
    if place_ids:
        # 2) PlaceRankHistory 삭제 (순위 이력 — 진짜 삭제 대상)
        res_hist = await db.execute(
            delete(PlaceRankHistory).where(
                PlaceRankHistory.place_pk.in_(place_ids)
            )
        )
        deleted_history = int(res_hist.rowcount or 0)

    # 3) RegisteredPlace 의 RankTracker 전용 컬럼만 NULL/False 로 초기화
    #    🛑 DELETE 금지 — /monitor 페이지가 같은 테이블을 사용하므로 등록 정보가 사라진다.
    res_place = await db.execute(
        update(RegisteredPlace)
        .where(RegisteredPlace.user_id == user.id)
        .values(
            tracking_keywords=None,
            match_confidence=None,
            match_status=None,
            match_candidates=None,
            matched_at=None,
            dong_changed=False,
            actual_dong=None,
        )
    )
    reset_places = int(res_place.rowcount or 0)

    await db.commit()

    log.info(
        "reset-all: user_id=%s reset_places=%d deleted_history=%d (places preserved, rank-only columns cleared)",
        user.id, reset_places, deleted_history,
    )

    return ResetAllResponse(
        reset_places=reset_places,
        deleted_history=deleted_history,
        message=(
            f"순위 데이터 초기화 완료 — 플레이스 {reset_places}건의 "
            f"추적 키워드/매칭 결과 초기화, 순위이력 {deleted_history}건 삭제 "
            f"(등록 플레이스 정보는 보존)"
        ),
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
# 수동 place_id 확정 — NEEDS_MANUAL 행을 유저가 직접 해결
# ─────────────────────────────────────────────────────────
@router.post(
    "/places/{place_pk}/confirm-place-id",
    response_model=ConfirmPlaceIdResponse,
)
async def confirm_place_id(
    place_pk: int,
    req: ConfirmPlaceIdRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConfirmPlaceIdResponse:
    """유저가 네이버에서 찾은 place_id 를 입력하면, 해당 페이지의 phone을
    검증한 뒤 NEEDS_MANUAL → AUTO_MATCHED 로 승격하고 즉시 rank check 시작.

    검증 절차:
      1) m.place.naver.com/place/{place_id}/home 페이지 fetch
      2) 페이지 alive (200 + dead 키워드 없음) 확인
      3) 페이지의 phone/virtual_phone 이 등록 070 과 일치하는지 확인
         · 일치 → AUTO_MATCHED 승격
         · 불일치 + force=False → 400 (유저에게 force 옵션 안내)
         · 불일치 + force=True  → AUTO_MATCHED 승격 (수동 강제)
      4) 승격되면 백그라운드로 rank check 트리거
    """
    import httpx
    from app.services.place_id_checker import check_place

    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_pk,
            RegisteredPlace.user_id == user.id,
        )
    )
    p = q.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "place not found")

    pid = req.place_id.strip()
    if not pid.isdigit():
        raise HTTPException(400, "place_id 는 숫자여야 합니다 (네이버 URL의 마지막 숫자 부분)")

    # 네이버 m.place 페이지 검증
    sample = {
        "place_id": pid,
        "phone": p.phone or "",
        "expected_dong": p.registered_dong or "",
        "expected_biz": p.business_name or "",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            check = await check_place(client, sample)
        except Exception as e:  # noqa: BLE001
            log.exception("confirm_place_id: check_place failed: %s", e)
            raise HTTPException(502, f"네이버 페이지 검증 실패: {type(e).__name__}")

    # 페이지 자체가 죽어있으면 거부
    if not check.place_alive or check.verdict == "DEAD":
        raise HTTPException(
            400,
            f"place_id={pid} 페이지가 존재하지 않습니다 (verdict={check.verdict}). "
            f"네이버에서 다시 확인해주세요.",
        )
    if check.verdict == "PENDING":
        raise HTTPException(
            503,
            f"네이버 일시 오류로 검증 불가 ({check.detail}). 잠시 후 다시 시도해주세요.",
        )

    # phone 일치 여부 판정
    target_norm = re.sub(r"\D+", "", p.phone or "")
    actual_norm = re.sub(r"\D+", "", check.actual_phone or "")
    phone_match = bool(target_norm) and (target_norm == actual_norm)

    if not phone_match and not req.force:
        # 유저에게 force 옵션 제시
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PHONE_MISMATCH",
                "message": (
                    f"입력한 place_id 의 전화번호({check.actual_phone or '없음'})가 "
                    f"등록 070({p.phone}) 과 일치하지 않습니다. "
                    f"그래도 이 place 가 맞다면 force=true 로 다시 요청해주세요."
                ),
                "actual_name": check.actual_name,
                "actual_phone": check.actual_phone,
                "actual_address": check.actual_address,
            },
        )

    # AUTO_MATCHED 로 승격
    p.place_id = pid
    p.match_status = "AUTO_MATCHED"
    p.match_confidence = 100 if phone_match else 50  # 강제 승격은 신뢰도 50
    p.matched_at = now_kst()

    reasons = ["manual_confirm"]
    if phone_match:
        reasons.append("phone_matched")
    else:
        reasons.append("forced_no_phone_match")

    matched = MatchCandidate(
        place_id=pid,
        name=check.actual_name or "",
        category=check.actual_category or "",
        phone=check.actual_phone or "",
        virtual_phone="",
        address=check.actual_address or "",
        reasons=reasons,
    )
    p.match_candidates = serialize_match(matched)

    # 등록동 변경 여부 체크
    dong_in_addr = (p.registered_dong or "").strip()
    addr_text = (check.actual_address or "")
    p.dong_changed = bool(dong_in_addr) and (dong_in_addr not in addr_text)
    if p.dong_changed:
        # 실제 노출동 추출 (간단 정규식)
        m_dong = re.search(r"([가-힣]{1,6}\d{0,2}동)(?![가-힣])", addr_text)
        p.actual_dong = m_dong.group(1) if m_dong else None
    else:
        p.actual_dong = None

    await db.commit()

    # 자동 rank check 비활성화 (타지역 정책: 수동 검증만).
    # 사용자가 매트릭스에서 명시적으로 "지금 검증"을 눌러야 순위가 채워진다.

    return ConfirmPlaceIdResponse(
        place_pk=place_pk,
        place_id=pid,
        status="AUTO_MATCHED",
        actual_name=check.actual_name or None,
        actual_phone=check.actual_phone or None,
        actual_address=check.actual_address or None,
        phone_match=phone_match,
        forced=(not phone_match and req.force),
        message=(
            "매칭이 확정되었습니다. '지금 검증'을 눌러 순위를 확인하세요."
            if phone_match else
            "전화번호 불일치를 우회하여 강제 매칭했습니다. '지금 검증'으로 결과를 확인하세요."
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
# 경쟁업체 스냅샷 — 모달에서 키워드 클릭 시
# ─────────────────────────────────────────────────────────
@router.get(
    "/competition/{place_pk}",
    response_model=CompetitionResponse,
)
async def get_competition(
    place_pk: int,
    keyword: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CompetitionResponse:
    """{등록동} {keyword} 검색 결과 1~75위 + 내 업체 강조.

    매트릭스 행 → PlaceDetailModal → 키워드 클릭 시 호출.
    네이버 m.map.naver.com 검색 결과를 그대로 반환하되, 호출자의 place_id
    위치를 is_me=True 로 마킹.
    """
    # 1) 사용자 소유 검증 + place 로드
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_pk,
            RegisteredPlace.user_id == user.id,
        )
    )
    place = q.scalar_one_or_none()
    if place is None:
        raise HTTPException(status_code=404, detail="place not found")

    dong = (place.registered_dong or "").strip()
    kw = (keyword or "").strip()
    if not dong or not kw:
        raise HTTPException(
            status_code=400,
            detail="registered_dong and keyword are required",
        )
    if kw not in _csv_to_keywords(place.tracking_keywords):
        # 사용자가 추적 중인 키워드만 허용 (악의적 임의 키워드 조회 방지)
        raise HTTPException(
            status_code=400,
            detail=f"keyword '{kw}' is not in tracking_keywords",
        )

    # 2) 네이버 검색 — rank_checker 와 동일한 쿼리 규칙
    from app.services.region_loader import lookup_region_by_dong

    parts: list[str] = []
    regions = lookup_region_by_dong(dong)
    if regions:
        sido, sigungu = regions[0]
        if sido:
            parts.append(sido)
        if sigungu:
            parts.append(sigungu)
    parts.append(dong)
    parts.append(kw)
    query = " ".join(parts)

    res = await search_map(query, display=75, client=None)
    if res.error:
        return CompetitionResponse(
            place_pk=place_pk,
            keyword=kw,
            query=query,
            my_place_id=place.place_id,
            my_rank=None,
            out_of_range=True,
            total_count=0,
            items=[],
            error=res.error,
        )

    my_pid = str(place.place_id) if place.place_id else None
    # 내 업체 행의 표시 상호 — 네이버 노출명은 카테고리에 따라 suffix("...견인운송",
    # "...심부름센터" 등) 가 붙어 변형되므로, 사용자가 등록한 business_name 으로
    # 덮어써서 모달 헤더 상호와 100% 일치시킨다. 매칭 기준은 어디까지나 place_id.
    my_display_name = (place.business_name or "").strip()
    my_rank: int | None = None
    items: list[CompetitionItem] = []
    for i, it in enumerate(res.items, start=1):
        pid = str(it.place_id or "")
        is_me = bool(my_pid and pid == my_pid)
        if is_me and my_rank is None:
            my_rank = i
        # is_me 행만 등록 상호로 표시. 나머지 경쟁업체는 네이버 노출명 그대로.
        row_name = my_display_name if (is_me and my_display_name) else (it.name or "")
        items.append(
            CompetitionItem(
                rank=i,
                place_id=pid,
                name=row_name,
                category=it.category or "",
                phone=it.phone or "",
                virtual_phone=it.virtual_phone or "",
                address=it.address or "",
                is_me=is_me,
            )
        )

    return CompetitionResponse(
        place_pk=place_pk,
        keyword=kw,
        query=query,
        my_place_id=my_pid,
        my_rank=my_rank,
        out_of_range=(my_rank is None),
        total_count=res.total_count,
        items=items,
    )


# ─────────────────────────────────────────────────────────
# 진행 상태 (업로드 직후 폴링용)
# ─────────────────────────────────────────────────────────
@router.get("/progress", response_model=RankCheckProgress)
async def get_rank_progress(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RankCheckProgress:
    """프론트 폴링용 — 현재 사용자의 매칭/순위체크 진행 상태 요약.

    in_progress=True 이면 프론트는 5초 간격으로 본 엔드포인트를 다시 호출하면서
    매트릭스를 새로고침한다. False 가 되면 폴링을 멈춘다.
    """
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.tracking_keywords.is_not(None),
        )
    )
    places = list(q.scalars().all())
    total_places = len(places)
    pending = sum(1 for p in places if p.match_status in (None, "PENDING_MATCH"))
    auto = sum(1 for p in places if p.match_status == "AUTO_MATCHED")
    needs_manual = sum(1 for p in places if p.match_status == "NEEDS_MANUAL")

    # AUTO_MATCHED 행의 (place × keyword) 셀 개수 계산
    total_cells = 0
    auto_place_ids: list[int] = []
    for p in places:
        if p.match_status == "AUTO_MATCHED" and p.place_id:
            kws = _csv_to_keywords(p.tracking_keywords)
            total_cells += len(kws)
            auto_place_ids.append(p.id)

    # 채워진 셀 — 최근 7일 내 PlaceRankHistory 기록이 있는 (place_pk, keyword)
    filled_cells = 0
    if auto_place_ids:
        today = now_kst().date()
        since = today - timedelta(days=7)
        hist_q = await db.execute(
            select(PlaceRankHistory.place_pk, PlaceRankHistory.keyword)
            .where(
                PlaceRankHistory.place_pk.in_(auto_place_ids),
                PlaceRankHistory.check_date >= since,
            )
            .distinct()
        )
        filled_cells = len(list(hist_q.all()))

    # Phase 5 - Fix A: 네이버 회로차단 상태 노출.
    # OPEN 상태에서 "지금 검증" 을 눌러도 모든 셀이 단락되므로 프론트가
    # 즉시 노란 배너로 안내해서 사용자 혼란을 줄인다.
    try:
        from app.services.naver_map import is_circuit_open as _ncb_is_open
        circuit_open = _ncb_is_open()
    except Exception:  # noqa: BLE001
        circuit_open = False

    # Phase 7 — 사용자별 "수동 검증 실행 중" 플래그.
    # /manual-rank-check 가 BackgroundTask 로 _run_rank_check_for_ids 를 호출하면
    # 그 워커가 시작과 동시에 _mark_rank_busy(user_id) 를 set, 종료/예외 시
    # try/finally 로 _clear_rank_busy(user_id). 그 사이 본 엔드포인트는
    # 항상 manual_running=True 를 반환하므로 프론트가 신뢰성 있게 버튼을 비활성화할 수 있다.
    busy = _get_rank_busy(user.id)
    manual_running = busy is not None
    manual_started = int(busy["started"]) if busy else 0
    manual_started_at = str(busy["started_at"]) if busy else None

    # 진행 중 판단:
    #   - 매칭 대기가 남아있거나
    #   - 수동 검증 잡이 실제로 실행 중인 경우
    #
    # Phase 7 New Issue (93% 무한 루프 fix):
    #   예전에는 "AUTO_MATCHED 인데 아직 채워지지 않은 셀이 있는 경우" 도 in_progress 로
    #   봤지만, rank_checker 워커가 예외로 셀을 영구히 미채움 상태로 남기면 사용자 화면이
    #   영원히 "처리 중 — 순위 검증 중" 배너에 갇혔다 (예: 광주 광산구 농촌 동 42개 셀).
    #   이제는 활성 잡 (manual_running) 이 없으면 unfilled 셀은 "이번 잡 종료 후
    #   남은 잔량" 으로 간주하고 in_progress=False 를 반환한다. 매트릭스의 "—" 셀은
    #   사용자가 "지금 검증" 으로 재시도 가능 (또한 워커도 이제 예외 발생 시 NULL 로
    #   persist 하므로 같은 셀이 다시 stuck 되지 않는다).
    in_progress = (pending > 0) or manual_running

    return RankCheckProgress(
        total_places=total_places,
        pending_match=pending,
        auto_matched=auto,
        needs_manual=needs_manual,
        total_cells=total_cells,
        filled_cells=filled_cells,
        in_progress=in_progress,
        naver_circuit_open=circuit_open,
        manual_running=manual_running,
        manual_started=manual_started,
        manual_started_at=manual_started_at,
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
        # Phase 5 - Fix B: 외부 db 없이 자체 워커 세션만 사용.
        # run_rank_check_for_places 는 db 인자를 받아도 더 이상 사용하지 않으며,
        # 호출 후 final commit 도 시도하지 않으므로 외부 세션을 만들 필요가 없다.
        try:
            await run_rank_check_for_places(None, places)
        except Exception as e:  # noqa: BLE001
            log.exception("manual rank-check failed: %s", e)

    background_tasks.add_task(_run)
    return RunRankCheckResponse(
        started=started,
        skipped_unmatched=0,
        message=f"{started}개 대상으로 백그라운드 실행 시작",
    )


# ─────────────────────────────────────────────────────────
# 사용자별 수동 검증 트리거 (타지역 정책 — 자동 트리거 비활성, 수동 전용)
# ─────────────────────────────────────────────────────────
@router.post("/manual-rank-check", response_model=ManualRankCheckResponse)
async def trigger_manual_rank_check(
    req: ManualRankCheckRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ManualRankCheckResponse:
    """사용자가 매트릭스/키워드 등록 카드에서 '지금 검증' 클릭 시 호출.

    타지역 정책상 자동 rank check 트리거를 모두 비활성화했기 때문에,
    사용자는 이 엔드포인트로 명시적으로 검증을 시작해야 한다.

    · req.place_ids 비어있음 → 본인의 AUTO_MATCHED + 키워드 보유 행 전체 검증
    · req.place_ids 지정 → 그 중 자격 조건 만족하는 행만 검증
    """
    # Phase 7 — 중복 잡 방지.
    # 이 사용자에 대한 이전 잡이 아직 백그라운드에서 돌고 있다면 409 로 거절한다.
    # 프론트는 /progress.manual_running 로도 같은 정보를 미리 받고 있어 버튼이
    # 비활성화되지만, 폴링 사이의 race (사용자가 폴링 직후 클릭) 를 막기 위한 서버측 가드.
    if _get_rank_busy(user.id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 검증 중입니다. 잠시 후 다시 시도해주세요.",
        )

    # 자격 조건: 본인 소유 + AUTO_MATCHED/CONFIRMED + place_id 보유 + 키워드 1개 이상
    base_where = [
        RegisteredPlace.user_id == user.id,
        RegisteredPlace.match_status.in_(("AUTO_MATCHED", "CONFIRMED")),
        RegisteredPlace.place_id.is_not(None),
        RegisteredPlace.tracking_keywords.is_not(None),
    ]
    if req.place_ids:
        base_where.append(RegisteredPlace.id.in_(req.place_ids))

    q = await db.execute(select(RegisteredPlace).where(*base_where))
    eligible = list(q.scalars().all())
    eligible_ids = [p.id for p in eligible]
    started = len(eligible_ids)

    # 요청된 ID 중 자격 미달인 것
    if req.place_ids:
        skipped = len([pk for pk in req.place_ids if pk not in eligible_ids])
    else:
        skipped = 0

    if started > 0:
        # Phase 7 — race-safe busy mark.
        # BackgroundTasks 큐잉 ~ 워커 시작 사이의 갭에 다른 요청이 들어와도
        # 409 로 거절되도록 *동기적으로* 플래그 set. 워커 내부의 finally 에서
        # 동일 _clear_rank_busy 가 항상 호출되므로 leak 위험 없음.
        _mark_rank_busy(user.id, started=started, label="manual")
        background_tasks.add_task(_run_rank_check_for_ids, user.id, eligible_ids)

    return ManualRankCheckResponse(
        started=started,
        skipped=skipped,
        message=(
            f"{started}개 업체에 대해 순위 검증을 시작했습니다. 잠시 후 매트릭스에 반영됩니다."
            if started > 0
            else "검증 가능한 업체가 없습니다. (매칭 완료 + 키워드 등록 후 다시 시도)"
        ),
    )
