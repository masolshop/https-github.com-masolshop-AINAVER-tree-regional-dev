"""네이버 1페이지 플레이스 검색 결과 파서 (키워드 발굴 솔루션 #1).

전략:
  · m.search.naver.com 모바일 SSR HTML 안의 인라인 변수
    `naver.search.ext.loc.salt.__APOLLO_STATE__ = { ... };` 를
    brace-balanced 로 추출해 JSON 파싱.
  · Apollo cache 키: `PlaceSummary:<id>` (1페이지 노출 플레이스 5~7건).

추출 필드:
  id              → place_id
  name            → name (HTML <mark> 태그 제거)
  phone           → phone (없으면 virtualPhone)
  category        → category
  fullAddress     → address (commonAddress 폴백)
  roadAddress     → road_address  ← 메인/타지역 분류의 핵심 신호
  visitorReviewCount  → visitor_review_count
  blogCafeReviewCount → blog_review_count
  hasBooking / bookingUrl → naver_booking
  distance / x / y → 좌표 정보

PoC 검증 결과(2025-05-01, 30개 키워드 93건):
  · 룰 위반 0건, main 분류 정확도 100%, 의심 케이스 1.1%.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass, asdict
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MOBILE_UAS = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
)

_MOBILE_SEARCH_URL = "https://m.search.naver.com/search.naver"
_MARK_RE = re.compile(r"</?mark>", re.IGNORECASE)
_APOLLO_RE = re.compile(r"__APOLLO_STATE__\s*=\s*\{")


@dataclass
class PlaceItem:
    rank: int
    place_id: str
    name: str
    phone: str | None = None
    category: str | None = None
    address: str | None = None
    road_address: str | None = None
    business_status: str | None = None
    naver_booking: bool = False
    visitor_review_count: int | None = None
    blog_review_count: int | None = None
    distance: str | None = None
    x: str | None = None
    y: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _headers(referer: str | None = None) -> dict[str, str]:
    return {
        "User-Agent": random.choice(_MOBILE_UAS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": referer or "https://m.naver.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }


def _extract_balanced_object(s: str, start_brace_pos: int) -> str | None:
    if start_brace_pos >= len(s) or s[start_brace_pos] != "{":
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start_brace_pos, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start_brace_pos:i + 1]
    return None


def _extract_apollo_state(html: str) -> dict[str, Any] | None:
    m = _APOLLO_RE.search(html)
    if not m:
        return None
    brace_pos = m.end() - 1
    raw = _extract_balanced_object(html, brace_pos)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("naver_keyword: apollo json decode failed: %s", e)
        return None


def _strip_mark(s: str | None) -> str | None:
    return _MARK_RE.sub("", s).strip() if s else None


def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.replace(",", "").strip()
            if not v:
                return None
        return int(v)
    except (ValueError, TypeError):
        return None


def _items_from_apollo(state: dict[str, Any]) -> list[PlaceItem]:
    out: list[PlaceItem] = []
    rank = 0
    for key, val in state.items():
        if not key.startswith("PlaceSummary:"):
            continue
        if not isinstance(val, dict):
            continue
        rank += 1
        pid = str(val.get("id") or key.split(":", 1)[1])
        phone = val.get("phone") or val.get("virtualPhone")
        addr = val.get("fullAddress") or val.get("address") or val.get("commonAddress")
        booking_url = val.get("bookingUrl") or val.get("naverBookingHubUrl")
        has_booking = bool(val.get("hasBooking")) or bool(booking_url)
        bs = val.get("businessStatus")
        bs_status = bs.get("status") if isinstance(bs, dict) else None
        out.append(PlaceItem(
            rank=rank,
            place_id=pid,
            name=_strip_mark(val.get("name")) or "",
            phone=phone,
            category=val.get("category"),
            address=addr,
            road_address=val.get("roadAddress"),
            business_status=bs_status,
            naver_booking=has_booking,
            visitor_review_count=_to_int(val.get("visitorReviewCount")),
            blog_review_count=_to_int(val.get("blogCafeReviewCount")),
            distance=val.get("distance"),
            x=val.get("x"),
            y=val.get("y"),
        ))
    return out


async def _fetch_html(client: httpx.AsyncClient, keyword: str) -> tuple[list[PlaceItem], str | None]:
    try:
        resp = await client.get(
            _MOBILE_SEARCH_URL,
            params={"where": "m_place", "query": keyword, "sm": "mtb_jum"},
            headers=_headers(referer="https://m.naver.com/"),
            timeout=12.0,
            follow_redirects=True,
        )
    except httpx.HTTPError as e:
        return [], f"HTTP error: {e}"

    if resp.status_code != 200:
        return [], f"non-200 status: {resp.status_code}"

    state = _extract_apollo_state(resp.text)
    if not state:
        return [], "Apollo state not found (markup change or block)"

    items = _items_from_apollo(state)
    if not items:
        return [], "no PlaceSummary entries (no place section on 1st page)"
    return items, None


async def search_keyword(
    keyword: str,
    display: int = 10,
    timeout_s: float = 14.0,
) -> dict[str, Any]:
    """키워드 1개의 플레이스 1페이지 결과 반환."""
    keyword = (keyword or "").strip()
    if not keyword:
        return {"keyword": "", "source": "none", "total_listed": 0, "items": [], "error": "empty keyword"}

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        items, err = await _fetch_html(client, keyword)

    if not items:
        return {
            "keyword": keyword,
            "source": "none",
            "total_listed": 0,
            "items": [],
            "error": err or "fetch failed",
        }

    items = items[:display]
    return {
        "keyword": keyword,
        "source": "html_apollo",
        "total_listed": len(items),
        "items": [it.as_dict() for it in items],
        "error": None,
    }


async def search_many(keywords: list[str], pace_ms: int = 400, display: int = 10) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, kw in enumerate(keywords):
        if i > 0:
            await asyncio.sleep(pace_ms / 1000.0 + random.uniform(0, 0.2))
        out.append(await search_keyword(kw, display=display))
    return out
