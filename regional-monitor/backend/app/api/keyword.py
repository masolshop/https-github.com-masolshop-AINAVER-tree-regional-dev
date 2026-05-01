"""키워드 발굴 API (솔루션 #1).

엔드포인트 (모두 require_complete_profile, /api/v1/keyword/*):
  · POST /keyword/discover         — 단건 키워드 검색 + 분류
  · POST /keyword/discover/batch   — 다건(최대 30개) 일괄 검색

특징:
  · 6시간 in-memory 캐시 (사용자 단위 X — 키워드 단위, 동일 키워드 재호출 비용 절감)
  · 사용자별 simple rate-limit (분당 최대 20 키워드)
  · 별도 quota 차감 없음 (070 등록 quota와 분리)

운영 통합 후 후속 작업(별도 PR):
  · DB 캐시(KeywordDiscoveryRun) 영구화
  · 즐겨찾기 키워드 + 주간 모니터링
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import require_complete_profile
from app.models.user import User
from app.services.keyword_classifier import classify_items, summarize
from app.services.naver_keyword import search_keyword

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
