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
from typing import Callable, Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.time_utils import now_kst
from app.models.place import RegisteredPlace
from app.models.rank_history import PlaceRankHistory
from app.services.naver_map import is_circuit_open, search_map
from app.services.region_loader import lookup_region_by_dong

log = logging.getLogger(__name__)

# 차단 회피를 위한 순위 체크 호출 페이스
#
# [2026-05-16] naver_map.search_map() 이 HTTP 에서 Playwright 헤드리스 Chromium 으로
# 전면 전환되면서 호출당 비용이 ~5-6초 + 메모리 무거움으로 바뀌었다.
# - 동시성 8 → 2 (Playwright context 1개당 chromium 프로세스 분리 + ~150MB RAM, 서버 3.7GB 한계 고려)
# - pace 0.2s → 0.5s (호출 사이에 브라우저가 GC 할 여유)
RANK_PACE_SEC = 0.5
# Playwright 기반에서는 동시성 2~3 가 안정. 4 이상은 RAM 압박 + 큰 효과 없음.
RANK_CONCURRENCY = 2


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


def _is_rural_token(tok: str) -> bool:
    """토큰이 면/리 등 농어촌 단위인지 판별."""
    if not tok:
        return False
    t = tok.strip()
    return t.endswith("면") or t.endswith("리")


def _has_rural_tokens(dong: str) -> bool:
    """등록동 문자열 어딘가에 면/리 토큰이 있으면 True.

    registered_dong 는 보통 "{시도} {시군구} {읍/면/동} {리?}" 형태의 멀티토큰
    문자열로 저장된다 (예: "전라남도 화순군 청풍면 대비리", "광주광역시 광산구 왕동").
    면/리 토큰이 하나라도 있으면 농어촌 단위로 간주해 wide fallback 을 활성화한다.
    """
    if not dong:
        return False
    return any(_is_rural_token(t) for t in dong.strip().split())


def _build_query(*, dong: str, keyword: str, wide: bool = False) -> str:
    """등록동 + 키워드 조합 쿼리.

    registered_dong 는 두 가지 포맷이 혼재한다:
      (A) 단일 토큰 — "역삼동", "춘양면" → 과거 매칭 결과 (구버전)
      (B) 멀티 토큰 — "광주광역시 광산구 왕동",
                       "전라남도 화순군 청풍면 대비리" → 신버전
    어느 경우든 narrow 쿼리는 dong 문자열을 그대로 붙인 뒤
    region 추론이 가능하면 시도+시군구를 prepend 한다.

    wide=True (rural fallback) 일 때:
      - 멀티토큰이면: 끝에서부터 면/리 토큰을 제거하여 시도+시군구(+읍/동)만 남긴다.
        예: "전라남도 화순군 청풍면 대비리" → "전라남도 화순군"
        예: "전라남도 고흥군 고흥읍 고소리" → "전라남도 고흥군 고흥읍"
      - 단일토큰이면: region 추론으로 시도+시군구만 사용하고 dong 은 버린다.

    Args:
        dong: 등록동 (예: "춘양면", "전라남도 화순군 청풍면 대비리")
        keyword: 추적 키워드 (예: "대형렉카")
        wide: 농어촌 면/리 단위 fallback 검색 활성화 플래그.

    Returns:
        narrow: "{[시도 시군구 ]?}{dong원본} {keyword}"
        wide:   "{시도} {시군구}[ 읍/동]?  {keyword}"
    """
    parts: list[str] = []
    d = (dong or "").strip()

    if not wide:
        # NARROW — 기존 동작 유지. region 추론이 가능하면 시도/시군구 prepend.
        regions = lookup_region_by_dong(d) if d else []
        if regions:
            sido, sigungu = regions[0]
            if sido:
                parts.append(sido)
            if sigungu:
                parts.append(sigungu)
        if d:
            parts.append(d)
    else:
        # WIDE — 면/리 토큰을 제거해서 시군구 레벨로 넓힌다.
        tokens = d.split() if d else []
        if len(tokens) >= 2:
            # 멀티토큰: 끝에서부터 면/리 제거
            trimmed = list(tokens)
            while trimmed and _is_rural_token(trimmed[-1]):
                trimmed.pop()
            parts.extend(trimmed)
        elif len(tokens) == 1:
            # 단일토큰: region 추론으로 시도+시군구만 사용
            regions = lookup_region_by_dong(d)
            if regions:
                sido, sigungu = regions[0]
                if sido:
                    parts.append(sido)
                if sigungu:
                    parts.append(sigungu)
            # dong 자체는 wide 모드에서 추가하지 않음

    if keyword:
        parts.append(keyword)
    return " ".join(p for p in parts if p)


