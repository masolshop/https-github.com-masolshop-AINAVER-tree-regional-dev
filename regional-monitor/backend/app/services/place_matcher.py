"""
PlaceMatcher — 070전번 + 등록동 기반 단일 매칭 (솔루션 #5, 레거시).

⚠️  현재 사용 상태 (2026-05):
  rank-tracker 의 _run_matching_for_ids 는 **이 모듈의 match_one() 을 더 이상
  호출하지 않는다**. 대신 monitor(노출관리 자동체크) 가 이미 검증해 RegisteredPlace.
  place_id 컬럼에 채워둔 값을 그대로 재활용한다 (A안+Y안 정책).

  사용 중인 심볼:
    · MatchCandidate           — match_candidates JSON 직렬화/역직렬화 스키마
    · serialize_match          — _run_matching_for_ids 가 단일 매칭 결과 저장 시 사용
    · deserialize_match        — API 응답에서 매칭 결과 복원
    · serialize_candidates     — (호환) 단일/리스트 모두 받아 직렬화
    · _norm_phone              — naver-map 결과의 070 정규화 (다른 곳에서 재사용)

  사용 안 함 (DEPRECATED, 호출 0건이지만 미래 fallback 대비 보존):
    · match_one
    · _search_by_phone
    · _search_by_name_and_dong

레거시 정책 (match_one 사용 시):
  · 사장님이 등록한 070 번호는 본인 번호이므로 네이버에 반드시 1개의 플레이스로 매칭된다.
  · 매칭 키: **070 (또는 가상번호) 일치** — 이게 곧 사장님 업체 확정.
  · 등록동과 실제 노출동이 일치하면 → 자동 확정 (dong_changed=False)
  · 등록동과 실제 노출동이 다르면 → 자동 확정 + 변경 노출 플래그 (dong_changed=True)
  · 070 검색 결과가 0건이면 → 이름+동 fuzzy fallback (false-positive 위험 있음)

데이터 소스: services.naver_map.search_map() (Playwright + m.place.naver.com)
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
# competition 솔루션 수준으로 끌어올림 (1.0s → 0.3s).
# 외부 드라이버에서 Semaphore 로 동시성 제한 + retry backoff 시 (1+attempt) 배율 적용.
MATCH_PACE_SEC = 0.3
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
    tracking_keywords: list[str] | None = None,
    client: httpx.AsyncClient | None,
) -> MapPlace | None:
    """⚠️ DEPRECATED — 070 번호로 네이버 지도 검색 → phone/virtual_phone 일치하는 플레이스 1건 반환.

    호출 0건 (rank-tracker 는 monitor place_id 재활용 정책). 보존 사유:
      · 향후 monitor 와 분리되거나 monitor 미사용 진입점이 추가될 때 fallback 으로 활용
      · Playwright mobile 라우트는 li.VLTHu DOM 에 phone/virtual_phone 을 노출하지
        않으므로 (MapPlace.phone = ""), 현재 이 함수는 결과를 절대 매칭하지 못한다.
        재활성화하려면 naver_map._to_map_place 에서 phone 추출을 복원해야 한다.

    검색 전략 (카테고리 키워드 기반, display=75):
      유저가 등록한 business_name은 브랜드명(예: "광주대형렉카")인 경우가 많아
      네이버에서 그 이름 그대로는 0건이 나온다. 반면 tracking_keywords는
      유저가 "순위 보고 싶은 카테고리 키워드"라서 네이버 검색에 적합.

      쿼리 우선순위 (가장 좁은 검색부터 → 폴백):
        A) "{시군구} {동} {keyword}"  — 가장 좁고 정밀 (수완동 렉카 → 12건)
        B) "{시군구} {keyword}"        — 넓은 지역 + 카테고리 (광산구 렉카 → 75건)
        C) "{동} {keyword}"            — 시군구 추출 실패시
        D) "{시군구} {상호}"           — 레거시 패턴 (브랜드명이 등록된 케이스)
        E) "{상호}"                    — 최후 폴백

      복수 키워드(예: "렉카,대형렉카")는 각각 A/B/C 패턴을 모두 시도.
      중복 쿼리는 제거. 즉시 070 일치 발견 시 리턴.
    """
    target_phone = _norm_phone(phone_070)
    if not target_phone:
        return None

    business = (business_name or "").strip()
    sido, sigungu, dong = _parse_registered_address(registered_dong)

    # 카테고리 키워드 정리 (트래킹 키워드 우선, 없으면 빈 리스트)
    kw_list: list[str] = []
    for k in (tracking_keywords or []):
        kk = (k or "").strip()
        if kk and kk not in kw_list:
            kw_list.append(kk)

    queries: list[str] = []

    def _add(q: str) -> None:
        q = q.strip()
        if q and q not in queries:
            queries.append(q)

    # A) {시군구} {동} {keyword} — 가장 정밀
    if sigungu and dong:
        for kw in kw_list:
            _add(f"{sigungu} {dong} {kw}")
    # B) {시군구} {keyword} — 도시 단위
    if sigungu:
        for kw in kw_list:
            _add(f"{sigungu} {kw}")
    # C) {동} {keyword} — 시군구 없을 때
    if dong and not sigungu:
        for kw in kw_list:
            _add(f"{dong} {kw}")
    # D) 레거시: {시군구} {상호} — 브랜드명 그대로 등록된 케이스도 커버
    if business:
        if sigungu:
            _add(f"{sigungu} {business}")
        if sido:
            _add(f"{sido} {business}")
        if dong and not sigungu:
            _add(f"{dong} {business}")
        # E) 상호만 — 최후 수단
        _add(business)

    if not queries:
        return None

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
# 폴백 매칭 — 070 검색 0건일 때 상호명+동으로 단일 후보 추출
# ─────────────────────────────────────────────────────────
def _name_tokens(name: str) -> list[str]:
    """상호명을 검색 가능한 토큰으로 분해.

    "24시대형렉카.연합렉카" → ["24시대형렉카", "연합렉카"]
    영문/숫자/한글만 남기고 구분자(./,·|·-)로 split.
    """
    if not name:
        return []
    # 구분자: 점/쉼표/슬래시/공백/하이픈/콜론/괄호 등
    parts = re.split(r"[\s./,·\-|()\[\]{}:;]+", name)
    tokens: list[str] = []
    for p in parts:
        p = p.strip()
        if len(p) >= 2 and p not in tokens:
            tokens.append(p)
    return tokens


async def _search_by_name_and_dong(
    *,
    business_name: str,
    registered_dong: str,
    tracking_keywords: list[str] | None,
    client: httpx.AsyncClient | None,
) -> MapPlace | None:
    """⚠️ DEPRECATED — 070 매칭 0건일 때 상호명+동으로 단일 후보 1건 자동 추출.

    호출 0건 (rank-tracker 폴백 정책 폐기). 보존하지만 활성화 권장하지 않음:
      · 이름 토큰 1개 일치 + 동 포함 기준은 false-positive 발생 사례 있음
        (예: 같은 동에 비슷한 이름 가게가 1개만 있으면 잘못 승격됨)
      · monitor 미사용 진입점이 추가될 경우, 사용자 확인 후에만 승격하는
        UI 분기를 추가하고 호출할 것.

    승격 조건 (false-positive 회피용 가드):
      · 검색 결과 중 "주소에 등록동 포함" + "이름 토큰 1개 이상 포함" 인 것만 후보
      · 그 후보가 정확히 1건이면 AUTO_MATCHED, 0건이거나 2건 이상이면 None
    """
    name = (business_name or "").strip()
    dong = (registered_dong or "").strip()
    if not name or not dong:
        return None

    sido, sigungu, dong_only = _parse_registered_address(registered_dong)
    tokens = _name_tokens(name)
    if not tokens:
        return None

    # 검색 쿼리: 동 + 상호 + (옵션) 동 + 첫 토큰
    queries: list[str] = []

    def _add(q: str) -> None:
        q = q.strip()
        if q and q not in queries:
            queries.append(q)

    # 1) 동 + 전체 상호
    if sigungu and dong_only:
        _add(f"{sigungu} {dong_only} {name}")
    if dong_only:
        _add(f"{dong_only} {name}")
    # 2) 동 + 첫 이름 토큰 (브랜드 prefix)
    first_token = tokens[0]
    if dong_only and first_token != name:
        _add(f"{dong_only} {first_token}")
    # 3) 동 + 첫 추적 키워드 (카테고리)
    first_kw = next(
        (k.strip() for k in (tracking_keywords or []) if k and k.strip()),
        None,
    )
    if dong_only and first_kw:
        _add(f"{dong_only} {first_kw}")

    if not queries:
        return None

    candidates: list[MapPlace] = []
    seen_pids: set[str] = set()

    for q in queries:
        items = await _search_once(q, client=client)
        for it in items:
            if not it.place_id or it.place_id in seen_pids:
                continue
            haystack = " ".join([it.address or "", it.road_address or ""])
            # 등록동 포함 필수
            if dong_only and dong_only not in haystack:
                continue
            # 이름 토큰 중 하나 이상 포함 필수
            if not any(tok in (it.name or "") for tok in tokens):
                continue
            candidates.append(it)
            seen_pids.add(it.place_id)
        await asyncio.sleep(MATCH_PACE_SEC)
        # 첫 쿼리에서 후보가 충분히 좁혀지면 추가 쿼리 생략
        if len(candidates) >= 3:
            break

    # 정확히 1건일 때만 자동 승격
    if len(candidates) == 1:
        log.info(
            "place_matcher fallback matched '%s' / '%s' → place_id=%s",
            name, dong, candidates[0].place_id,
        )
        return candidates[0]
    log.info(
        "place_matcher fallback ambiguous: name='%s' dong='%s' candidates=%d",
        name, dong, len(candidates),
    )
    return None


# ─────────────────────────────────────────────────────────
# 메인 진입점 — 070+동 단일 매칭
# ─────────────────────────────────────────────────────────
async def match_one(
    *,
    phone_070: str,
    business_name: str,
    registered_dong: str,
    tracking_keywords: list[str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> MatchResult:
    """⚠️ DEPRECATED — 단일 행 매칭 (070을 키로 플레이스 1건 확정).

    호출 0건. rank-tracker 의 _run_matching_for_ids 는 monitor 가 채워둔
    RegisteredPlace.place_id 를 직접 신뢰하므로 이 함수를 거치지 않는다.

    보존 사유: monitor 미사용 진입점이 추가될 경우 fallback 으로 활용 가능.
    재활성화 전 검토 사항:
      · _search_by_phone 가 동작하려면 naver_map._to_map_place 에서 phone 복원 필요
      · _search_by_name_and_dong fallback 은 false-positive 위험으로 비활성 권장
        (사용자 확인 UI 분기 추가 후에만 활성화)

    정책:
      · 070 매칭 성공 → AUTO_MATCHED (등록동 일치 여부와 무관)
      · 등록동 ≠ 실제 노출동  → dong_changed=True (배너 알림 대상)
      · 070 검색 결과 0건    → NEEDS_MANUAL (예외 케이스, 거의 없음)

    Args:
        phone_070: 사용자 070 가상번호 (예: "070-5242-1573")
        business_name: 상호 (검색 쿼리 보조용 — 브랜드명일 수 있음)
        registered_dong: 등록동 (변경 노출 비교 기준)
        tracking_keywords: 카테고리 키워드 리스트 (예: ["렉카","대형렉카"]) —
            검색 쿼리에 사용. business_name이 브랜드명일 때 필수.

    Returns:
        MatchResult — status / place_id / matched 1건 / dong_changed 플래그
    """
    try:
        hit = await _search_by_phone(
            phone_070=phone_070,
            business_name=business_name,
            registered_dong=registered_dong,
            tracking_keywords=tracking_keywords,
            client=client,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("match_one search failed: %s", e)
        return MatchResult(
            status="NEEDS_MANUAL",
            place_id=None,
            error=f"search_error: {type(e).__name__}: {e}",
        )

    fallback_used = False
    if not hit:
        # 070 매칭 0건 — 상호명+동 폴백 매칭 시도 (false-positive 회피 위해
        # 결과가 정확히 1건일 때만 승격).
        try:
            hit = await _search_by_name_and_dong(
                business_name=business_name,
                registered_dong=registered_dong,
                tracking_keywords=tracking_keywords,
                client=client,
            )
        except Exception as e:  # noqa: BLE001
            log.exception("match_one fallback failed: %s", e)
            hit = None
        if not hit:
            # 폴백도 실패 → NEEDS_MANUAL (프론트는 패널 숨기므로 사용자에게 보이지 않음)
            return MatchResult(status="NEEDS_MANUAL", place_id=None)
        fallback_used = True

    # 070 일치(또는 이름+동 폴백) → 자동 확정
    reasons = ["name_dong_fallback_matched"] if fallback_used else ["phone_matched"]
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
