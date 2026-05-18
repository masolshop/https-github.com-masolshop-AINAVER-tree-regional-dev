"""
phone_to_place.py
=================
070 가상번호로 네이버 플레이스를 자동 탐색해
Place ID / 상호명 / 주소 / 카테고리 / 동(洞) 을 추출하는 모듈.

- PoC 검증 결과 m.search.naver.com 통합 검색이 100% 정확도 (5/5).
- 평균 응답 ~450ms, 동시 처리 시 ~10 req/s 예상.
- 차단/실패 시 None 반환 (raise 안 함).

사용:
    result = await extract_place_from_phone("070-4534-9862")
    # → ExtractedPlace(place_id='1620925992', name='요양원…', address='서울 종로구 홍지동', dong='홍지동')
"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from typing import Optional

import httpx

UA_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
)


# ────────────────────────────────────────────────────────────
@dataclass
class ExtractedPlace:
    """070 추출 결과. 실패 시 success=False, 나머지 필드는 None."""
    success: bool
    phone: str
    place_id: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    dong: Optional[str] = None       # 주소에서 동(洞) 단위만 분리
    category: Optional[str] = None
    response_ms: int = 0
    error: Optional[str] = None      # 실패 시 사유
    # 신뢰도 평가 (PoC에서 발견: 네이버는 정확한 매칭이 없으면 유사 결과를 보여주므로
    # 검색 결과 HTML 안에 등록 070이 실제로 노출되는지가 강한 매칭 신호임)
    phone_in_html: bool = False      # 검색 결과 HTML 안에 등록 070이 들어있는가
    confidence: float = 0.0          # 0.0~1.0 (사용자에게 'suspicious' 표기 기준)


# ────────────────────────────────────────────────────────────
# 정규식 (모듈 로드 시 1회 컴파일)
#
# 네이버 모바일 통합검색 결과의 HTML은 시기별로 마이크로한 변형이 많다.
# 다음 5가지 패턴 중 하나라도 매칭되면 place_id 로 인정한다:
#   ① m.place.naver.com/place/<id>           ← 가장 흔한 직접 링크
#   ② nmap.place.naver.com/.../did=<id>      ← 길찾기/지도 진입 링크
#   ③ "place/<id>?..." 또는 "place/<id>/..."  ← 옛 패턴(기존 정규식)
#   ④ "did":"<id>" / "placeId":"<id>"        ← JSON 데이터 필드
#   ⑤ "id":"<id>" (8자리 이상)                ← Apollo state 의 일반 id 필드
_RE_PLACE_ID = re.compile(r'place/(\d{6,15})')                # ① + ③
_RE_PLACE_ID_DID = re.compile(r'did=(\d{6,15})')              # ②
_RE_PLACE_ID_JSON = re.compile(r'"(?:placeId|did|placeNo)"\s*:\s*"?(\d{6,15})"?')  # ④
_RE_PLACE_ID_GENERIC_ID = re.compile(r'"id"\s*:\s*"(\d{8,15})"')                    # ⑤

_RE_NAME = re.compile(r'"name"\s*:\s*"([^"]{2,80})"')
# 보조: og:title 형태 (예: '<meta property="og:title" content="대구방충망 : 네이버 검색"/>')
# 검색 결과 페이지의 og:title 은 항상 검색어 자체("070-… : 네이버 검색")라 무의미하므로 사용하지 않음.
# 대신 검색 결과 카드의 <strong> 태그를 폴백으로 시도한다.
_RE_NAME_FALLBACK_STRONG = re.compile(
    r'<strong[^>]*class="[^"]*(?:tit_name|api_thumb|api_subject_bx_title|tit)[^"]*"[^>]*>([^<]{2,80})</strong>'
)

_RE_ADDR_PRIMARY = re.compile(r'"address"\s*:\s*"([^"]{5,150})"')
_RE_ADDR_FALLBACK = re.compile(
    r'"(?:roadAddress|fullAddress|jibunAddress|commonAddress|fullRoadAddress)"\s*:\s*"([^"]{5,150})"'
)
_RE_CATEGORY = re.compile(r'"category"\s*:\s*"([^"]{1,50})"')

# 동(洞) 추출: "서울 종로구 홍지동 12-3" → "홍지동"
# - 한글로 시작 + 한글/숫자 1~8자 + (동|읍|면|가|로) 접미어
# - "종로1가" 처럼 숫자가 중간에 있는 케이스도 지원
_RE_DONG = re.compile(r'(?<![가-힣])([가-힣][가-힣0-9]{0,7}(?:동|읍|면|가|로))(?:\s|\b|$)')

# 070 번호 정규화 (010-1234-5678 / 070 1234 5678 / 07012345678 모두 허용)
_RE_PHONE_NORMALIZE = re.compile(r'[^0-9]')


def normalize_phone(phone: str) -> str:
    """070-1234-5678 형태로 정규화. 11자리 미만이면 원본 반환."""
    digits = _RE_PHONE_NORMALIZE.sub('', phone)
    if len(digits) == 11 and digits.startswith('070'):
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10 and digits.startswith('070'):
        # 070-XXX-XXXX (구형) 케이스 — 거의 없음
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return phone  # 비정형은 그대로


def _phone_present_near_place_id(html: str, phone: str, place_id: Optional[str]) -> bool:
    """검색 결과 HTML에서 추출된 place_id 주변에 등록 070이 노출되는지 확인.

    네이버 검색 결과 페이지는 사용자 쿼리(070)를 자동으로 여러 곳에 박지만
    (title, meta, JS 변수, input, 탭 링크 querystring 등) 그건 모두 결과와 무관함.

    가장 강한 신호는:
      ① JSON 안의 "phone":"070-..." 필드 (Apollo state)
      ② 추출된 place_id 주변 ±2KB 텍스트 안에 등록 070이 노출
    """
    if not html or not phone or not place_id:
        return False

    digits = _RE_PHONE_NORMALIZE.sub("", phone)
    if len(digits) < 7:
        return False

    # 다양한 표기 변형
    if len(digits) == 11:
        variants = [
            phone,
            f"{digits[:3]}-{digits[3:7]}-{digits[7:]}",
            f"{digits[:3]} {digits[3:7]} {digits[7:]}",
            digits,
        ]
    else:
        variants = [phone, digits]
    variants = [v for v in variants if v]

    # ① JSON-스타일 phone 필드 (가장 강한 신호)
    for v in variants:
        if re.search(
            r'"(?:phone|virtualPhone|tel|telephone)"\s*:\s*"' + re.escape(v) + r'"',
            html,
        ):
            return True

    # ② place_id 주변 ±2000자 영역에서 검색
    #    단, 링크 querystring(bk_query=, query=, q= 등)에 박힌 검색어는 무시
    #    href/url/querystring 자동 삽입 영역을 모두 제거한 뒤 검색
    def _strip_query_strings(s: str) -> str:
        # ?query=…&… / ?q=… / &bk_query=… / ?keyword=… 안의 값 제거
        s = re.sub(r'(?:\?|&|&amp;)(?:bk_query|query|q|keyword|hint|sm)=[^"&\s<>]*', "", s, flags=re.IGNORECASE)
        # value="…" / data-…="…" 안에서 phone-like 패턴 제거
        s = re.sub(r'(?:value|data-[a-z-]+)=("|\\")[^"]*?\b\d{3,4}-?\d{3,4}-?\d{4}\b[^"]*?\1', "", s, flags=re.IGNORECASE)
        return s

    for m in re.finditer(re.escape(place_id), html):
        start = max(0, m.start() - 2000)
        end = min(len(html), m.end() + 2000)
        window = _strip_query_strings(html[start:end])
        for v in variants:
            if v in window:
                return True

    return False


def extract_dong_from_address(address: str) -> Optional[str]:
    """주소 문자열에서 동(洞) 단위만 분리.

    예) "서울 종로구 홍지동 12-3" → "홍지동"
        "서울 종로구 종로1가 25" → "종로1가"
        "경기 수원시 영통구 인계동" → "인계동"
    """
    if not address:
        return None
    matches = _RE_DONG.findall(address)
    # 마지막 매치(보통 가장 좁은 행정 단위)를 사용
    return matches[-1] if matches else None


# ────────────────────────────────────────────────────────────
# 캡차/차단 페이지 식별용 시그니처
#   - 네이버는 IP 단위 레이트리밋에 걸리면 HTTP 200 상태로
#     "비정상적인 접근이 감지되었습니다" 안내 + 캡차 폼을 내려준다.
#   - 이 페이지에는 검색 결과 카드가 없으므로 place_id 추출이 100% 실패.
#   - 단순 키워드 'captcha' 만으로 잡으면 정상 검색 결과의 잔존 키워드와 충돌할 수
#     있으므로, 캡차 폼 / 차단 안내 / form action 을 함께 검사한다.
_CAPTCHA_SIGNATURES = (
    "비정상적인 접근",
    "captcha.naver.com",
    "/captcha/",
    "자동 등록 방지",
    "automated requests",
)


def _is_naver_captcha_page(html: str) -> bool:
    """네이버 캡차/차단 페이지 여부 판정.

    True 가 반환되면 place_id 추출을 시도하지 않고 즉시 PENDING 처리.
    """
    if not html:
        return False
    # 빠른 1차 컷: 검색 결과 페이지의 표식이 전혀 없는데 captcha 시그니처가 있을 때만
    has_signature = any(sig in html for sig in _CAPTCHA_SIGNATURES)
    if not has_signature:
        return False
    # 2차 보강: 정상 검색 결과에는 'place' / 'sc_new' 같은 컨테이너 클래스가 풍부함.
    # 캡차 페이지는 form action="/captcha" 같은 명시적 marker 가 존재.
    if 'captcha.naver.com' in html or '/captcha/' in html:
        return True
    if '비정상적인 접근' in html and '자동 등록 방지' in html:
        return True
    return False


# ────────────────────────────────────────────────────────────
async def extract_place_from_phone(
    phone: str,
    client: Optional[httpx.AsyncClient] = None,
    timeout: float = 8.0,
) -> ExtractedPlace:
    """070 → Place ID + 상호 + 주소 + 동 자동 추출.

    Args:
        phone: 070 번호 (포맷 자유, 자동 정규화됨)
        client: 재사용할 httpx.AsyncClient (배치 호출 시 권장).
                None이면 매번 새로 생성.
        timeout: 요청 타임아웃 (초)

    Returns:
        ExtractedPlace. success=True면 핵심 필드 모두 채워짐.
    """
    norm_phone = normalize_phone(phone)
    t0 = time.perf_counter()

    # 클라이언트 관리
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(http2=False, follow_redirects=True)

    try:
        url = f"https://m.search.naver.com/search.naver?query={norm_phone}"
        try:
            # 🔒 글로벌 네이버 세마포어 공유 — 시스템 전체 네이버 동시 호출 제한
            from app.services.place_id_checker import _get_naver_global_sem
            async with _get_naver_global_sem():
                r = await client.get(url, headers={"User-Agent": UA_MOBILE}, timeout=timeout)
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return ExtractedPlace(
                success=False,
                phone=norm_phone,
                response_ms=int((time.perf_counter() - t0) * 1000),
                error=f"network: {type(e).__name__}",
            )

        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        if r.status_code != 200:
            return ExtractedPlace(
                success=False,
                phone=norm_phone,
                response_ms=elapsed_ms,
                error=f"http_{r.status_code}",
            )

        html = r.text

        # 0) 🚨 캡차/차단 페이지 감지
        #    네이버는 짧은 시간에 너무 많은 요청을 받으면 HTTP 200 으로 응답하면서
        #    "비정상적인 접근이 감지되었습니다" 캡차 페이지를 내려준다.
        #    이 경우엔 place_id_not_found 가 아니라 naver_blocked_captcha 로 명확히 표시.
        #    → verifier.py 가 PENDING 으로 처리, 프론트엔드에서 "잠시 후 재시도" 안내.
        if _is_naver_captcha_page(html):
            return ExtractedPlace(
                success=False,
                phone=norm_phone,
                response_ms=elapsed_ms,
                error="naver_blocked_captcha",
            )

        # 1) Place ID 추출 (가장 중요)
        # 5가지 패턴을 순차 시도하고, 가장 자주 등장하는 ID 를 선택한다.
        # (한 검색 결과에 여러 후보가 있을 수 있으므로 빈도수 기반 다수결.)
        from collections import Counter
        counter: Counter[str] = Counter()
        for rx in (
            _RE_PLACE_ID,
            _RE_PLACE_ID_DID,
            _RE_PLACE_ID_JSON,
            _RE_PLACE_ID_GENERIC_ID,
        ):
            for pid in rx.findall(html):
                counter[pid] += 1

        # 검색 결과 페이지에 잡힌 노이즈 ID 제외 (네이버 자체 시스템 ID 등)
        # — 길이 7자 미만, 또는 모두 같은 숫자(0000000) 같은 명백한 더미는 제외
        for pid in list(counter):
            if len(pid) < 7 or len(set(pid)) == 1:
                del counter[pid]

        place_id = counter.most_common(1)[0][0] if counter else None

        if not place_id:
            return ExtractedPlace(
                success=False,
                phone=norm_phone,
                response_ms=elapsed_ms,
                error="place_id_not_found",
            )

        # 2) 상호명 — JSON "name" 우선, 없으면 결과 카드 <strong> 폴백
        name_match = _RE_NAME.search(html)
        name = name_match.group(1) if name_match else None
        if not name:
            sm = _RE_NAME_FALLBACK_STRONG.search(html)
            if sm:
                # &amp; 등 엔티티 디코드
                import html as _html_mod
                name = _html_mod.unescape(sm.group(1)).strip()

        # 3) 주소 (primary → fallback)
        addr_match = _RE_ADDR_PRIMARY.search(html)
        if not addr_match:
            addr_match = _RE_ADDR_FALLBACK.search(html)
        address = addr_match.group(1) if addr_match else None

        # 4) 카테고리
        cat_match = _RE_CATEGORY.search(html)
        category = cat_match.group(1) if cat_match else None

        # 5) 동 추출
        dong = extract_dong_from_address(address) if address else None

        # 6) 검색 결과 HTML의 place_id 주변에 등록 070이 실제 들어있는지
        #    (네이버 자동 삽입 영역이 아닌 '결과 카드' 영역에서만 매칭)
        phone_in_html = _phone_present_near_place_id(html, norm_phone, place_id)

        # 7) 신뢰도 산정
        #   - 070 매칭 ○ + 메타 모두 ○ → 1.00
        #   - 070 매칭 × + 메타 모두 ○ → 0.45 (suspicious)
        #   - 메타 일부 누락                 → 더 낮음
        score = 0.0
        if phone_in_html:
            score += 0.55       # 가장 강한 신호
        if place_id:
            score += 0.20
        if name:
            score += 0.10
        if dong:
            score += 0.10
        if category:
            score += 0.05
        confidence = round(min(score, 1.0), 2)

        # success 판정: place_id 만 있으면 후속 4중 검증으로 진행 가능
        # (이름은 검증 단계의 m.place.naver.com/place/<id>/home 에서 다시 가져옴)
        # 단, 신뢰도가 낮은 경우엔 error 필드에 사유를 기록.
        is_success = bool(place_id)
        err: Optional[str] = None
        if not place_id:
            err = "place_id_not_found"
        elif not name:
            # place_id 는 잡혔으나 검색결과 카드에 상호가 없는 경우 — 검증 단계에서 보강됨
            err = "name_not_found_in_search"
        elif not phone_in_html:
            # 성공이지만 신뢰도 낮음 — 사용자 확인 권장
            err = "needs_user_review"

        return ExtractedPlace(
            success=is_success,
            phone=norm_phone,
            place_id=place_id,
            name=name,
            address=address,
            dong=dong,
            category=category,
            response_ms=elapsed_ms,
            error=err,
            phone_in_html=phone_in_html,
            confidence=confidence,
        )

    finally:
        if own_client:
            await client.aclose()


# ────────────────────────────────────────────────────────────
async def extract_batch(
    phones: list[str],
    concurrency: int = 10,
    timeout: float = 8.0,
) -> list[ExtractedPlace]:
    """여러 070을 병렬로 처리. 동일 클라이언트 재사용.

    Args:
        phones: 070 번호 리스트
        concurrency: 동시 요청 수 (기본 10)
        timeout: 각 요청 타임아웃

    Returns:
        입력 순서와 동일한 결과 리스트
    """
    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(http2=False, follow_redirects=True) as client:

        async def _one(phone: str) -> ExtractedPlace:
            async with sem:
                return await extract_place_from_phone(phone, client=client, timeout=timeout)

        return await asyncio.gather(*(_one(p) for p in phones))


# ────────────────────────────────────────────────────────────
# CLI 실행 시 간단 테스트
# ────────────────────────────────────────────────────────────
# 오프라인 단위 테스트 (네트워크 호출 없음)
def _run_unit_tests() -> None:
    """주요 헬퍼 함수의 동작을 정규식 레벨에서 검증."""
    # normalize_phone
    assert normalize_phone("07012345678") == "070-1234-5678"
    assert normalize_phone("070-1234-5678") == "070-1234-5678"
    assert normalize_phone("070 1234 5678") == "070-1234-5678"
    assert normalize_phone("invalid") == "invalid"
    print("  ✓ normalize_phone")

    # extract_dong_from_address
    cases = [
        ("서울 종로구 홍지동 12-3", "홍지동"),
        ("서울 종로구 종로1가 25", "종로1가"),
        ("경기 수원시 영통구 인계동", "인계동"),
        ("강원 원주시 단계동", "단계동"),
        ("", None),
        (None, None),
    ]
    for raw, expected in cases:
        got = extract_dong_from_address(raw or "")
        assert got == expected, f"{raw!r} → {got!r}, 기대={expected!r}"
    print(f"  ✓ extract_dong_from_address ({len(cases)}건)")

    # _phone_present_near_place_id
    # ① 정상: place_id 주변 텍스트에 070이 들어있음
    html_ok = (
        '<a href="/place/1234567890">대구방충망</a>'
        '<span class="phone">전화번호 070-4534-7941</span>'
        '<span>place_id 1234567890 정보</span>'
    )
    assert _phone_present_near_place_id(html_ok, "070-4534-7941", "1234567890")
    # ② JSON phone 필드
    html_json = '<script>{"phone":"070-1234-5678","place_id":"9999"}</script>'
    assert _phone_present_near_place_id(html_json, "070-1234-5678", "9999")
    # ③ querystring 자동 삽입은 무시
    html_qs = (
        '<a href="?bk_query=070-9999-9999">유라기획 1020172861</a>'
        '<span>전화 02-555-1234</span>'  # 다른 번호
    )
    assert not _phone_present_near_place_id(html_qs, "070-9999-9999", "1020172861"), \
        "querystring의 검색어가 잘못 매칭됨"
    # ④ place_id 없으면 False
    assert not _phone_present_near_place_id("어떤 텍스트", "070-1234", None)
    print("  ✓ _phone_present_near_place_id (4건)")


if __name__ == "__main__":
    import json
    import sys
    from dataclasses import asdict

    # --test 플래그가 있으면 단위 테스트만 실행
    if "--test" in sys.argv:
        print("== Offline unit tests ==")
        _run_unit_tests()
        print("All unit tests passed.\n")
        sys.exit(0)

    samples = sys.argv[1:] or [
        "070-4534-9862",
        "070-4534-7941",
        "070-4534-5117",
    ]

    async def _cli():
        print(f"📞 {len(samples)}건 병렬 추출 (concurrency=10)")
        print("=" * 70)
        t0 = time.perf_counter()
        results = await extract_batch(samples, concurrency=10)
        total_ms = int((time.perf_counter() - t0) * 1000)

        for r in results:
            badge = "✅" if r.success else ("⚠️ " if r.confidence >= 0.4 else "❌")
            phone_flag = "📞✓" if r.phone_in_html else "📞✗"
            print(
                f"{badge} {r.phone}  "
                f"id={r.place_id or '—':<12s}  "
                f"name={(r.name or '—')[:24]:24s}  "
                f"dong={r.dong or '—':<10s}  "
                f"{phone_flag} conf={r.confidence:.2f}  "
                f"{r.response_ms}ms  "
                f"{('[' + r.error + ']') if r.error else ''}"
            )
            if r.address:
                print(f"    addr: {r.address}")

        print("=" * 70)
        success = sum(1 for r in results if r.success)
        print(
            f"성공 {success}/{len(results)}  "
            f"총 {total_ms}ms  "
            f"평균 {total_ms / len(results):.0f}ms/건"
        )

        # JSON 출력 (프로그래매틱 사용)
        print()
        print("--- JSON ---")
        for r in results:
            print(json.dumps(asdict(r), ensure_ascii=False))

    asyncio.run(_cli())