async def _search_and_rank(
    *,
    query: str,
    place_id: str,
    client: httpx.AsyncClient | None,
    bypass_circuit_breaker: bool = False,
) -> tuple[int | None, int | None, str | None]:
    """단일 쿼리로 네이버 지도 검색 → (rank, total_count, error) 반환.

    [2026-05-17 v3] bypass_circuit_breaker=True 면 search_map 의 회로차단
    가드를 우회해 강제로 호출한다. /rerun-out-of-range 자동 반복 루프 전용.
    """
    # [2026-05-16] Playwright 기반 search_map 은 항상 top 20 만 반환 (display 인자 무시).
    # rank 1~20 안에 없으면 "순위권 없음" (= out_of_range) 으로 표시.
    res = await search_map(
        query, display=20, client=client,
        bypass_circuit_breaker=bypass_circuit_breaker,
    )
    if res.error:
        return None, None, res.error
    for idx, it in enumerate(res.items, start=1):
        if str(it.place_id) == str(place_id):
            return idx, res.total_count, None
    return None, res.total_count, None


async def check_rank_one(
    *,
    place_pk: int,
    place_id: str,
    dong: str,
    keyword: str,
    client: httpx.AsyncClient | None = None,
    bypass_circuit_breaker: bool = False,
) -> RankCheckOutcome:
    """단일 (place_pk, dong, keyword) 조합 순위 체크.

    검색 전략 (rural 면/리 단위 노출률 개선):
      1차 — narrow: "{시도} {시군구} {동} {keyword}"
      2차 — wide (등록동이 면/리 일 때만): "{시도} {시군구} {keyword}"
            1차에서 out_of_range 였고, fallback 쿼리가 실제로 달라질 때만 시도.

    [2026-05-17 v3] bypass_circuit_breaker 전파: True 면 search_map 호출 시
    회로차단 가드를 우회한다 (/rerun-out-of-range 전용).
    """
    if not place_id or not (dong or keyword):
        return RankCheckOutcome(
            place_pk=place_pk,
            keyword=keyword,
            dong=dong,
            rank=None,
            out_of_range=True,
            total_results=None,
            error="invalid_input",
        )

    narrow_query = _build_query(dong=dong, keyword=keyword, wide=False)
    if not narrow_query:
        return RankCheckOutcome(
            place_pk=place_pk,
            keyword=keyword,
            dong=dong,
            rank=None,
            out_of_range=True,
            total_results=None,
            error="invalid_input",
        )

    rank, total, err = await _search_and_rank(
        query=narrow_query, place_id=place_id, client=client,
        bypass_circuit_breaker=bypass_circuit_breaker,
    )
    if err:
        return RankCheckOutcome(
            place_pk=place_pk,
            keyword=keyword,
            dong=dong,
            rank=None,
            out_of_range=True,
            total_results=None,
            error=err,
        )

    # Fallback: rural 면/리 토큰이 포함된 등록동인데 1차에서 못 잡혔으면
    # 시군구 레벨로 재검색.
    if rank is None and _has_rural_tokens(dong):
        wide_query = _build_query(dong=dong, keyword=keyword, wide=True)
        if wide_query and wide_query != narrow_query:
            w_rank, w_total, w_err = await _search_and_rank(
                query=wide_query, place_id=place_id, client=client,
                bypass_circuit_breaker=bypass_circuit_breaker,
            )
            if not w_err and w_rank is not None:
                rank = w_rank
                total = w_total

    return RankCheckOutcome(
        place_pk=place_pk,
        keyword=keyword,
        dong=dong,
        rank=rank,
        out_of_range=(rank is None),
        total_results=total,
    )


