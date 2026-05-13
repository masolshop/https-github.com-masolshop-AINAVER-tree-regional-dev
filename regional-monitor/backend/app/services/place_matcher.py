"""
PlaceMatcher — 070전번 + 등록동 + 상호 → 네이버 플레이스 ID 자동 매칭 (솔루션 #5).

매칭 알고리즘 (가중치 점수):
  · 070전번 정확 일치        : 50점
  · 가상번호(virtualTel) 일치 : 50점
  · 상호 정확 일치           : 30점
  · 상호 부분 일치 (편집거리≤2) : 15점
  · 등록동이 주소에 포함     : 20점

매칭 결정:
  · 70점 이상 → AUTO_MATCHED, place_id 자동 저장
  · 50-69점  → REVIEW_NEEDED, 후보 3개 저장 (사용자가 선택)
  · 50점 미만 → NOT_FOUND

데이터 소스: services.naver_map.search_map() (m.map.naver.com)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field, asdict
from typing import Any

import httpx

from app.services.naver_map import MapPlace, search_map
from app.services.region_loader import lookup_region_by_dong

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# 결정 임계치
# ─────────────────────────────────────────────────────────
THRESHOLD_AUTO = 70   # ≥ 70 → AUTO_MATCHED
THRESHOLD_REVIEW = 50  # 50~69 → REVIEW_NEEDED, < 50 → NOT_FOUND
TOP_CANDIDATES = 3    # REVIEW_NEEDED일 때 저장할 후보 개수

# 매칭 시 네이버 호출 호출당 페이스 (IP 차단 회피)
MATCH_PACE_SEC = 0.8


@dataclass
class MatchCandidate:
    """후보 1건 + 점수 + 점수 근거."""
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str
    score: int
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MatchResult:
    """매칭 1회 결과."""
    status: str  # AUTO_MATCHED / REVIEW_NEEDED / NOT_FOUND
    confidence: int
    place_id: str | None
    candidates: list[MatchCandidate] = field(default_factory=list)
    error: str | None = None


# ─────────────────────────────────────────────────────────
# 정규화 헬퍼
# ─────────────────────────────────────────────────────────
_PHONE_DIGITS = re.compile(r"\D+")


def _norm_phone(p: str) -> str:
    """전화번호를 숫자만 남긴 정규형으로. (예: '070-5242-1573' → '07052421573')"""
    return _PHONE_DIGITS.sub("", p or "")


def _norm_name(s: str) -> str:
    """상호를 공백/특수문자 제거한 비교용 정규형으로."""
    return re.sub(r"[\s\-_·,.()\[\]·]+", "", (s or "")).lower()


def _edit_distance(a: str, b: str, limit: int = 3) -> int:
    """제한적 Levenshtein 거리 (limit 초과 시 limit+1 반환). 짧은 상호 비교용."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > limit:
        return limit + 1
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        min_in_row = cur[0]
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(
                prev[j] + 1,        # deletion
                cur[j - 1] + 1,     # insertion
                prev[j - 1] + cost, # substitution
            )
            if cur[j] < min_in_row:
                min_in_row = cur[j]
        if min_in_row > limit:
            return limit + 1
        prev = cur
    return prev[lb]


# ─────────────────────────────────────────────────────────
# 점수 산출
# ─────────────────────────────────────────────────────────
def score_candidate(
    item: MapPlace,
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
) -> tuple[int, list[str]]:
    """단일 후보의 매칭 점수를 산출. (0~100, 이유 목록)"""
    reasons: list[str] = []
    score = 0

    norm_target_phone = _norm_phone(phone_070)
    norm_item_phone = _norm_phone(item.phone)
    norm_item_vphone = _norm_phone(item.virtual_phone)

    # 1) 전번 매칭 (최대 50점, 중복 가산 없음)
    if norm_target_phone:
        if norm_item_phone == norm_target_phone:
            score += 50
            reasons.append("phone_exact:+50")
        elif norm_item_vphone == norm_target_phone:
            score += 50
            reasons.append("virtual_phone_exact:+50")

    # 2) 상호 매칭 (최대 30점)
    nt = _norm_name(business_name)
    nb = _norm_name(item.name)
    if nt and nb:
        if nt == nb:
            score += 30
            reasons.append("name_exact:+30")
        elif nt in nb or nb in nt:
            score += 20
            reasons.append("name_substring:+20")
        else:
            ed = _edit_distance(nt, nb, limit=3)
            if ed <= 2:
                score += 15
                reasons.append(f"name_fuzzy(d={ed}):+15")

    # 3) 등록동 주소 포함 (최대 20점)
    dong = (registered_dong or "").strip()
    if dong:
        haystack = " ".join([item.address or "", item.road_address or ""])
        if dong and dong in haystack:
            score += 20
            reasons.append("dong_in_address:+20")

    return min(100, score), reasons


