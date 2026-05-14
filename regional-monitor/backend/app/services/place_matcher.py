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
# competition 솔루션과 동일하게 0.4초 페이스 + 결과 75건으로 확대
MATCH_PACE_SEC = 1.0
# 검색당 가져올 결과 개수 (competition 과 동일하게 75건 = 네이버 최대치)
MATCH_DISPLAY = 75
# 네이버 일시 오류 시 단일 쿼리 재시도 횟수
MATCH_RETRY = 1


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
# 한국 행정동 패턴: "...동" (1~6자 한글 + 0~2자리 숫자 허용 + 동)
#  - "송정1동", "압구정동", "역삼2동" 모두 매칭
_DONG_PATTERN = re.compile(r"([가-힣]{1,6}\d{0,2}동)(?![가-힣])")
# 시군구 토큰 패턴: "...구", "...군", "...시"  (1~5자 한글)
_SIGUNGU_PATTERN = re.compile(r"([가-힣]{1,5}(?:구|군|시))(?![가-힣])")
# 시도 토큰 패턴: "광주광역시", "전라남도", "서울특별시" 등 (긴 매칭 우선)
_SIDO_PATTERN = re.compile(
    r"([가-힣]+(?:광역시|특별시|특별자치시|특별자치도|특별도|북도|남도|도))(?![가-힣])"
)
# 리 토큰 (시골 주소 "○○리")
_RI_PATTERN = re.compile(r"([가-힣]{1,5}리)(?![가-힣])")
# 면/읍 토큰
_MYEON_PATTERN = re.compile(r"([가-힣]{1,5}(?:면|읍))(?![가-힣])")


def _norm_phone(p: str) -> str:
    """전화번호를 숫자만 남긴 정규형. (예: '070-5242-1573' → '07052421573')"""
    return _PHONE_DIGITS.sub("", p or "")


def _extract_dong_from_address(address: str) -> str | None:
    """주소 문자열에서 '○○동'을 추출. 여러 개면 첫 매칭(보통 행정동)."""
    if not address:
        return None
    m = _DONG_PATTERN.search(address)
    return m.group(1) if m else None


def _parse_registered_address(registered_dong: str) -> tuple[str, str, str]:
    """등록동 컬럼에서 시도/시군구/동 토큰을 추출.

    엑셀 등록동에 들어오는 패턴은 다양하므로 모두 처리:
      · "광주광역시 광산구 송정1동"     → ("광주광역시", "광산구", "송정1동")
      · "광주광역시 동구 학동"          → ("광주광역시", "동구", "학동")
      · "전라북도 고창군 아산면 계산리" → ("전라북도", "고창군", "계산리")
      · "압구정동"                      → ("", "", "압구정동")  ← 동만 들어옴

    파싱 전략:
      1) 시도 토큰을 먼저 찾아 텍스트에서 제거 (사도/시군구 패턴 중복 매칭 회피)
      2) 남은 텍스트에서 시군구 토큰 매칭
      3) 동 → 리 → 면/읍 순서로 마지막 행정 단위 매칭
      4) 시군구 추출 실패하면 lookup_region_by_dong 으로 보강

    Returns:
        (sido, sigungu, dong_or_ri) — 추출 실패 시 빈 문자열
    """
    text = (registered_dong or "").strip()
    if not text:
        return "", "", ""

    sido = ""
    sigungu = ""
    dong = ""

    # 1) 시도 토큰 (가장 긴 매칭이 우선되도록 finditer 로 모두 본 후 가장 긴 것 선택)
    sido_matches = list(_SIDO_PATTERN.finditer(text))
    if sido_matches:
        # 가장 긴 매칭을 선택 ("광주광역시" > "광주"는 시도 패턴에 안 잡힘 OK)
        best = max(sido_matches, key=lambda m: len(m.group(1)))
        sido = best.group(1)

    # 시도 토큰을 제거한 잔여 텍스트에서 시군구 검색
    remainder = text.replace(sido, " ") if sido else text

    # 2) 시군구 — "동구", "광산구", "고창군" 등
    m_sg = _SIGUNGU_PATTERN.search(remainder)
    if m_sg:
        sigungu = m_sg.group(1)

    # 3) 동/리/면 — 더 정밀한 단위 우선
    #    행정동(○○동) > 리(○○리) > 면/읍(○○면)
    m_dong = _DONG_PATTERN.search(text)
    if m_dong:
        dong = m_dong.group(1)
    else:
        m_ri = _RI_PATTERN.search(text)
        if m_ri:
            dong = m_ri.group(1)
        else:
            m_my = _MYEON_PATTERN.search(text)
            if m_my:
                dong = m_my.group(1)

    # 4) 시군구 추출 실패 + 동만 들어온 케이스 → lookup_region_by_dong 으로 보강
    if not sigungu and dong:
        cands = lookup_region_by_dong(dong)
        if len(cands) == 1:
            sido, sigungu = cands[0]

    return sido, sigungu, dong


