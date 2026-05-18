"""네이버 1페이지 노출 키워드 발굴 — PoC 백엔드.

엔드포인트:
  GET  /                           — 헬스체크
  POST /api/keyword-discover       — 단건 키워드 검색 + 분류
  POST /api/keyword-discover/batch — 다건 키워드 일괄 검색
  GET  /api/cached                 — 최근 캐시 결과 목록 (디버깅용)

실행:
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from naver_search import search_keyword, search_many
from classifier import classify_items, summarize

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("keyword-poc")

KST = timezone(timedelta(hours=9))


# ── 단순 in-memory 캐시 (PoC) ─────────────────────────────
# 운영 통합 시 Redis 또는 DB 캐시로 교체.
class _Cache:
    def __init__(self, ttl_seconds: int = 60 * 60 * 6):  # 6h
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
        self._store[key] = (time.time(), val)

    def all_recent(self, limit: int = 50) -> list[dict]:
        rows = sorted(self._store.items(), key=lambda kv: -kv[1][0])
        return [
            {"key": k, "cached_at": datetime.fromtimestamp(t, tz=KST).isoformat(), "value": v}
            for k, (t, v) in rows[:limit]
        ]


cache = _Cache(ttl_seconds=6 * 60 * 60)


app = FastAPI(title="네이버 1페이지 키워드 발굴 PoC", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── schemas ───────────────────────────────────────────────
class DiscoverRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=80)
    display: int = Field(10, ge=1, le=20, description="가져올 플레이스 개수(1페이지 기준 보통 5~10)")
    use_cache: bool = True


class DiscoverBatchRequest(BaseModel):
    keywords: list[str] = Field(..., min_length=1, max_length=30)
    display: int = Field(10, ge=1, le=20)
    pace_ms: int = Field(500, ge=100, le=3000, description="키워드 호출 간 간격(ms)")
    use_cache: bool = True


# ── helpers ───────────────────────────────────────────────
async def _discover_one(keyword: str, display: int, use_cache: bool) -> dict[str, Any]:
    cache_key = f"{keyword}|{display}"
    if use_cache:
        cached = cache.get(cache_key)
        if cached is not None:
            cached = {**cached, "from_cache": True}
            return cached

    started = time.time()
    raw = await search_keyword(keyword, display=display)
    items_classified = classify_items(raw["items"])
    summary = summarize(items_classified)

    result = {
        "keyword": raw["keyword"],
        "source": raw["source"],
        "fetched_at": datetime.now(tz=KST).isoformat(),
        "elapsed_ms": int((time.time() - started) * 1000),
        "summary": summary,
        "items": items_classified,
        "error": raw.get("error"),
        "from_cache": False,
    }
    cache.set(cache_key, result)
    return result


# ── routes ────────────────────────────────────────────────
@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "keyword-poc",
        "now_kst": datetime.now(tz=KST).isoformat(),
        "cache_entries": len(cache._store),
    }


@app.post("/api/keyword-discover")
async def keyword_discover(req: DiscoverRequest):
    """키워드 1개 → 1페이지 플레이스 + 메인/타지역 분류."""
    try:
        return await _discover_one(req.keyword, req.display, req.use_cache)
    except Exception as e:  # noqa: BLE001
        log.exception("discover failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/keyword-discover/batch")
async def keyword_discover_batch(req: DiscoverBatchRequest):
    """여러 키워드를 순차 호출 (pace_ms 간격)."""
    out = []
    for i, kw in enumerate(req.keywords):
        if i > 0:
            await asyncio.sleep(req.pace_ms / 1000.0)
        try:
            out.append(await _discover_one(kw, req.display, req.use_cache))
        except Exception as e:  # noqa: BLE001
            log.warning("batch keyword failed kw=%s err=%s", kw, e)
            out.append({
                "keyword": kw, "source": "none", "summary": {},
                "items": [], "error": str(e), "from_cache": False,
            })
    return {
        "count": len(out),
        "results": out,
    }


@app.get("/api/cached")
def list_cached(limit: int = 50):
    return {"total": len(cache._store), "items": cache.all_recent(limit=limit)}


# ── 정적 프론트(단일 페이지) ────────────────────────────────
import os

_FRONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.isdir(_FRONT_DIR):
    app.mount("/ui", StaticFiles(directory=_FRONT_DIR, html=True), name="frontend")
    log.info("Frontend mounted at /ui (dir=%s)", _FRONT_DIR)
