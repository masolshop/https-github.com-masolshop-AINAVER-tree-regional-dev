"""
RankChecker — 등록동 + 키워드로 네이버 지도 검색 → 사장님 업체 순위 산출 (솔루션 #5).

검색 쿼리: "{sido} {sigungu} {dong} {keyword}"
응답: 지도 섹션 최대 75건
순위: 등록된 place_id가 응답 리스트에서 몇 번째인지 (1~75). 75위 밖이면 None.

매일 자동체크(운영자 수동 트리거 또는 향후 스케줄러)가 모든 AUTO_MATCHED/CONFIRMED 행 ×
키워드 조합을 호출하여 place_rank_history 테이블에 UPSERT한다.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date as date_cls
from typing import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import now_kst
from app.models.place import RegisteredPlace
from app.models.rank_history import PlaceRankHistory
from app.services.naver_map import search_map
from app.services.region_loader import lookup_region_by_dong

log = logging.getLogger(__name__)

# 차단 회피를 위한 순위 체크 호출 페이스
RANK_PACE_SEC = 0.8
# 동시성 (보수적으로 설정)
RANK_CONCURRENCY = 3


@dataclass
class RankCheckOutcome:
    place_pk: int
    keyword: str
    dong: str
    rank: int | None
    out_of_range: bool
    total_results: int | None
    error: str | None = None


def _split_tracking_keywords(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()][:5]


def _build_query(*, dong: str, keyword: str) -> str:
    """등록동 + 키워드 조합 쿼리. region 추론되면 시도+시군구 포함."""
    parts: list[str] = []
    regions = lookup_region_by_dong(dong) if dong else []
    if regions:
        sido, sigungu = regions[0]
        if sido:
            parts.append(sido)
        if sigungu:
            parts.append(sigungu)
    if dong:
        parts.append(dong)
    if keyword:
        parts.append(keyword)
    return " ".join(parts)


async def check_rank_one(
    *,
    place_pk: int,
    place_id: str,
    dong: str,
    keyword: str,
    client: httpx.AsyncClient | None = None,
) -> RankCheckOutcome:
    """단일 (place_pk, dong, keyword) 조합 순위 체크."""
    query = _build_query(dong=dong, keyword=keyword)
    if not query or not place_id:
        return RankCheckOutcome(
            place_pk=place_pk,
            keyword=keyword,
            dong=dong,
            rank=None,
            out_of_range=True,
            total_results=None,
            error="invalid_input",
        )

    res = await search_map(query, display=75, client=client)
    if res.error:
        return RankCheckOutcome(
            place_pk=place_pk,
            keyword=keyword,
            dong=dong,
            rank=None,
            out_of_range=True,
            total_results=None,
            error=res.error,
        )

    rank: int | None = None
    for idx, it in enumerate(res.items, start=1):
        if str(it.place_id) == str(place_id):
            rank = idx
            break

    return RankCheckOutcome(
        place_pk=place_pk,
        keyword=keyword,
        dong=dong,
        rank=rank,
        out_of_range=(rank is None),
        total_results=res.total_count,
    )


async def _persist_outcome(
    db: AsyncSession,
    outcome: RankCheckOutcome,
    check_date: date_cls,
) -> None:
    """outcome 1건을 place_rank_history에 UPSERT.

    UNIQUE(place_pk, check_date, keyword) — 이미 있으면 갱신.
    rank_delta는 전일 동일 키워드 레코드와의 차이로 계산.
    """
    # 1) 기존 레코드 (같은 날) 확인
    existing_q = await db.execute(
        select(PlaceRankHistory).where(
            PlaceRankHistory.place_pk == outcome.place_pk,
            PlaceRankHistory.check_date == check_date,
            PlaceRankHistory.keyword == outcome.keyword,
        )
    )
    existing = existing_q.scalar_one_or_none()

    # 2) 전일 레코드 (rank_delta 계산용) — 직전 1건
    prev_q = await db.execute(
        select(PlaceRankHistory)
        .where(
            PlaceRankHistory.place_pk == outcome.place_pk,
            PlaceRankHistory.keyword == outcome.keyword,
            PlaceRankHistory.check_date < check_date,
        )
        .order_by(PlaceRankHistory.check_date.desc())
        .limit(1)
    )
    prev = prev_q.scalar_one_or_none()
    delta: int | None = None
    if prev is not None and prev.rank is not None and outcome.rank is not None:
        delta = outcome.rank - prev.rank  # 양수=하락, 음수=상승

    if existing is not None:
        existing.rank = outcome.rank
        existing.out_of_range = outcome.out_of_range
        existing.total_results = outcome.total_results
        existing.rank_delta = delta
        existing.checked_at = now_kst()
    else:
        db.add(PlaceRankHistory(
            place_pk=outcome.place_pk,
            check_date=check_date,
            keyword=outcome.keyword,
            dong=outcome.dong,
            rank=outcome.rank,
            out_of_range=outcome.out_of_range,
            total_results=outcome.total_results,
            rank_delta=delta,
            checked_at=now_kst(),
        ))


async def run_rank_check_for_places(
    db: AsyncSession,
    places: Iterable[RegisteredPlace],
    *,
    check_date: date_cls | None = None,
    concurrency: int = RANK_CONCURRENCY,
    pace_ms: int = int(RANK_PACE_SEC * 1000),
) -> dict[str, int]:
    """주어진 places 리스트의 모든 (place × keyword) 조합 순위를 일괄 체크.

    Returns:
        {processed, success, out_of_range, error, skipped}
    """
    if check_date is None:
        check_date = now_kst().date()

    # 1) 작업 목록 펼치기: (place_pk, place_id, dong, keyword)
    tasks: list[tuple[int, str, str, str]] = []
    for p in places:
        if not p.place_id:
            continue
        dong = (p.registered_dong or "").strip()
        if not dong:
            continue
        for kw in _split_tracking_keywords(p.tracking_keywords):
            tasks.append((p.id, p.place_id, dong, kw))

    if not tasks:
        return {
            "processed": 0,
            "success": 0,
            "out_of_range": 0,
            "error": 0,
            "skipped": 0,
        }

    stats = {"processed": 0, "success": 0, "out_of_range": 0, "error": 0, "skipped": 0}
    sem = asyncio.Semaphore(max(1, concurrency))
    pace_s = max(0.0, pace_ms / 1000.0)

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        async def worker(pk: int, place_id: str, dong: str, keyword: str) -> None:
            async with sem:
                outcome = await check_rank_one(
                    place_pk=pk,
                    place_id=place_id,
                    dong=dong,
                    keyword=keyword,
                    client=client,
                )
                stats["processed"] += 1
                if outcome.error:
                    stats["error"] += 1
                elif outcome.rank is None:
                    stats["out_of_range"] += 1
                else:
                    stats["success"] += 1
                try:
                    await _persist_outcome(db, outcome, check_date)
                except Exception as e:  # noqa: BLE001
                    log.exception("rank persist failed: %s", e)
                    stats["error"] += 1
                if pace_s:
                    await asyncio.sleep(pace_s)

        await asyncio.gather(*[
            worker(pk, pid, dg, kw) for (pk, pid, dg, kw) in tasks
        ])

    try:
        await db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("rank batch commit failed: %s", e)
        await db.rollback()

    return stats


async def run_daily_rank_check(db: AsyncSession) -> dict[str, int]:
    """매일 자동체크 진입점 — 전체 매칭 완료 회원의 추적 키워드를 일괄 체크.

    현재 정책: 자동 timer 비활성. 운영자 수동 트리거(/api/v1/rank-tracker/run-rank-check)
    또는 향후 스케줄러가 본 함수를 호출한다.
    """
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.match_status.in_(("AUTO_MATCHED", "CONFIRMED")),
            RegisteredPlace.place_id.is_not(None),
            RegisteredPlace.tracking_keywords.is_not(None),
        )
    )
    places = list(q.scalars().all())
    return await run_rank_check_for_places(db, places)
