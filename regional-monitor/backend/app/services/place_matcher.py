"""
PlaceMatcher — 070전번 + 등록동 기반 단일 매칭 (솔루션 #5).

정책 (단순화):
  · 사장님이 등록한 070 번호는 본인 번호이므로 네이버에 반드시 1개의 플레이스로 매칭된다.
  · 매칭 키: **070 (또는 가상번호) 일치** — 이게 곧 사장님 업체 확정.
  · 등록동과 실제 노출동이 일치하면 → 자동 확정 (dong_changed=False)
  · 등록동과 실제 노출동이 다르면 → 자동 확정 + **변경 노출 플래그** (dong_changed=True)
    → 대시보드 배너로 "변경 노출 N건" 안내 (사용자 개입 불필요)
  · 070 검색 결과가 0건이면 NEEDS_MANUAL (이론상 거의 없음 — 신규 등록 직후 인덱싱 지연 등)

결과 상태(match_status):
  · AUTO_MATCHED   — 070 일치 (등록동 일치 여부와 무관, dong_changed 플래그로 구분)
  · NEEDS_MANUAL   — 070 검색 결과 0건 등 매우 예외적 케이스

폐기된 개념:
  · 점수제(70/50/30) → 070 일치 = 무조건 자동 확정
  · REVIEW_NEEDED / NOT_FOUND 상태 → 모두 제거
  · 후보 다중 선택 UI → 단일 매칭만 사용 (다이얼로그 폐기)

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

# 매칭 시 네이버 호출당 페이스 (IP 차단 회피)
MATCH_PACE_SEC = 0.8


@dataclass
class MatchCandidate:
    """매칭된 플레이스 정보 (단일). 변경 노출 확인용으로만 사용."""
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str
    # 매칭 근거 라벨 (점수 대신 단순 라벨만 기록)
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MatchResult:
    """매칭 1회 결과.

    Attributes:
        status: AUTO_MATCHED / NEEDS_MANUAL
        place_id: 매칭된 네이버 place_id (NEEDS_MANUAL이면 None)
        matched: 매칭된 플레이스 상세 정보 (1건, 후보 다중 X)
        dong_changed: 등록동과 실제 노출동이 다른지 여부 (변경 노출 플래그)
        actual_dong: 실제 매칭된 플레이스의 주소에서 추출한 동명 (변경 노출일 때만 유효)
        error: 매칭 실패 시 사유
    """
    status: str
    place_id: str | None
    matched: MatchCandidate | None = None
    dong_changed: bool = False
    actual_dong: str | None = None
    error: str | None = None


# ─────────────────────────────────────────────────────────
# 정규화 헬퍼
# ─────────────────────────────────────────────────────────
_PHONE_DIGITS = re.compile(r"\D+")
# 한국 행정동 패턴: "...동" (1~6자 한글 + 동) / "...로" 등 도로명은 매칭 안 함
_DONG_PATTERN = re.compile(r"([가-힣]{1,6}동)(?![가-힣])")


def _norm_phone(p: str) -> str:
    """전화번호를 숫자만 남긴 정규형. (예: '070-5242-1573' → '07052421573')"""
    return _PHONE_DIGITS.sub("", p or "")


def _extract_dong_from_address(address: str) -> str | None:
    """주소 문자열에서 '○○동'을 추출. 여러 개면 첫 매칭(보통 행정동)."""
    if not address:
        return None
    m = _DONG_PATTERN.search(address)
    return m.group(1) if m else None


# ─────────────────────────────────────────────────────────
# 후보 수집 — 070 기반 단일 매칭
# ─────────────────────────────────────────────────────────
async def _search_by_phone(
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
    client: httpx.AsyncClient | None,
) -> MapPlace | None:
    """070 번호로 네이버 지도 검색 → phone/virtual_phone 일치하는 플레이스 1건 반환.

    검색 전략 (점수제 없이 070 매칭만 사용):
      1) "{시도} {시군구} {등록동} {상호}" — 가장 정밀한 쿼리
      2) "{등록동} {상호}" — region 매칭 실패 시
      3) "{상호}" — 최후 수단

    각 쿼리 결과에서 phone 또는 virtual_phone이 입력 070과 정확히 일치하는
    첫 플레이스를 즉시 반환한다. 즉, 070이 확실하면 단일 매칭 완료.
    """
    target_phone = _norm_phone(phone_070)
    if not target_phone:
        return None

    business = (business_name or "").strip()
    dong = (registered_dong or "").strip()

    queries: list[str] = []
    # 1) 정밀 쿼리 (시도 시군구 등록동 상호)
    regions = lookup_region_by_dong(dong) if dong else []
    if regions and business:
        for sido, sigungu in regions[:2]:
            q = " ".join(filter(None, [sido, sigungu, dong, business]))
            if q not in queries:
                queries.append(q)
    # 2) "등록동 상호"
    if business and dong:
        q = f"{dong} {business}"
        if q not in queries:
            queries.append(q)
    # 3) "상호"만
    if business:
        if business not in queries:
            queries.append(business)

    for q in queries:
        res = await search_map(q, display=15, client=client)
        if res.error:
            log.warning("place_matcher search '%s' error: %s", q, res.error)
            await asyncio.sleep(MATCH_PACE_SEC)
            continue
        for it in res.items:
            if not it.place_id:
                continue
            if _norm_phone(it.phone) == target_phone:
                return it
            if _norm_phone(it.virtual_phone) == target_phone:
                return it
        await asyncio.sleep(MATCH_PACE_SEC)

    return None


# ─────────────────────────────────────────────────────────
# 메인 진입점 — 070+동 단일 매칭
# ─────────────────────────────────────────────────────────
async def match_one(
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
    client: httpx.AsyncClient | None = None,
) -> MatchResult:
    """단일 행 매칭 — 070을 키로 플레이스 1건 확정 + 등록동 변경 여부 체크.

    정책:
      · 070 매칭 성공 → AUTO_MATCHED (등록동 일치 여부와 무관)
      · 등록동 ≠ 실제 노출동  → dong_changed=True (배너 알림 대상)
      · 070 검색 결과 0건    → NEEDS_MANUAL (예외 케이스, 거의 없음)

    Args:
        phone_070: 사용자 070 가상번호 (예: "070-5242-1573")
        business_name: 상호 (검색 쿼리 보조용)
        registered_dong: 등록동 (변경 노출 비교 기준)

    Returns:
        MatchResult — status / place_id / matched 1건 / dong_changed 플래그
    """
    try:
        hit = await _search_by_phone(
            phone_070=phone_070,
            business_name=business_name,
            registered_dong=registered_dong,
            client=client,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("match_one search failed: %s", e)
        return MatchResult(
            status="NEEDS_MANUAL",
            place_id=None,
            error=f"search_error: {type(e).__name__}: {e}",
        )

    if not hit:
        # 070 매칭 0건 — 매우 예외적 케이스 (인덱싱 지연/번호 변경 등)
        return MatchResult(status="NEEDS_MANUAL", place_id=None)

    # 070 일치 → 자동 확정
    reasons = ["phone_matched"]
    haystack = " ".join([hit.address or "", hit.road_address or ""])

    dong = (registered_dong or "").strip()
    actual_dong = _extract_dong_from_address(haystack)
    dong_changed = False
    if dong:
        if dong in haystack:
            reasons.append("dong_match")
        else:
            dong_changed = True
            reasons.append("dong_changed")

    candidate = MatchCandidate(
        place_id=hit.place_id,
        name=hit.name,
        category=hit.category,
        phone=hit.phone,
        virtual_phone=hit.virtual_phone,
        address=hit.address,
        reasons=reasons,
    )

    return MatchResult(
        status="AUTO_MATCHED",
        place_id=hit.place_id,
        matched=candidate,
        dong_changed=dong_changed,
        actual_dong=actual_dong if dong_changed else None,
    )


# ─────────────────────────────────────────────────────────
# 직렬화 (match_candidates 컬럼은 단일 매칭 정보만 저장)
# ─────────────────────────────────────────────────────────
def serialize_match(m: MatchCandidate | None) -> str | None:
    """매칭된 플레이스 1건을 JSON으로 직렬화 (DB match_candidates 컬럼)."""
    if not m:
        return None
    return json.dumps(m.to_dict(), ensure_ascii=False)


def deserialize_match(raw: str | None) -> dict[str, Any] | None:
    """match_candidates JSON → dict 1건."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        # 레거시 호환: 과거에는 list로 저장됨. list면 첫 원소만 채택.
        if isinstance(data, list):
            return data[0] if data else None
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        pass
    return None


# 레거시 호환 (다른 곳에서 import 중일 수 있어 wrapper 유지)
def serialize_candidates(cands: list[MatchCandidate] | MatchCandidate | None) -> str | None:
    """레거시 호환 — 리스트로 들어와도 첫 원소만 저장."""
    if cands is None:
        return None
    if isinstance(cands, list):
        return serialize_match(cands[0]) if cands else None
    return serialize_match(cands)


def deserialize_candidates(raw: str | None) -> list[dict[str, Any]]:
    """레거시 호환 — 항상 list로 반환 (0개 또는 1개)."""
    m = deserialize_match(raw)
    return [m] if m else []