# ─────────────────────────────────────────────────────────
# 후보 수집 — 070 기반 단일 매칭
# ─────────────────────────────────────────────────────────
async def _search_once(
    q: str,
    *,
    client: httpx.AsyncClient | None,
    retry: int = MATCH_RETRY,
) -> list[MapPlace]:
    """단일 쿼리 검색 + 일시 오류 시 재시도. competition 과 동일한 display=75 사용."""
    last_err: str | None = None
    for attempt in range(retry + 1):
        res = await search_map(q, display=MATCH_DISPLAY, client=client)
        if not res.error:
            return res.items
        last_err = res.error
        log.warning(
            "place_matcher search '%s' error (attempt %d/%d): %s",
            q, attempt + 1, retry + 1, res.error,
        )
        await asyncio.sleep(MATCH_PACE_SEC * (1 + attempt))
    log.warning("place_matcher search '%s' giving up: %s", q, last_err)
    return []


async def _search_by_phone(
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
    client: httpx.AsyncClient | None,
) -> MapPlace | None:
    """070 번호로 네이버 지도 검색 → phone/virtual_phone 일치하는 플레이스 1건 반환.

    검색 전략 (competition 솔루션 패턴 적용, display=75):
      1) "{시군구} {상호}"   — 가장 효과적 (지역 한정 + 상호)
      2) "{시도} {상호}"     — 시군구 추출 실패 또는 광역 검색
      3) "{동} {상호}"       — 동 토큰만 있을 때 (최후 폴백)
      4) "{상호}"            — 마지막 시도 (전국)

    중복 쿼리는 제거. 각 쿼리 결과 75건 중 phone 또는 virtual_phone 이
    입력 070과 일치하는 첫 플레이스 반환. 즉시 일치 발견 시 즉시 리턴
    (불필요한 추가 호출 방지).
    """
    target_phone = _norm_phone(phone_070)
    if not target_phone:
        return None

    business = (business_name or "").strip()
    if not business:
        # 상호 없으면 쿼리 구성 불가
        return None

    sido, sigungu, dong = _parse_registered_address(registered_dong)

    queries: list[str] = []
    # 1) 시군구 + 상호 (competition 패턴 = 가장 효과적)
    if sigungu:
        q = f"{sigungu} {business}"
        if q not in queries:
            queries.append(q)
    # 2) 시도 + 상호 (광역 검색)
    if sido:
        q = f"{sido} {business}"
        if q not in queries:
            queries.append(q)
    # 3) 동/리 + 상호 (시군구 추출 실패시 폴백)
    if dong and not sigungu:
        q = f"{dong} {business}"
        if q not in queries:
            queries.append(q)
    # 4) 상호만 (최후 수단 — 전국 결과)
    if business not in queries:
        queries.append(business)

    for q in queries:
        items = await _search_once(q, client=client)
        for it in items:
            if not it.place_id:
                continue
            if _norm_phone(it.phone) == target_phone:
                log.info("place_matcher matched '%s' via query '%s' (phone)", target_phone, q)
                return it
            if _norm_phone(it.virtual_phone) == target_phone:
                log.info("place_matcher matched '%s' via query '%s' (virtual_phone)", target_phone, q)
                return it
        # 쿼리 간 페이스 (네이버 IP 차단 회피)
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
