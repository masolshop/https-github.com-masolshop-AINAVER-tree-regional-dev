"""키워드 발굴 API (솔루션 #1).

엔드포인트 (모두 require_complete_profile, /api/v1/keyword/*):
  · GET  /keyword/regions          — 4,819 동/리 트리 (시도→시군구→동/리)
  · POST /keyword/discover         — 단건 키워드 검색 + 분류
  · POST /keyword/discover/batch   — 다건(최대 30개) 일괄 검색
  · POST /keyword/discover-by-region   — 지역(시군구/동) + 키워드 단건 검색
  · POST /keyword/discover-bulk-region — 시도 또는 전국 시군구 × 키워드 일괄 (job)
  · GET  /keyword/jobs/{job_id}    — 일괄 작업 진행률/결과 폴링

특징:
  · 6시간 in-memory 캐시 (키워드+지역 단위)
  · 사용자별 simple rate-limit (분당 최대 20 키워드)
  · 일괄 작업은 백그라운드 task로 실행 (동시 5개 + pace 지연)
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import require_complete_profile
from app.models.user import User
from app.services.keyword_classifier import classify_items, summarize
from app.services.naver_keyword import search_keyword
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

router = APIRouter(prefix="/keyword", tags=["keyword"])


# ── 6시간 in-memory 캐시 ────────────────────────────────────
class _Cache:
    def __init__(self, ttl_seconds: int = 6 * 60 * 60):
        self.ttl = ttl_seconds
        self._store: dict[str, tuple[float, dict]] = {}

    def get(self, key: str) -> dict | None:
        ent = self._store.get(key)
        if not ent:
            return None
        ts, val = ent
        if time.time() - ts > self.ttl:
            self._store.pop(key, None)
            return None
        return val

    def set(self, key: str, val: dict) -> None:
        # 1000건 초과 시 가장 오래된 항목부터 제거
        if len(self._store) > 1000:
            oldest = sorted(self._store.items(), key=lambda kv: kv[1][0])[:200]
            for k, _ in oldest:
                self._store.pop(k, None)
        self._store[key] = (time.time(), val)


_cache = _Cache(ttl_seconds=6 * 60 * 60)


# ── 사용자별 분당 호출 제한 ─────────────────────────────────
_RATE_LIMIT_PER_MIN = 20
_recent_calls: dict[int, deque[float]] = defaultdict(deque)


def _check_rate_limit(user_id: int, requested: int) -> None:
    now = time.time()
    dq = _recent_calls[user_id]
    while dq and now - dq[0] > 60.0:
        dq.popleft()
    if len(dq) + requested > _RATE_LIMIT_PER_MIN:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"분당 최대 {_RATE_LIMIT_PER_MIN}개 키워드까지 분석 가능합니다. 잠시 후 다시 시도해 주세요.",
        )
    for _ in range(requested):
        dq.append(now)


# ── schemas ────────────────────────────────────────────────
class DiscoverRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=80)
    display: int = Field(10, ge=1, le=20, description="가져올 플레이스 개수 (1페이지 최대 ~7건)")
    use_cache: bool = True


class DiscoverBatchRequest(BaseModel):
    keywords: list[str] = Field(..., min_length=1, max_length=30)
    display: int = Field(10, ge=1, le=20)
    pace_ms: int = Field(500, ge=200, le=3000, description="키워드 호출 간 간격(ms)")
    use_cache: bool = True


class DiscoverByRegionRequest(BaseModel):
    """지역 + 키워드 단건 검색."""
    sido: str = Field(..., min_length=1, max_length=20)
    sigungu: str = Field("", max_length=40, description="세종시는 빈 문자열")
    dong: str = Field("", max_length=40, description="동/리 (모드=dong/both 시 필수)")
    mode: str = Field("sigungu", pattern="^(sigungu|dong|both)$")
    keywords: list[str] = Field(..., min_length=1, max_length=10)
    display: int = Field(10, ge=1, le=20)
    use_cache: bool = True


class DiscoverBulkRegionRequest(BaseModel):
    """시도/시군구/전국 × 키워드 일괄 검색 — 비동기 job.

    scope 옵션:
      · nationwide — 전국 229개 시군구 검색 (시군구 모드)
      · sido       — 해당 시도의 시군구 전체 (시군구 모드)
      · sigungu    — 특정 시군구 안의 모든 동/리 (동/리 모드)
    """
    scope: str = Field("nationwide", pattern="^(nationwide|sido|sigungu)$")
    sido: str = Field("", max_length=20, description="scope=sido/sigungu 시 필수")
    sigungu: str = Field("", max_length=40, description="scope=sigungu 시 필수")
    keywords: list[str] = Field(..., min_length=1, max_length=5)
    display: int = Field(10, ge=1, le=20)
    pace_ms: int = Field(500, ge=200, le=3000)
    concurrency: int = Field(5, ge=1, le=8)
    use_cache: bool = True


# ── helpers ────────────────────────────────────────────────
async def _discover_one(keyword: str, display: int, use_cache: bool) -> dict[str, Any]:
    cache_key = f"{keyword}|{display}"
    if use_cache:
        cached = _cache.get(cache_key)
        if cached is not None:
            return {**cached, "from_cache": True}

    started = time.time()
    raw = await search_keyword(keyword, display=display)
    items_classified = classify_items(raw["items"])
    sm = summarize(items_classified)

    result = {
        "keyword": raw["keyword"],
        "source": raw["source"],
        "fetched_at": datetime.now(tz=KST).isoformat(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "summary": sm,
        "items": items_classified,
        "error": raw.get("error"),
        "from_cache": False,
    }
    _cache.set(cache_key, result)
    return result


# ── routes ─────────────────────────────────────────────────
@router.get("/health")
async def keyword_health() -> dict[str, Any]:
    """서비스 상태 + 캐시 항목 수."""
    return {
        "status": "ok",
        "service": "keyword-discover",
        "now_kst": datetime.now(tz=KST).isoformat(),
        "cache_entries": len(_cache._store),
    }


@router.post("/discover")
async def keyword_discover(
    req: DiscoverRequest,
    user: User = Depends(require_complete_profile),
):
    """키워드 1개 → 1페이지 플레이스 + 메인/타지역 분류."""
    _check_rate_limit(user.id, 1)
    try:
        return await _discover_one(req.keyword, req.display, req.use_cache)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("keyword discover failed user=%s kw=%s err=%s", user.id, req.keyword, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/discover/batch")
async def keyword_discover_batch(
    req: DiscoverBatchRequest,
    user: User = Depends(require_complete_profile),
):
    """다건 키워드 일괄 검색 (pace_ms 간격)."""
    keywords = [k.strip() for k in req.keywords if k and k.strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="keywords 비어 있음")
    _check_rate_limit(user.id, len(keywords))

    out = []
    for i, kw in enumerate(keywords):
        if i > 0:
            await asyncio.sleep(req.pace_ms / 1000.0)
        try:
            out.append(await _discover_one(kw, req.display, req.use_cache))
        except Exception as e:  # noqa: BLE001
            logger.warning("batch keyword failed kw=%s err=%s", kw, e)
            out.append({
                "keyword": kw,
                "source": "none",
                "fetched_at": datetime.now(tz=KST).isoformat(),
                "elapsed_ms": 0,
                "summary": {
                    "total": 0, "main_count": 0, "third_party_count": 0,
                    "third_party_suspect_count": 0, "unknown_count": 0,
                    "third_party_ratio": 0.0, "is_third_party_keyword": False,
                },
                "items": [],
                "error": str(e),
                "from_cache": False,
            })

    # 집계 — 프론트의 KPI 카드용
    total_items = sum(len(r.get("items") or []) for r in out)
    tp_items = sum(((r.get("summary") or {}).get("third_party_count") or 0) for r in out)
    sus_items = sum(((r.get("summary") or {}).get("third_party_suspect_count") or 0) for r in out)
    main_items = sum(((r.get("summary") or {}).get("main_count") or 0) for r in out)
    tp_keywords = sum(1 for r in out if (r.get("summary") or {}).get("is_third_party_keyword"))

    return {
        "count": len(out),
        "summary": {
            "keyword_count": len(out),
            "third_party_keyword_count": tp_keywords,
            "total_items": total_items,
            "third_party_count": tp_items,
            "third_party_suspect_count": sus_items,
            "main_count": main_items,
        },
        "results": out,
    }


# ── 지역 트리 / 지역 검색 ───────────────────────────────────
@router.get("/regions")
async def get_regions(
    user: User = Depends(require_complete_profile),
) -> dict[str, Any]:
    """4,819 동/리 트리 + 요약. 프론트 드롭다운용."""
    return {
        "summary": regions_summary(),
        "tree": load_regions(),
    }


def _query_for_region(sigungu: str, dong: str, mode: str, keyword: str) -> tuple[str, str]:
    """검색 쿼리 생성 + 검색 라벨 반환.

    반환: (query_string, label)
    label 예: "강릉시 선불폰" / "강문동 선불폰"
    """
    keyword = (keyword or "").strip()
    if mode == "dong":
        token = (dong or "").strip()
    elif mode == "sigungu":
        token = (sigungu or "").strip()
    else:
        token = (sigungu or "").strip() or (dong or "").strip()
    # "부강면 갈산리" 같이 공백 포함된 동도 그대로 결합
    q = f"{token} {keyword}".strip() if token else keyword
    label = f"{token} {keyword}".strip() if token else keyword
    return q, label


async def _discover_one_region(
    *, sigungu: str, dong: str, mode: str, keyword: str,
    display: int, use_cache: bool,
) -> dict[str, Any]:
    """단일 (지역, 키워드, 모드) 검색.

    동/리 모드: 결과 0건이면 exposed=False, message='타지역 노출 없음'.
    시군구 모드: 노출된 결과 그대로 반환 (지역 매칭 필터 없음).
    """
    query, label = _query_for_region(sigungu, dong, mode, keyword)
    cache_key = f"region|{mode}|{query}|{display}"
    if use_cache:
        cached = _cache.get(cache_key)
        if cached is not None:
            return {**cached, "from_cache": True}

    started = time.time()
    raw = await search_keyword(query, display=display)
    items_classified = classify_items(raw["items"])
    sm = summarize(items_classified)

    exposed = sm.get("total", 0) > 0
    msg = None
    if mode == "dong" and not exposed:
        msg = "타지역 노출 없음"

    result = {
        "scope": "region",
        "mode": mode,
        "sigungu": sigungu,
        "dong": dong,
        "keyword": keyword,
        "query": query,
        "label": label,
        "source": raw["source"],
        "fetched_at": datetime.now(tz=KST).isoformat(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "summary": sm,
        "items": items_classified,
        "exposed": exposed,
        "message": msg,
        "error": raw.get("error"),
        "from_cache": False,
    }
    _cache.set(cache_key, result)
    return result


@router.post("/discover-by-region")
async def keyword_discover_by_region(
    req: DiscoverByRegionRequest,
    user: User = Depends(require_complete_profile),
):
    """지역(시군구/동/둘 다) × 키워드(최대 10개) 단건 검색."""
    sido = req.sido.strip()
    sigungu = (req.sigungu or "").strip()
    dong = (req.dong or "").strip()
    keywords = [k.strip() for k in req.keywords if k and k.strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="keywords 비어 있음")
    if req.mode in ("dong", "both") and not dong:
        raise HTTPException(status_code=400, detail="동/리 모드는 dong 값이 필수입니다.")

    # 지역 화이트리스트 검증 (regions.json 트리 안에 있어야 함)
    tree = load_regions()
    if sido not in tree:
        raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {sido}")
    sigungu_map = tree[sido]
    if sigungu not in sigungu_map:
        raise HTTPException(status_code=400, detail=f"알 수 없는 시군구: {sido} {sigungu}")
    if dong and dong not in sigungu_map[sigungu]:
        raise HTTPException(status_code=400, detail=f"알 수 없는 동/리: {dong}")

    # 모드별 검색 횟수 — sigungu/dong: 1회, both: 2회
    calls_per_kw = 2 if req.mode == "both" else 1
    _check_rate_limit(user.id, len(keywords) * calls_per_kw)

    out: list[dict[str, Any]] = []
    for i, kw in enumerate(keywords):
        if i > 0:
            await asyncio.sleep(0.4)
        try:
            if req.mode == "both":
                sg_res = await _discover_one_region(
                    sigungu=sigungu, dong=dong, mode="sigungu", keyword=kw,
                    display=req.display, use_cache=req.use_cache,
                )
                await asyncio.sleep(0.3)
                dong_res = await _discover_one_region(
                    sigungu=sigungu, dong=dong, mode="dong", keyword=kw,
                    display=req.display, use_cache=req.use_cache,
                )
                out.append({
                    "keyword": kw,
                    "sigungu_result": sg_res,
                    "dong_result": dong_res,
                })
            else:
                res = await _discover_one_region(
                    sigungu=sigungu, dong=dong, mode=req.mode, keyword=kw,
                    display=req.display, use_cache=req.use_cache,
                )
                out.append({"keyword": kw, "result": res})
        except Exception as e:  # noqa: BLE001
            logger.warning("region discover failed kw=%s err=%s", kw, e)
            out.append({"keyword": kw, "error": str(e)})

    return {
        "sido": sido,
        "sigungu": sigungu,
        "dong": dong,
        "mode": req.mode,
        "count": len(out),
        "results": out,
    }


# ── 지역 일괄 검색 (job 기반) ────────────────────────────────
class _Job:
    def __init__(self, job_id: str, owner_id: int, total: int):
        self.job_id = job_id
        self.owner_id = owner_id
        self.total = total
        self.done = 0
        self.status = "running"  # running | done | failed | cancelled
        self.created_at = datetime.now(tz=KST).isoformat()
        self.finished_at: str | None = None
        self.error: str | None = None
        self.results: list[dict[str, Any]] = []

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
        }
        if include_results:
            d["results"] = self.results
            d["summary"] = self._summary()
        else:
            d["summary"] = self._summary()
        return d

    def _summary(self) -> dict[str, Any]:
        total_items = 0
        tp = 0
        sus = 0
        main = 0
        exposed_pairs = 0
        for r in self.results:
            sm = (r.get("summary") or {})
            total_items += len(r.get("items") or [])
            tp += sm.get("third_party_count") or 0
            sus += sm.get("third_party_suspect_count") or 0
            main += sm.get("main_count") or 0
            if r.get("exposed"):
                exposed_pairs += 1
        return {
            "pair_count": len(self.results),
            "exposed_pair_count": exposed_pairs,
            "total_items": total_items,
            "third_party_count": tp,
            "third_party_suspect_count": sus,
            "main_count": main,
        }


_jobs: dict[str, _Job] = {}


async def _run_bulk_job(
    job: _Job, *, pairs: list[dict[str, str]], keywords: list[str],
    mode: str, display: int, pace_ms: int, concurrency: int, use_cache: bool,
) -> None:
    """백그라운드 실행: (지역pair, 키워드) 조합 모두 처리.

    pair 구조:
      · mode='sigungu': {sido, sigungu}
      · mode='dong'   : {sido, sigungu, dong}
    """
    sem = asyncio.Semaphore(concurrency)

    async def one(pair: dict[str, str], kw: str) -> dict[str, Any]:
        async with sem:
            try:
                res = await _discover_one_region(
                    sigungu=pair.get("sigungu", ""),
                    dong=pair.get("dong", ""),
                    mode=mode,
                    keyword=kw,
                    display=display,
                    use_cache=use_cache,
                )
                res["sido"] = pair.get("sido", "")
                # pace 지연 (호출당)
                await asyncio.sleep(pace_ms / 1000.0)
                return res
            except Exception as e:  # noqa: BLE001
                logger.warning("bulk pair failed sido=%s sg=%s d=%s kw=%s err=%s",
                               pair.get("sido"), pair.get("sigungu"),
                               pair.get("dong"), kw, e)
                return {
                    "scope": "region",
                    "mode": mode,
                    "sido": pair.get("sido", ""),
                    "sigungu": pair.get("sigungu", ""),
                    "dong": pair.get("dong", ""),
                    "keyword": kw,
                    "summary": {
                        "total": 0, "main_count": 0, "third_party_count": 0,
                        "third_party_suspect_count": 0, "unknown_count": 0,
                        "third_party_ratio": 0.0, "is_third_party_keyword": False,
                    },
                    "items": [],
                    "exposed": False,
                    "error": str(e),
                }

    tasks: list[asyncio.Task] = []
    for pair in pairs:
        for kw in keywords:
            tasks.append(asyncio.create_task(one(pair, kw)))

    try:
        for coro in asyncio.as_completed(tasks):
            res = await coro
            job.results.append(res)
            job.done += 1
        job.status = "done"
    except Exception as e:  # noqa: BLE001
        job.status = "failed"
        job.error = str(e)
    finally:
        job.finished_at = datetime.now(tz=KST).isoformat()


@router.post("/discover-bulk-region")
async def keyword_discover_bulk_region(
    req: DiscoverBulkRegionRequest,
    user: User = Depends(require_complete_profile),
):
    """시도 / 시군구 / 전국 × 키워드 일괄 검색 (백그라운드 job).

    - scope=nationwide: 전국 229개 시군구 × keywords (시군구 모드)
    - scope=sido     : 해당 시도의 시군구 × keywords (시군구 모드)
    - scope=sigungu  : 해당 시군구의 모든 동/리 × keywords (동/리 모드)
    """
    keywords = [k.strip() for k in req.keywords if k and k.strip()]
    if not keywords:
        raise HTTPException(status_code=400, detail="keywords 비어 있음")

    tree = load_regions()

    if req.scope == "nationwide":
        pairs = all_sigungu()
        mode = "sigungu"
    elif req.scope == "sido":
        sido = (req.sido or "").strip()
        if not sido:
            raise HTTPException(status_code=400, detail="scope=sido 시 sido 필수")
        if sido not in tree:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {sido}")
        pairs = sigungu_in_sido(sido)
        if not pairs:
            raise HTTPException(status_code=400, detail=f"시군구 목록이 비어 있음: {sido}")
        mode = "sigungu"
    else:  # scope == "sigungu" — 시군구 안의 동/리 일괄
        sido = (req.sido or "").strip()
        sigungu = (req.sigungu or "").strip()
        if not sido:
            raise HTTPException(status_code=400, detail="scope=sigungu 시 sido 필수")
        if sido not in tree:
            raise HTTPException(status_code=400, detail=f"알 수 없는 시도: {sido}")
        # 세종특별자치시는 sigungu가 빈 문자열로 저장되어 있음 → 빈값도 허용
        if sigungu not in tree[sido]:
            raise HTTPException(
                status_code=400, detail=f"알 수 없는 시군구: {sido} {sigungu}",
            )
        dongs = tree[sido][sigungu]
        if not dongs:
            raise HTTPException(
                status_code=400, detail=f"동/리 목록이 비어 있음: {sido} {sigungu}",
            )
        pairs = [{"sido": sido, "sigungu": sigungu, "dong": d} for d in dongs]
        mode = "dong"

    total_pairs = len(pairs) * len(keywords)
    # 안전 상한 — 너무 큰 작업 차단 (전국 229*5 = 1145, 큰 시군구 동 100*5 = 500)
    MAX_PAIRS = 1500
    if total_pairs > MAX_PAIRS:
        raise HTTPException(
            status_code=400,
            detail=f"요청 조합이 {total_pairs}개로 상한 {MAX_PAIRS}을 초과합니다.",
        )

    job_id = uuid.uuid4().hex[:12]
    job = _Job(job_id, user.id, total_pairs)
    _jobs[job_id] = job

    asyncio.create_task(_run_bulk_job(
        job,
        pairs=pairs,
        keywords=keywords,
        mode=mode,
        display=req.display,
        pace_ms=req.pace_ms,
        concurrency=req.concurrency,
        use_cache=req.use_cache,
    ))

    # 예상 시간(초): (total / concurrency) * (avg_call ~ 1.2s + pace_ms/1000)
    est_seconds = int((total_pairs / max(req.concurrency, 1)) * (1.2 + req.pace_ms / 1000.0))

    return {
        "job_id": job_id,
        "status": "running",
        "total": total_pairs,
        "scope": req.scope,
        "sido": req.sido,
        "sigungu": req.sigungu,
        "keywords": keywords,
        "mode": mode,
        "estimated_seconds": est_seconds,
    }


@router.get("/jobs/{job_id}")
async def keyword_job_status(
    job_id: str,
    user: User = Depends(require_complete_profile),
    include_results: bool = True,
):
    """일괄 작업 진행률 / 결과 폴링."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job.owner_id != user.id:
        raise HTTPException(status_code=403, detail="not your job")
    return job.to_dict(include_results=include_results)
