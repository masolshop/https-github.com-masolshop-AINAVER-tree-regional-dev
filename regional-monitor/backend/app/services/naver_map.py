"""
네이버 모바일 지도(m.map.naver.com) 검색 결과 파서.

데이터 소스: `m.map.naver.com/search2/search.naver?query=...&displayCount=75`
응답 임베딩: `window.__RQ_STREAMING_STATE__.push({...queries[].state.data.{totalCount,items[]}})`

PoC 검증 (2026-05-01):
- "압구정동 흥신소" → totalCount=233, items=75 중 압구정동 매칭 27건 = 이미지와 100% 일치
- "서울 강남구 흥신소" → totalCount=989, items=75 (강남 16개 동 분포)
- "서울 흥신소" → totalCount=5,184, items=75 (서울 한정)
- 페이징 파라미터(page, start, displayCount>75) 모두 무시됨 → 동/시군구 prefix 분할 필수

수집 전략:
- **Fast 모드**: 시군구 prefix 229 호출 (~30초) — 큰 시군구는 75건 캡 한계
- **Precise 모드**: 동/리 prefix 4,819 호출 (~10분) — 압구정 27건 같은 정밀 케이스 OK
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)
SEARCH_URL = "https://m.map.naver.com/search2/search.naver?query={q}&displayCount={dc}"


# ─────────────────────────────────────────────────────────────────────────────
# 공통 JSON 추출
# ─────────────────────────────────────────────────────────────────────────────
def _extract_balanced_object(text: str, start: int) -> str | None:
    """text[start]가 '{'인 위치에서 시작해 매칭되는 '}'까지 잘라냄."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if in_str:
            if ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _parse_rq_streaming(html: str) -> tuple[int, list[dict]]:
    """`window.__RQ_STREAMING_STATE__.push({...})` 호출 모두 모아서 (totalCount, items)."""
    items: list[dict] = []
    total = 0
    for m in re.finditer(r"window\.__RQ_STREAMING_STATE__\.push\(", html):
        start = m.end()
        if start >= len(html) or html[start] != "{":
            continue
        ob = _extract_balanced_object(html, start)
        if not ob:
            continue
        try:
            obj = json.loads(ob)
        except Exception:  # noqa: BLE001
            continue
        for q in obj.get("queries", []) or []:
            data = (q.get("state") or {}).get("data") or {}
            tc = data.get("totalCount", 0)
            if isinstance(tc, int) and tc > total:
                total = tc
            for it in data.get("items") or []:
                items.append(it)
    return total, items


# ─────────────────────────────────────────────────────────────────────────────
# 데이터 모델
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class MapPlace:
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str  # 지번 주소 (예: "서울특별시 강남구 압구정동")
    road_address: str  # 도로명 (빈 문자열일 때가 많음 → 타지역 단서)
    latitude: float | None
    longitude: float | None
    # 분류 결과 (classifier 채움)
    is_other_region: bool = False  # True = 타지역 (번지 없음)
    sido: str = ""
    sigungu: str = ""
    dong: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "place_id": self.place_id,
            "name": self.name,
            "category": self.category,
            "phone": self.phone,
            "virtual_phone": self.virtual_phone,
            "address": self.address,
            "road_address": self.road_address,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "is_other_region": self.is_other_region,
            "sido": self.sido,
            "sigungu": self.sigungu,
            "dong": self.dong,
        }


@dataclass
class MapSearchResult:
    query: str
    total_count: int
    items: list[MapPlace] = field(default_factory=list)
    error: str | None = None
    elapsed_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "total_count": self.total_count,
            "items": [it.as_dict() for it in self.items],
            "error": self.error,
            "elapsed_ms": self.elapsed_ms,
        }


def _to_map_place(raw: dict) -> MapPlace:
    """RQ Streaming items[i] → MapPlace."""
    name = raw.get("name") or ""
    if isinstance(name, dict):  # 일부 응답에서 {"json": "..."} 형태
        name = name.get("json", "") or ""
    addr = (raw.get("address") or "").strip()
    road = (raw.get("roadAddress") or "").strip()
    lat = raw.get("latitude") or raw.get("y")
    lng = raw.get("longitude") or raw.get("x")
    try:
        lat = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lat = None
    try:
        lng = float(lng) if lng is not None else None
    except (TypeError, ValueError):
        lng = None
    return MapPlace(
        place_id=str(raw.get("id") or ""),
        name=str(name),
        category=str(raw.get("category") or ""),
        phone=str(raw.get("tel") or ""),
        virtual_phone=str(raw.get("virtualTel") or ""),
        address=addr,
        road_address=road,
        latitude=lat,
        longitude=lng,
    )


# ─────────────────────────────────────────────────────────────────────────────
# HTTP 호출
# ─────────────────────────────────────────────────────────────────────────────
async def search_map(
    query: str,
    *,
    display: int = 75,
    client: httpx.AsyncClient | None = None,
    timeout: float = 20.0,
) -> MapSearchResult:
    """단일 쿼리 검색. (75건 이상은 받을 수 없음 — 동/시군구 prefix 분할 필요)"""
    q = (query or "").strip()
    if not q:
        return MapSearchResult(query=q, total_count=0, error="empty query")

    url = SEARCH_URL.format(q=quote(q), dc=max(1, min(75, int(display))))
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.naver.com/",
    }
    own_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True)
        own_client = True
    started = time.time()
    try:
        try:
            r = await client.get(url, headers=headers, follow_redirects=True)
        except httpx.HTTPError as e:
            return MapSearchResult(
                query=q,
                total_count=0,
                error=f"HTTP error: {type(e).__name__}: {e}",
                elapsed_ms=int((time.time() - started) * 1000),
            )
        if r.status_code != 200:
            return MapSearchResult(
                query=q,
                total_count=0,
                error=f"status={r.status_code}",
                elapsed_ms=int((time.time() - started) * 1000),
            )
        total, raw_items = _parse_rq_streaming(r.text)
        items = [_to_map_place(it) for it in raw_items]
        return MapSearchResult(
            query=q,
            total_count=total,
            items=items,
            elapsed_ms=int((time.time() - started) * 1000),
        )
    finally:
        if own_client:
            await client.aclose()


async def search_many(
    queries: list[str],
    *,
    concurrency: int = 5,
    pace_ms: int = 500,
    display: int = 75,
) -> list[MapSearchResult]:
    """여러 쿼리를 동시 N + 페이스로 호출."""
    if not queries:
        return []
    results: list[MapSearchResult | None] = [None] * len(queries)
    sem = asyncio.Semaphore(max(1, concurrency))
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.naver.com/",
    }
    pace_s = max(0.0, pace_ms / 1000.0)

    async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as client:
        async def one(idx: int, q: str) -> None:
            async with sem:
                results[idx] = await search_map(q, display=display, client=client)
                if pace_s:
                    await asyncio.sleep(pace_s)

        await asyncio.gather(*[one(i, q) for i, q in enumerate(queries)])

    out: list[MapSearchResult] = []
    for r in results:
        if r is None:
            out.append(MapSearchResult(query="", total_count=0, error="missing"))
        else:
            out.append(r)
    return out