async def _touch_existing_history(
    db: AsyncSession,
    place_pk: int,
    keyword: str,
    check_date: date_cls,
) -> None:
    """회로차단으로 단락된 셀의 기존 historic row 를 가볍게 'touch'.

    [목적]
      circuit_skipped 셀은 네이버 호출 자체가 차단되어 새 rank 데이터가 없다.
      그러나 /progress 의 filled_cells 카운트는 (place_pk, keyword, check_date>=7일)
      의 DISTINCT row 수를 세므로, 이 셀에 어떤 row 도 없으면 진행률 막대가
      해당 비율만큼 영원히 못 채워져 사용자에게 "X건에서 멈춤" 으로 보인다.

    [정책]
      · 이전 check_date 에 같은 (place_pk, keyword) historic row 가 존재하면
        그 row 를 그대로 두고, **오늘 날짜에 동일 rank/out_of_range 를 복사한 row**
        를 생성한다 (또는 이미 있으면 checked_at 만 갱신).
        → 진행률은 100% 까지 도달하고, 실제 rank 값은 마지막으로 검증된 값을 유지.
      · 신규 셀(historic row 가 전혀 없는 셀) 은 touch 하지 않음 — 가짜 데이터 회피.
    """
    # 1) 오늘 날짜에 이미 row 가 있으면 checked_at 만 갱신
    today_q = await db.execute(
        select(PlaceRankHistory).where(
            PlaceRankHistory.place_pk == place_pk,
            PlaceRankHistory.check_date == check_date,
            PlaceRankHistory.keyword == keyword,
        )
    )
    today_row = today_q.scalar_one_or_none()
    if today_row is not None:
        today_row.checked_at = now_kst()
        return

    # 2) 이전 check_date 의 마지막 row 를 찾는다 — 그것을 오늘 날짜로 복사
    prev_q = await db.execute(
        select(PlaceRankHistory)
        .where(
            PlaceRankHistory.place_pk == place_pk,
            PlaceRankHistory.keyword == keyword,
            PlaceRankHistory.check_date < check_date,
        )
        .order_by(PlaceRankHistory.check_date.desc())
        .limit(1)
    )
    prev = prev_q.scalar_one_or_none()
    if prev is None:
        # 신규 셀 — 가짜 데이터 회피, touch 하지 않음.
        return

    db.add(PlaceRankHistory(
        place_pk=place_pk,
        check_date=check_date,
        keyword=keyword,
        dong=prev.dong,
        rank=prev.rank,
        out_of_range=prev.out_of_range,
        total_results=prev.total_results,
        rank_delta=0,  # 직전 row 와 동일 값 복사이므로 delta 0
        checked_at=now_kst(),
    ))


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
    db: AsyncSession | None,
    places: Iterable[RegisteredPlace],
    *,
    check_date: date_cls | None = None,
    concurrency: int = RANK_CONCURRENCY,
    pace_ms: int = int(RANK_PACE_SEC * 1000),
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, int]:
    """주어진 places 리스트의 모든 (place × keyword) 조합 순위를 일괄 체크.

    [Fix B 의 핵심 — Phase 5]
    이전에는 호출자가 넘긴 `db` 세션을 워커 종료 후 final commit 에 사용했으나,
    워커들이 자체 AsyncSession 으로 commit 하는 동안 외부 `db` 는 'idle in
    transaction' 또는 'prepared' 상태에 머무를 수 있다. 그 상태에서 final
    `db.commit()` 을 부르면 다음 에러들이 연쇄 발생했다:
        · sqlalchemy.exc.IllegalStateChangeError (prepared → commit)
        · sqlalchemy.exc.InvalidRequestError (prepared state, no further SQL)
        · sqlalchemy.exc.ResourceClosedError (transaction is closed)
        · asyncpg.InterfaceError: another operation is in progress

    이제는 **외부 `db` 를 일체 사용하지 않는다**. 이 함수는 워커마다 자체
    AsyncSession 을 발급해 영속화 + commit 하므로 호출자의 세션 상태와
    완전히 독립적이다. `db` 인자는 하위호환을 위해 받기만 하고 무시한다.
    (호출부가 places 를 미리 select 한 세션을 그대로 넘겨주는 패턴이 많아
    바로 제거하지 않음.)

    Returns:
        {processed, success, out_of_range, error, skipped}
    """
    # db 인자는 하위호환을 위해 받지만 사용하지 않는다 (Fix B).
    _ = db  # mark intentionally unused
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

    # 2) 작업 실행 — 리팩토링 (2026-05-16):
    #    "셀 단위" 재검증 경로(run_rank_check_for_cells)와 워커 로직을 공유하기 위해
    #    실제 worker/gather 부분은 _run_rank_check_tasks 로 추출. 기존 동작은 그대로.
    return await _run_rank_check_tasks(
        tasks=tasks,
        check_date=check_date,
        concurrency=concurrency,
        pace_ms=pace_ms,
        cancel_check=cancel_check,
    )


