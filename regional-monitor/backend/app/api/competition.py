"""지역별 경쟁도 분석 API (솔루션 #2).

데이터 소스: m.map.naver.com/search2/search.naver (RQ Streaming HTML)
판정: 도로명·지번 모두 번지 없음 → 타지역
경쟁도 4단계 (사용자 정의):
  · 청정  1‑5
  · 경쟁  6‑10
  · 과열  11‑15
  · 포화  16+

엔드포인트 (모두 require_complete_profile, /api/v1/competition/*):
  · GET  /competition/health           — 서비스 상태
  · POST /competition/scan-fast        — 시도/시군구 prefix 단건 호출 + 동별 집계
  · POST /competition/scan-precise     — 시도×시군구의 모든 동/리 prefix 호출 (job)
  · GET  /competition/jobs/{job_id}    — 진행률/결과 폴링
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import require_complete_profile
from app.models.user import User
from app.services.competition_classifier import (
    GRADE_LABEL,
    aggregate_by_dong,
    enrich,
    grade_distribution,
    grade_for_count,
)
from app.services.naver_map import MapPlace, search_many, search_map
from app.services.region_loader import (
    all_sigungu,
    list_dong,
    list_sigungu,
    load_regions,
    regions_summary,
    sigungu_in_sido,
)

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

router = APIRouter(prefix="/competition", tags=["competition"])


# ── Schemas ────────────────────────────────────────────────
class FastScanRequest(BaseModel):
    """Fast 모드: 시도 또는 시군구 prefix 1‑N 호출 + 응답을 동별 집계.

    scope:
      · nationwide  : 17개 시도 prefix (예: '서울 흥신소')   ~5s
      · sido        : 해당 시도의 시군구 prefix N회         ~30s
      · sigungu     : 해당 시군구만 1회 (대형 시군구는 75건 cap)
    """
    keyword: str = Field(..., min_length=1, max_length=80)
    scope: str = Field("sido", pattern="^(nationwide|sido|sigungu)$")
    sido: str = Field("", max_length=20)
    sigungu: str = Field("", max_length=40)
    pace_ms: int = Field(400, ge=200, le=3000)
    concurrency: int = Field(5, ge=1, le=8)


class PreciseScanRequest(BaseModel):
    """Precise 모드: 시도×시군구의 모든 동/리 prefix 호출 (job).

    scope:
      · sigungu : 한 시군구의 모든 동/리 (보통 10‑40개)   ~30s
      · sido    : 한 시도의 모든 동/리                    ~3‑5분
    """
    keyword: str = Field(..., min_length=1, max_length=80)
    scope: str = Field("sigungu", pattern="^(sigungu|sido)$")
    sido: str = Field(..., min_length=1, max_length=20)
    sigungu: str = Field("", max_length=40, description="scope=sigungu 시 필수")
    pace_ms: int = Field(400, ge=200, le=3000)
    concurrency: int = Field(5, ge=1, le=8)


# ── helpers ────────────────────────────────────────────────
def _short_sido(sido: str) -> str:
    """'서울특별시' → '서울', '강원특별자치도' → '강원' 등 시·도 짧은 이름.

    네이버 카드 텍스트의 주소는 짧은 이름으로 노출되므로 비교 시 정규화.
    빈 문자열 입력 시 빈 문자열 반환.
    """
    s = (sido or "").strip()
    if not s:
        return ""
    return (
        s.replace("특별자치도", "")
         .replace("특별자치시", "")
         .replace("특별시", "")
         .replace("광역시", "")
         .replace("도", "")
         .strip()
        or s
    )


def _filter_buckets_by_region(
    buckets: dict[str, dict],
    *,
    filter_sido: str = "",
    filter_sigungu: str = "",
) -> tuple[dict[str, dict], int]:
    """사용자가 선택한 시·도/시군구와 일치하지 않는 버킷을 제외.

    카드 텍스트의 주소는 시·도가 짧은 이름("서울")으로 들어오므로
    filter_sido 도 짧은 이름으로 정규화해 비교한다.
    filter_sigungu 는 풀네임 그대로 비교 — 카드 주소 역시 풀네임으로 옴
    ("서울 서초구 잠원동"). 두 토큰 시군구("수원시 영통구") 도 동일.

    빈 필터(filter_sido="" 또는 filter_sigungu="") 는 해당 차원 검사 생략.

    반환: (필터링된 buckets, 제외된 동 수)
    """
    if not filter_sido and not filter_sigungu:
        return buckets, 0

    target_sido = _short_sido(filter_sido)
    target_sigungu = (filter_sigungu or "").strip()

    kept: dict[str, dict] = {}
    excluded = 0
    for key, b in buckets.items():
        b_sido = (b.get("sido") or "").strip()
        b_sigungu = (b.get("sigungu") or "").strip()

        # 시·도 검사 — 카드는 짧은 이름이므로 양쪽 다 짧게 비교.
        if target_sido:
            if _short_sido(b_sido) != target_sido and b_sido != target_sido:
                excluded += 1
                continue
        # 시군구 검사 — 풀네임 vs 풀네임 (또는 둘 다 짧음). 빈 시군구는 무시.
        if target_sigungu:
            if b_sigungu != target_sigungu:
                excluded += 1
                continue
        kept[key] = b

    return kept, excluded


def _summary_payload(
    buckets: dict[str, dict],
    *,
    filter_sido: str = "",
    filter_sigungu: str = "",
) -> dict[str, Any]:
    """동별 버킷에서 KPI/등급분포/정렬된 행 추출.

    filter_sido / filter_sigungu 가 주어지면 일치하지 않는 버킷은 제외하고
    제외 수를 응답에 포함 — 사용자 선택 외 지역 데이터 누수를 막는다.
    """
    buckets, excluded = _filter_buckets_by_region(
        buckets, filter_sido=filter_sido, filter_sigungu=filter_sigungu,
    )
    rows = list(buckets.values())
    # 타지역수 desc → 메인수 desc → 동 이름 asc
    rows.sort(key=lambda b: (-b["other"], -b["main"], b["dong"]))
    dist = grade_distribution(buckets)
    total_other = sum(b["other"] for b in rows)
    total_main = sum(b["main"] for b in rows)
    return {
        "rows": rows,
        "dist": dist,
        "dist_label": {k: GRADE_LABEL[k] for k in dist.keys()},
        "totals": {
            "dong_count": len(rows),
            "other_count": total_other,
            "main_count": total_main,
            "place_count": total_other + total_main,
        },
        "filtered_out_dongs": excluded,
    }


# ── /health ────────────────────────────────────────────────
@router.get("/health")
async def comp_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "competition",
        "now_kst": datetime.now(tz=KST).isoformat(),
        "regions": regions_summary(),
        "grade_thresholds": {
            "청정": "1-5",
            "경쟁": "6-10",
            "과열": "11-15",
            "포화": "16+",
        },
    }


# ── Fast 스캔 (즉시 응답) ────────────────────────────────────
@router.post("/scan-fast")
async def comp_scan_fast(
    req: FastScanRequest,
    user: User = Depends(require_complete_profile),
):
    """시도/시군구 prefix 호출 + 동별 집계."""
    keyword = req.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="keyword 비어 있음")

    tree = load_regions()
    queries: list[str] = []
    if req.scope == "nationwide":
        # 17개 시도 prefix (시도 첫 토큰만 사용 — '서울특별시' → '서울')
        for sido in tree.keys():
            short = sido.replace("특별시", "").replace("광역시", "").replace("특별자치시", "").replace("특별자치도", "").replace("도", "")
            short = short.strip() or sido
            queries.append(f"{short} {keyword}")
    elif req.scope == "sido":
        if not req.sido or req.sido not in tree:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {req.sido}")
        for sg in tree[req.sido].keys():
            if sg:
                queries.append(f"{sg} {keyword}")
            else:
                # 세종 — sido 토큰만
                short = req.sido.replace("특별자치시", "").replace("특별시", "").strip()
                queries.append(f"{short} {keyword}")
    else:  # sigungu
        if not req.sido or req.sido not in tree:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {req.sido}")
        if req.sigungu and req.sigungu not in tree[req.sido]:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시군구: {req.sigungu}")
        token = req.sigungu or req.sido
        queries.append(f"{token} {keyword}")

    started = time.time()
    results = await search_many(
        queries, concurrency=req.concurrency, pace_ms=req.pace_ms, display=75,
    )

    # 모든 items 합치고 분류 → 동별 집계
    all_items: list[MapPlace] = []
    seen: set[str] = set()
    errors: list[dict[str, Any]] = []
    total_count_max = 0
    for r in results:
        if r.error:
            errors.append({"query": r.query, "error": r.error})
            continue
        if r.total_count > total_count_max:
            total_count_max = r.total_count
        for it in r.items:
            if it.place_id and it.place_id in seen:
                continue
            if it.place_id:
                seen.add(it.place_id)
            all_items.append(it)

    enrich(all_items)
    buckets = aggregate_by_dong(all_items)
    # scope 별 필터 — sigungu 모드면 시군구 일치, sido 모드면 시도 일치만 통과.
    # nationwide 는 전체 — 필터 없음.
    if req.scope == "sigungu":
        payload = _summary_payload(buckets, filter_sido=req.sido, filter_sigungu=req.sigungu)
    elif req.scope == "sido":
        payload = _summary_payload(buckets, filter_sido=req.sido)
    else:
        payload = _summary_payload(buckets)

    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "scope": req.scope,
        "sido": req.sido,
        "sigungu": req.sigungu,
        "keyword": keyword,
        "query_count": len(queries),
        "queries": queries,
        "elapsed_ms": elapsed_ms,
        "naver_total_max": total_count_max,
        "raw_item_count": len(all_items),
        "errors": errors,
        **payload,
    }


# ── Precise 스캔 (Job) ────────────────────────────────────
class _Job:
    def __init__(self, job_id: str, owner_id: int, total: int, *, keyword: str, scope: str, sido: str, sigungu: str):
        self.job_id = job_id
        self.owner_id = owner_id
        self.total = total
        self.done = 0
        self.status = "running"
        self.keyword = keyword
        self.scope = scope
        self.sido = sido
        self.sigungu = sigungu
        self.created_at = datetime.now(tz=KST).isoformat()
        self.finished_at: str | None = None
        self.error: str | None = None
        # 누적 items + 동별 집계
        self.items: list[MapPlace] = []
        self.seen: set[str] = set()
        self.errors: list[dict[str, Any]] = []

    def add_result(self, items: list[MapPlace], err: dict[str, Any] | None) -> None:
        if err:
            self.errors.append(err)
            return
        for it in items:
            if it.place_id and it.place_id in self.seen:
                continue
            if it.place_id:
                self.seen.add(it.place_id)
            self.items.append(it)

    def to_dict(self, include_results: bool = True) -> dict[str, Any]:
        d = {
            "job_id": self.job_id,
            "status": self.status,
            "total": self.total,
            "done": self.done,
            "progress": (self.done / self.total) if self.total else 0.0,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "keyword": self.keyword,
            "scope": self.scope,
            "sido": self.sido,
            "sigungu": self.sigungu,
            "raw_item_count": len(self.items),
            "errors": self.errors,
        }
        if include_results:
            enrich(self.items)
            buckets = aggregate_by_dong(self.items)
            # scope 별 필터 — 사용자가 명시한 시·도/시군구 외 결과는 제외.
            # 정밀모드는 항상 sigungu 또는 sido scope.
            if self.scope == "sigungu":
                payload = _summary_payload(
                    buckets, filter_sido=self.sido, filter_sigungu=self.sigungu,
                )
            elif self.scope == "sido":
                payload = _summary_payload(buckets, filter_sido=self.sido)
            else:
                payload = _summary_payload(buckets)
            d.update(payload)
        return d


_jobs: dict[str, _Job] = {}


def _gc_jobs(max_keep: int = 50) -> None:
    if len(_jobs) <= max_keep:
        return
    items = sorted(_jobs.items(), key=lambda kv: kv[1].created_at)
    for k, _ in items[: len(items) - max_keep]:
        _jobs.pop(k, None)


async def _run_precise_job(
    job: _Job, *, queries: list[tuple[str, str, str, str]], pace_ms: int, concurrency: int,
) -> None:
    """queries: [(sido, sigungu, dong, query_string)]."""
    sem = asyncio.Semaphore(concurrency)
    pace_s = max(0.0, pace_ms / 1000.0)

    async def one(sido: str, sigungu: str, dong: str, q: str) -> None:
        async with sem:
            try:
                r = await search_map(q, display=75)
                if r.error:
                    job.add_result([], {"query": q, "error": r.error})
                else:
                    job.add_result(r.items, None)
            except Exception as e:  # noqa: BLE001
                logger.warning("precise scan failed q=%s err=%s", q, e)
                job.add_result([], {"query": q, "error": str(e)})
            finally:
                job.done += 1
                if pace_s:
                    await asyncio.sleep(pace_s)

    try:
        await asyncio.gather(*[one(*qq) for qq in queries])
        job.status = "done"
    except Exception as e:  # noqa: BLE001
        job.status = "failed"
        job.error = str(e)
    finally:
        job.finished_at = datetime.now(tz=KST).isoformat()


@router.post("/scan-precise")
async def comp_scan_precise(
    req: PreciseScanRequest,
    bg: BackgroundTasks,
    user: User = Depends(require_complete_profile),
):
    """동/리 prefix 일괄 호출 (background job)."""
    keyword = req.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="keyword 비어 있음")

    tree = load_regions()
    if req.sido not in tree:
        raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {req.sido}")

    # 쿼리 강화 — 네이버가 동 이름만으로는 동명이인 동을 다른 시군구에서 잡아오는
    # 경우가 많아(예: "신원동 시스템에어컨설치" → 화성/광주 신원동), 시군구·시도
    # 토큰을 함께 보내 의도를 명확히 한다. 집계 단계의 _filter_buckets_by_region
    # 와 이중 방어.
    sido_short = _short_sido(req.sido)
    queries: list[tuple[str, str, str, str]] = []
    if req.scope == "sigungu":
        if req.sigungu not in tree[req.sido]:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시군구: {req.sigungu}")
        # 시군구는 두 토큰("수원시 영통구") 일 수도 있으므로 마지막 토큰만 사용
        # (네이버 검색은 마지막 토큰 매칭이 가장 강함).
        sg_token = req.sigungu.split()[-1] if req.sigungu else req.sigungu
        for d in list_dong(req.sido, req.sigungu):
            # '부강면 갈산리' 같은 두 토큰 동도 마지막 토큰 사용
            dong_token = d.split()[-1] if d else d
            queries.append(
                (req.sido, req.sigungu, d, f"{sg_token} {dong_token} {keyword}")
            )
    else:  # sido
        for sg, dongs in tree[req.sido].items():
            sg_token = sg.split()[-1] if sg else sg
            for d in dongs:
                dong_token = d.split()[-1] if d else d
                # sido scope 는 시·도 짧은 이름 + 시군구 + 동 모두 포함
                q = (
                    f"{sg_token} {dong_token} {keyword}"
                    if sg_token
                    else f"{sido_short} {dong_token} {keyword}"
                )
                queries.append((req.sido, sg, d, q))

    if not queries:
        raise HTTPException(status_code=400, detail="대상 동/리가 없습니다.")

    job_id = uuid.uuid4().hex[:16]
    job = _Job(
        job_id, user.id, total=len(queries),
        keyword=keyword, scope=req.scope,
        sido=req.sido, sigungu=req.sigungu,
    )
    _jobs[job_id] = job
    _gc_jobs()

    estimated_seconds = int((len(queries) / max(1, req.concurrency)) * (max(0, req.pace_ms) / 1000.0 + 0.5)) + 5

    bg.add_task(
        _run_precise_job, job,
        queries=queries, pace_ms=req.pace_ms, concurrency=req.concurrency,
    )

    return {
        "job_id": job_id,
        "status": "running",
        "total": len(queries),
        "keyword": keyword,
        "scope": req.scope,
        "sido": req.sido,
        "sigungu": req.sigungu,
        "estimated_seconds": estimated_seconds,
    }


@router.get("/jobs/{job_id}")
async def comp_job_status(
    job_id: str,
    include_results: bool = True,
    user: User = Depends(require_complete_profile),
):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job.owner_id != user.id and not getattr(user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="해당 작업의 소유자가 아닙니다.")
    return job.to_dict(include_results=include_results)
