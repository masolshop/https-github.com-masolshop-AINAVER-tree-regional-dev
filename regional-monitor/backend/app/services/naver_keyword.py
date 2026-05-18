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


# 네이버 Apollo cache 의 플레이스 결과 키 prefix.
# 2025-Q2 까지는 "PlaceSummary:<id>" 였으나, 2026-05 무렵부터
# "PlaceListBusinessesItem:<id>" 로 변경됨. 둘 다 지원.
_PLACE_KEY_PREFIXES = ("PlaceSummary:", "PlaceListBusinessesItem:")


def _items_from_apollo(state: dict[str, Any]) -> list[PlaceItem]:
    out: list[PlaceItem] = []
    rank = 0
    for key, val in state.items():
        if not any(key.startswith(p) for p in _PLACE_KEY_PREFIXES):
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


async def _fetch_html_once(
    client: httpx.AsyncClient, keyword: str, ua_idx: int | None = None,
) -> tuple[list[PlaceItem], str | None]:
    """단일 요청 — 재시도 없음. (재시도는 _fetch_html_with_retry 에서)"""
    # UA 를 명시적으로 지정해 재시도마다 다른 UA 를 쓸 수 있게 함
    ua = _MOBILE_UAS[ua_idx % len(_MOBILE_UAS)] if ua_idx is not None else random.choice(_MOBILE_UAS)
    hdrs = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://m.naver.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    try:
        resp = await client.get(
            _MOBILE_SEARCH_URL,
            params={"where": "m_place", "query": keyword, "sm": "mtb_jum"},
            headers=hdrs,
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
        return [], "no place entries (no place section on 1st page)"
    return items, None


# [2026-05-18] 재시도 정책 — 사용자 요청: "시간 걸려도 좋으니 1페이지 노출 플레이스 모두 잡아".
# 빈 응답 / Apollo 미존재 / non-200 은 네이버가 같은 IP 의 연속 호출에 일시적으로
# "플레이스 섹션 생략" 응답을 주는 패턴이 관측됨. UA 로테이션 + 지터 백오프로 재시도.
_RETRY_MAX_ATTEMPTS = 3            # 총 시도 횟수 (첫 시도 포함)
_RETRY_BASE_DELAY_S = 0.8          # 1차 백오프 시작 (지터 0.4~1.2 추가)
_RETRY_BACKOFF_FACTOR = 1.7        # 회당 지수 배수
# 재시도해도 좋은 에러 — "진짜 0건"과 구분 불가하지만 사용자 요청대로 모두 시도.
# (정말 1페이지에 플레이스 섹션이 없는 키워드면 재시도해도 똑같이 0건 → 최종 0)
_RETRYABLE_ERRORS = (
    "Apollo state not found",
    "no place entries",
    "non-200 status",
    "HTTP error",
)


def _is_retryable(err: str | None) -> bool:
    if not err:
        return False
    return any(marker in err for marker in _RETRYABLE_ERRORS)


async def _fetch_html_with_retry(
    client: httpx.AsyncClient, keyword: str,
) -> tuple[list[PlaceItem], str | None, int]:
    """재시도 내장 fetch. 반환: (items, last_error, attempts_used)."""
    last_err: str | None = None
    for attempt in range(_RETRY_MAX_ATTEMPTS):
        # UA 를 attempt 별로 다르게 — 같은 UA 가 빈 응답을 받으면 다음에는 다른 UA
        ua_idx = attempt % len(_MOBILE_UAS)
        items, err = await _fetch_html_once(client, keyword, ua_idx=ua_idx)
        if items:
            return items, None, attempt + 1
        last_err = err
        if not _is_retryable(err):
            # 알 수 없는 에러면 더 시도 안함 (코드 버그 디버깅 신호)
            break
        if attempt == _RETRY_MAX_ATTEMPTS - 1:
            break
        # 지수 백오프 + 지터 (0.4~1.2초). 사용자: "시간 걸려도 좋으니"
        delay = _RETRY_BASE_DELAY_S * (_RETRY_BACKOFF_FACTOR ** attempt) + random.uniform(0.4, 1.2)
        logger.info(
            "naver_keyword retry kw=%r attempt=%d/%d err=%s delay=%.2fs",
            keyword, attempt + 1, _RETRY_MAX_ATTEMPTS, err, delay,
        )
        await asyncio.sleep(delay)
    return [], last_err or "unknown fetch failure", _RETRY_MAX_ATTEMPTS


# 하위 호환 alias — 외부에서 import 하는 코드를 위해 유지.
async def _fetch_html(client: httpx.AsyncClient, keyword: str) -> tuple[list[PlaceItem], str | None]:
    items, err, _ = await _fetch_html_with_retry(client, keyword)
    return items, err


async def search_keyword(
    keyword: str,
    display: int = 10,
    timeout_s: float = 14.0,
) -> dict[str, Any]:
    """키워드 1개의 플레이스 1페이지 결과 반환.

    [2026-05-18] 재시도 내장: 빈 응답/오류 시 UA 바꿔서 최대 3회 시도.
    사용자 요청 — "시간 걸려도 좋으니 네이버 1페이지 플레이스 모두 잡아."
    """
    keyword = (keyword or "").strip()
    if not keyword:
        return {"keyword": "", "source": "none", "total_listed": 0, "items": [], "error": "empty keyword"}

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        items, err, attempts = await _fetch_html_with_retry(client, keyword)

    if not items:
        return {
            "keyword": keyword,
            "source": "none",
            "total_listed": 0,
            "items": [],
            "error": err or "fetch failed",
            "attempts": attempts,
        }

    items = items[:display]
    return {
        "keyword": keyword,
        "source": "html_apollo",
        "total_listed": len(items),
        "items": [it.as_dict() for it in items],
        "error": None,
        "attempts": attempts,
    }


async def search_many(keywords: list[str], pace_ms: int = 400, display: int = 10) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, kw in enumerate(keywords):
        if i > 0:
            await asyncio.sleep(pace_ms / 1000.0 + random.uniform(0, 0.2))
        out.append(await search_keyword(kw, display=display))
    return out