async def _run_rank_check_tasks(
    *,
    tasks: list[tuple[int, str, str, str]],
    check_date: date_cls,
    concurrency: int,
    pace_ms: int,
    cancel_check: Callable[[], bool] | None = None,
    bypass_circuit_breaker: bool = False,
) -> dict[str, int]:
    """주어진 (place_pk, place_id, dong, keyword) 작업 리스트를 동시성 + 페이스 제어로 실행.

    [2026-05-16] run_rank_check_for_places 의 워커 코어를 분리한 헬퍼.
    place 단위 검증(`run_rank_check_for_places`) 과 셀 단위 재검증
    (`run_rank_check_for_cells`) 가 동일 worker / persist / circuit-breaker
    로직을 공유하도록 추출. 외부 호출자가 만든 tasks 를 그대로 받아서 실행한다.
    """
    if not tasks:
        return {
            "processed": 0,
            "success": 0,
            "out_of_range": 0,
            "error": 0,
            "skipped": 0,
            "circuit_skipped": 0,
        }

    stats = {
        "processed": 0,
        "success": 0,
        "out_of_range": 0,
        "error": 0,
        "skipped": 0,
        "circuit_skipped": 0,  # 회로차단으로 단락된 건수 (Fix A)
    }
    sem = asyncio.Semaphore(max(1, concurrency))
    pace_s = max(0.0, pace_ms / 1000.0)

    # ⚠️ 동시성 안전성: asyncpg connection 1개로는 동시에 1개 쿼리만 가능.
    # 따라서 각 worker 마다 자체 AsyncSession (≈ 자체 connection) 을 발급해서
    # "another operation is in progress" 에러 방지.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        async def worker(pk: int, place_id: str, dong: str, keyword: str) -> None:
            async with sem:
                # ─── [2026-05-17] 중지 플래그 체크.
                # 사용자가 프론트의 "중지" 버튼을 눌러 POST /cancel 이 호출되면
                # cancel_check() 가 True 를 반환한다. 워커는 네이버 호출을 하기 전에
                # 즉시 종료해 잡 전체를 빠르게 멈춘다 (스킵 카운트 증가).
                # 이미 실행 중이던 셀은 그대로 끝나지만, 아직 시작 안 한 셀은 모두 skip.
                if cancel_check is not None and cancel_check():
                    stats["processed"] += 1
                    stats["skipped"] += 1
                    return

                # ─── Fix A: 회로차단 OPEN 이면 네이버 호출 시도조차 하지 않고
                # outcome.error='naver_unavailable' 로 기록한다.
                # search_map() 내부에서도 단락하지만, 워커 진입 시점에
                # 미리 체크해두면 (1) check_rank_one 의 헛돈 분기 (예: rural
                # fallback 2회 시도)를 막고, (2) DB write 도 스킵해서
                # prepared/another operation 경쟁을 줄인다.
                #
                # [2026-05-17 v3] bypass_circuit_breaker=True 면 회로차단을 무시하고
                # 그대로 호출한다. /rerun-out-of-range 처럼 "이미 한 번 검증해본 셀에
                # 한해 사용자가 명시적으로 재시도하는" 경로에서는, 회로차단 상태로
                # 옛 out_of_range=True 값을 그대로 복사 (_touch_existing_history) 해버리면
                # 자동 반복 루프가 "카운트가 줄지 않음" 으로 즉시 종료된다.
                # 사용자 지시: "네이버 차단 없어, 회로차단 대기 없애줘, 바로바로 크롤링".
                if not bypass_circuit_breaker and is_circuit_open():
                    stats["processed"] += 1
                    stats["circuit_skipped"] += 1
                    # pace 도 의미 없으니 즉시 다음 worker 에게 슬롯 양보
                    return

                try:
                    outcome = await check_rank_one(
                        place_pk=pk,
                        place_id=place_id,
                        dong=dong,
                        keyword=keyword,
                        client=client,
                        bypass_circuit_breaker=bypass_circuit_breaker,
                    )
                except Exception as e:  # noqa: BLE001
                    # check_rank_one 자체에서 예외가 새어나온 경우 (이론상 없음).
                    # Phase 7 fix: 예외 발생 시에도 synthetic outcome 으로 persist 해야
                    # PlaceRankHistory 에 (place_pk, keyword, check_date) 행이 생겨서
                    # /progress 의 filled_cells 카운트가 100% 까지 도달할 수 있다.
                    # 없으면 그 셀이 영구히 비어있어 진행률이 93% 같은 어중간한 값에서 멈춤.
                    # rank=None 이므로 매트릭스에서는 자연스럽게 "—" 로 표시된다.
                    log.exception("check_rank_one crashed for pk=%s kw=%s: %s", pk, keyword, e)
                    stats["processed"] += 1
                    stats["error"] += 1
                    synthetic = RankCheckOutcome(
                        place_pk=pk,
                        keyword=keyword,
                        dong=dong,
                        rank=None,
                        out_of_range=False,
                        total_results=0,
                        error="exception",
                    )
                    try:
                        async with AsyncSessionLocal() as wdb:
                            try:
                                await _persist_outcome(wdb, synthetic, check_date)
                                await wdb.commit()
                            except Exception as inner:  # noqa: BLE001
                                log.exception("synthetic persist failed (inner): %s", inner)
                                try:
                                    await wdb.rollback()
                                except Exception:  # noqa: BLE001
                                    pass
                    except Exception as persist_err:  # noqa: BLE001
                        log.exception("synthetic persist session failed: %s", persist_err)
                    if pace_s:
                        await asyncio.sleep(pace_s)
                    return

                stats["processed"] += 1
                # naver_unavailable (회로차단 단락) 은 일반 error 와 구분해서 카운트.
                # [2026-05-16 fix] 이전에는 DB write 를 완전히 스킵했지만, 그러면
                # PlaceRankHistory 에 (place_pk, keyword, check_date) row 가 안 생겨서
                # /progress 의 filled_cells 카운트가 안 올라가 → 진행률 막대가
                # 어중간한 값에서 멈춰 사용자에게 "X건에서 멈춤" 처럼 보임.
                #
                # 해결: 이전 사이클에 같은 (place_pk, keyword) 의 historic row 가
                # 이미 있다면 그 행의 `checked_at` 만 갱신해서 filled_cells 가
                # 100% 까지 도달하게 한다. rank/out_of_range 같은 실데이터는
                # 변경하지 않으므로 "진짜 순위" 와 "회로차단 단락" 이 구분된 채로
                # 유지된다. historic row 가 전혀 없는 신규 셀은 그대로 스킵.
                if outcome.error == "naver_unavailable":
                    stats["circuit_skipped"] += 1
                    try:
                        async with AsyncSessionLocal() as wdb:
                            try:
                                await _touch_existing_history(
                                    wdb, outcome.place_pk, outcome.keyword, check_date
                                )
                                await wdb.commit()
                            except Exception as inner:  # noqa: BLE001
                                log.exception(
                                    "circuit_skipped touch failed (inner): %s", inner
                                )
                                try:
                                    await wdb.rollback()
                                except Exception:  # noqa: BLE001
                                    pass
                    except Exception as touch_err:  # noqa: BLE001
                        log.exception(
                            "circuit_skipped touch session failed: %s", touch_err
                        )
                    if pace_s:
                        await asyncio.sleep(pace_s)
                    return
                if outcome.error:
                    stats["error"] += 1
                elif outcome.rank is None:
                    stats["out_of_range"] += 1
                else:
                    stats["success"] += 1

                # 워커 전용 세션으로 persist (다른 워커와 connection 공유 X)
                try:
                    async with AsyncSessionLocal() as wdb:
                        try:
                            await _persist_outcome(wdb, outcome, check_date)
                            # 매트릭스 실시간 폴링이 즉시 새 셀을 볼 수 있도록
                            # outcome 마다 커밋.
                            await wdb.commit()
                        except Exception as inner:  # noqa: BLE001
                            log.exception("rank persist failed (inner): %s", inner)
                            stats["error"] += 1
                            try:
                                await wdb.rollback()
                            except Exception:  # noqa: BLE001
                                pass
                except Exception as e:  # noqa: BLE001
                    # 세션 발급 자체가 실패한 경우 — DB 풀 고갈 등.
                    log.exception("rank persist session failed: %s", e)
                    stats["error"] += 1
                if pace_s:
                    await asyncio.sleep(pace_s)

        await asyncio.gather(*[
            worker(pk, pid, dg, kw) for (pk, pid, dg, kw) in tasks
        ])

    # ─── Fix B: 외부 db 에 대한 final commit 제거.
    # 워커들이 자체 세션으로 이미 영속화했으므로 추가 commit 이 필요 없다.
    # 외부 db 를 건드리지 않으므로 호출자 컨텍스트에서 발생하던 prepared/closed
    # 충돌이 사라진다.

    if stats["circuit_skipped"] > 0:
        log.warning(
            "rank-check completed with naver_unavailable: total=%d circuit_skipped=%d "
            "success=%d out_of_range=%d error=%d",
            stats["processed"], stats["circuit_skipped"],
            stats["success"], stats["out_of_range"], stats["error"],
        )

    return stats