# ─────────────────────────────────────────────────────────
# 후보 수집
# ─────────────────────────────────────────────────────────
async def _search_candidates(
    *,
    business_name: str,
    registered_dong: str,
    client: httpx.AsyncClient | None,
) -> list[MapPlace]:
    """등록동 + 상호로 네이버 지도 검색해 후보 N개를 수집.

    여러 region 후보가 있으면 첫 후보로 시도하고, 부족하면 dong 단일 쿼리로
    추가 시도한다.
    """
    business = (business_name or "").strip()
    dong = (registered_dong or "").strip()
    if not (business or dong):
        return []

    queries: list[str] = []
    # 1) "시도 시군구 등록동 상호" 가장 정밀한 쿼리부터
    regions = lookup_region_by_dong(dong) if dong else []
    if regions and business:
        # 매칭된 region 후보 중 최대 2개까지만 (대부분 1개)
        for sido, sigungu in regions[:2]:
            q = " ".join(filter(None, [sido, sigungu, dong, business]))
            if q not in queries:
                queries.append(q)
    # 2) "등록동 상호" (region 매칭 실패 케이스 대비)
    if business and dong:
        q = f"{dong} {business}"
        if q not in queries:
            queries.append(q)
    # 3) 상호만 (마지막 fallback)
    if business and not queries:
        queries.append(business)

    seen_ids: set[str] = set()
    collected: list[MapPlace] = []
    for q in queries:
        res = await search_map(q, display=15, client=client)
        if res.error:
            log.warning("place_matcher search '%s' error: %s", q, res.error)
            await asyncio.sleep(MATCH_PACE_SEC)
            continue
        for it in res.items:
            if not it.place_id or it.place_id in seen_ids:
                continue
            seen_ids.add(it.place_id)
            collected.append(it)
        # 페이스
        await asyncio.sleep(MATCH_PACE_SEC)
        # 충분한 후보를 모았으면 조기 종료
        if len(collected) >= 10:
            break
    return collected


# ─────────────────────────────────────────────────────────
# 메인 진입점
# ─────────────────────────────────────────────────────────
async def match_one(
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
    client: httpx.AsyncClient | None = None,
) -> MatchResult:
    """단일 행 매칭 — 070+상호+동으로 place_id 자동 탐색.

    Args:
        phone_070: 사용자 070 가상번호 (예: "070-5242-1573")
        business_name: 상호 (예: "OO흥신소")
        registered_dong: 등록동 (예: "압구정동")

    Returns:
        MatchResult — status / confidence / place_id (자동 매칭 시) / 후보 목록
    """
    try:
        cands_raw = await _search_candidates(
            business_name=business_name,
            registered_dong=registered_dong,
            client=client,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("match_one search failed: %s", e)
        return MatchResult(
            status="NOT_FOUND",
            confidence=0,
            place_id=None,
            error=f"search_error: {type(e).__name__}: {e}",
        )

    if not cands_raw:
        return MatchResult(status="NOT_FOUND", confidence=0, place_id=None)

    scored: list[MatchCandidate] = []
    for it in cands_raw:
        sc, reasons = score_candidate(
            it,
            phone_070=phone_070,
            business_name=business_name,
            registered_dong=registered_dong,
        )
        scored.append(MatchCandidate(
            place_id=it.place_id,
            name=it.name,
            category=it.category,
            phone=it.phone,
            virtual_phone=it.virtual_phone,
            address=it.address,
            score=sc,
            reasons=reasons,
        ))
    scored.sort(key=lambda c: c.score, reverse=True)
    best = scored[0]

    if best.score >= THRESHOLD_AUTO:
        return MatchResult(
            status="AUTO_MATCHED",
            confidence=best.score,
            place_id=best.place_id,
            candidates=scored[:TOP_CANDIDATES],
        )
    if best.score >= THRESHOLD_REVIEW:
        return MatchResult(
            status="REVIEW_NEEDED",
            confidence=best.score,
            place_id=None,
            candidates=scored[:TOP_CANDIDATES],
        )
    return MatchResult(
        status="NOT_FOUND",
        confidence=best.score,
        place_id=None,
        candidates=scored[:TOP_CANDIDATES],
    )


def serialize_candidates(cands: list[MatchCandidate]) -> str:
    """match_candidates 컬럼 저장용 JSON 직렬화."""
    return json.dumps([c.to_dict() for c in cands], ensure_ascii=False)


def deserialize_candidates(raw: str | None) -> list[dict[str, Any]]:
    """JSON 문자열 → dict 리스트."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except Exception:  # noqa: BLE001
        pass
    return []
