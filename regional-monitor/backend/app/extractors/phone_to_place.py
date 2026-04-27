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


# ────────────────────────────────────────────────────────────
# 정규식 (모듈 로드 시 1회 컴파일)
_RE_PLACE_ID = re.compile(r'place/(\d{6,15})(?:/home|/menu|\?|")')
_RE_NAME = re.compile(r'"name"\s*:\s*"([^"]{2,80})"')
_RE_ADDR_PRIMARY = re.compile(r'"address"\s*:\s*"([^"]{5,150})"')
_RE_ADDR_FALLBACK = re.compile(
    r'"(?:roadAddress|fullAddress|jibunAddress)"\s*:\s*"([^"]{5,150})"'
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

        # 1) Place ID 추출 (가장 중요)
        pid_match = _RE_PLACE_ID.search(html)
        place_id = pid_match.group(1) if pid_match else None

        if not place_id:
            return ExtractedPlace(
                success=False,
                phone=norm_phone,
                response_ms=elapsed_ms,
                error="place_id_not_found",
            )

        # 2) 상호명
        name_match = _RE_NAME.search(html)
        name = name_match.group(1) if name_match else None

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

        return ExtractedPlace(
            success=bool(place_id and name),
            phone=norm_phone,
            place_id=place_id,
            name=name,
            address=address,
            dong=dong,
            category=category,
            response_ms=elapsed_ms,
            error=None if (place_id and name) else "partial",
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
if __name__ == "__main__":
    import json
    import sys
    from dataclasses import asdict

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
            badge = "✅" if r.success else "❌"
            print(
                f"{badge} {r.phone}  "
                f"id={r.place_id or '—':<12s}  "
                f"name={(r.name or '—')[:24]:24s}  "
                f"dong={r.dong or '—':<10s}  "
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