async def run_rank_check_for_cells(
    cells: Iterable[tuple[int, str]],
    *,
    check_date: date_cls | None = None,
    concurrency: int = RANK_CONCURRENCY,
    pace_ms: int = int(RANK_PACE_SEC * 1000),
    cancel_check: Callable[[], bool] | None = None,
    bypass_circuit_breaker: bool = False,
) -> dict[str, int]:
    """주어진 (place_pk, keyword) 셀 리스트만 정확히 재검증한다 (2026-05-16).

    [목적]
      "순위권 없음" 으로 잡힌 특정 셀들만 재검증하고 싶을 때 사용한다.
      run_rank_check_for_places 는 place 의 모든 keyword 를 검증해버리므로,
      예를 들어 한 place 에 keyword 가 5개 등록되어 있고 그 중 1개만
      재검증 대상이어도 5개 전부 다시 돌게 된다 (불필요한 Naver 호출).

    [동작]
      1) cells 의 place_pk 집합을 한 번에 DB 조회 → place_id / registered_dong 매핑
      2) (place_pk, place_id, dong, keyword) 4-tuple tasks 생성
         - place_id 또는 dong 비어있으면 그 셀은 skip
      3) _run_rank_check_tasks 로 위임 (run_rank_check_for_places 와 같은 워커)

    [주의]
      cells 는 호출자가 정확히 검증할 셀만 골라서 넘긴다. 백엔드는 추가
      필터링 (keyword 가 tracking_keywords 에 들어있는지 등) 을 하지 않는다.
      대신 place_pk 존재성 / place_id / dong 비어있음만 가드한다.
    """
    if check_date is None:
        check_date = now_kst().date()

    cell_list = list(cells)
    if not cell_list:
        return {
            "processed": 0,
            "success": 0,
            "out_of_range": 0,
            "error": 0,
            "skipped": 0,
            "circuit_skipped": 0,
        }

    # 1) place_pk → (place_id, dong) 매핑을 한 번에 fetch
    place_pks = sorted({pk for (pk, _kw) in cell_list})
    async with AsyncSessionLocal() as fdb:
        q = await fdb.execute(
            select(
                RegisteredPlace.id,
                RegisteredPlace.place_id,
                RegisteredPlace.registered_dong,
            ).where(RegisteredPlace.id.in_(place_pks))
        )
        meta = {
            int(pk): (pid, (dg or "").strip())
            for (pk, pid, dg) in q.all()
        }

    # 2) tasks 생성 — place 자격 미달(없음/place_id 없음/dong 없음)은 skip
    tasks: list[tuple[int, str, str, str]] = []
    skipped_unresolvable = 0
    for pk, kw in cell_list:
        m = meta.get(int(pk))
        if not m:
            skipped_unresolvable += 1
            continue
        pid, dong = m
        if not pid or not dong or not kw:
            skipped_unresolvable += 1
            continue
        tasks.append((int(pk), pid, dong, kw))

    log.info(
        "rerun-cells dispatching: requested=%d resolvable=%d skipped=%d bypass_cb=%s",
        len(cell_list), len(tasks), skipped_unresolvable, bypass_circuit_breaker,
    )

    return await _run_rank_check_tasks(
        tasks=tasks,
        check_date=check_date,
        concurrency=concurrency,
        pace_ms=pace_ms,
        cancel_check=cancel_check,
        bypass_circuit_breaker=bypass_circuit_breaker,
    )


async def run_daily_rank_check(db: AsyncSession) -> dict[str, int]:
    """매일 자동체크 진입점 — 전체 매칭 완료 회원의 추적 키워드를 일괄 체크.

    현재 정책: 자동 timer 비활성. 운영자 수동 트리거(/api/v1/rank-tracker/run-rank-check)
    또는 향후 스케줄러가 본 함수를 호출한다.

    [Phase 5 - Fix B] places 만 외부 db 로 fetch 한 뒤, 본체는 자체 워커 세션만 사용한다.
    """
    q = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.match_status.in_(("AUTO_MATCHED", "CONFIRMED")),
            RegisteredPlace.place_id.is_not(None),
            RegisteredPlace.tracking_keywords.is_not(None),
        )
    )
    places = list(q.scalars().all())
    # 외부 db 는 더 이상 본체에 넘기지 않는다 — 워커들이 자체 세션으로 commit.
    return await run_rank_check_for_places(None, places)
