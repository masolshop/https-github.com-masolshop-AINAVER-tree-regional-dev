"""네이버 모바일 플레이스 검색 결과 파서.

전략 (확정):
  · m.search.naver.com SSR HTML 안의 인라인 변수
    `naver.search.ext.loc.salt.__APOLLO_STATE__ = { ... };` 를
    brace-balanced 로 추출해 JSON 파싱.
  · Apollo cache 키: `PlaceSummary:<id>` (1페이지 노출 플레이스 5~7건).
  · GraphQL 직접 호출은 토큰/시그니처 변동이 잦아 보조 수단으로만 사용.

추출 필드 매핑:
  id              → place_id
  name            → name (HTML <mark> 태그 제거)
  phone           → phone (없으면 virtualPhone)
  category        → category
  fullAddress     → address (commonAddress 폴백)
  roadAddress     → road_address
  visitorReviewCount  → visitor_review_count
  blogCafeReviewCount → blog_review_count
  hasBooking / bookingUrl → naver_booking
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

logger = logging.getLogger("naver_search")

# ── 모바일 User-Agent 풀 (랜덤 회전) ───────────────────────────
MOBILE_UAS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
]

MOBILE_SEARCH_URL = "https://m.search.naver.com/search.naver"

# HTML <mark> 태그 제거용
_MARK_RE = re.compile(r"</?mark>", re.IGNORECASE)


@dataclass
class PlaceItem:
    """1페이지 노출 플레이스 1건."""
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
        "User-Agent": random.choice(MOBILE_UAS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": referer or "https://m.naver.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }


# ── Apollo State brace-balanced 추출 ──────────────────────────
_APOLLO_RE = re.compile(r"__APOLLO_STATE__\s*=\s*\{")


def _extract_balanced_object(s: str, start_brace_pos: int) -> str | None:
    """문자열 이스케이프를 고려해 { … } 짝 맞는 객체를 슬라이스해 반환."""
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
    # m.end() points at the '{' (because pattern includes it via \{)
    brace_pos = m.end() - 1
    raw = _extract_balanced_object(html, brace_pos)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("apollo json decode failed: %s", e)
        return None


def _strip_mark(s: str | None) -> str | None:
    if s is None:
        return None
    return _MARK_RE.sub("", s).strip()


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
    """Apollo cache 에서 PlaceSummary 엔트리들을 정렬된 순서로 추출."""
    # PlaceSummary 엔트리들은 dict 삽입 순서대로 1페이지 노출 순위와 동일.
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
        out.append(PlaceItem(
            rank=rank,
            place_id=pid,
            name=_strip_mark(val.get("name")) or "",
            phone=phone,
            category=val.get("category"),
            address=addr,
            road_address=val.get("roadAddress"),
            business_status=(val.get("businessStatus") or {}).get("status") if isinstance(val.get("businessStatus"), dict) else None,
            naver_booking=has_booking,
            visitor_review_count=_to_int(val.get("visitorReviewCount")),
            blog_review_count=_to_int(val.get("blogCafeReviewCount")),
            distance=val.get("distance"),
            x=val.get("x"),
            y=val.get("y"),
        ))
    return out


async def _fetch_html(client: httpx.AsyncClient, keyword: str) -> tuple[list[PlaceItem], str | None]:
    """모바일 검색 HTML 가져오기 → Apollo state 파싱."""
    try:
        resp = await client.get(
            MOBILE_SEARCH_URL,
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
        # 1페이지에 플레이스 섹션이 없는 키워드(예: 추상 키워드).
        return [], "no PlaceSummary entries (no place section on 1st page)"
    return items, None


# ── public API ─────────────────────────────────────────────
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


async def search_many(keywords: list[str], pace_ms: int = 400) -> list[dict[str, Any]]:
    """여러 키워드를 순차 호출 (네이버 차단 회피용 pace)."""
    out: list[dict[str, Any]] = []
    for i, kw in enumerate(keywords):
        if i > 0:
            await asyncio.sleep(pace_ms / 1000.0 + random.uniform(0, 0.2))
        out.append(await search_keyword(kw))
    return out
