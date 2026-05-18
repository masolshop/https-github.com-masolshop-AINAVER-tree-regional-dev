#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step B PoC — 070 → Place ID 자동 추출
====================================

전략:
  Method A) m.search.naver.com  (모바일 통합 검색, HTML)
  Method B) map.naver.com/p/api/search/allSearch  (지도 JSON API)
  Method C) m.place.naver.com/place/list?query=  (플레이스 리스트)

목표:
  - 070 번호 입력 → Place ID, 등록 동(주소), 상호명 추출
  - 5건 샘플 / 응답 시간 / 추출 정확도 측정
  - 실패 케이스 분석

사용:
  python3 poc_phone_to_place.py
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, asdict
from typing import Optional

import httpx


# 샘플 070 (등록 정보 비교용)
SAMPLES = [
    {
        "phone": "070-4534-9862",
        "expected_place_id": "1620925992",
        "expected_name": "바비네",
    },
    {
        "phone": "070-4534-7941",
        "expected_place_id": "1358095142",
        "expected_name": "대구방충망",
    },
    {
        "phone": "070-4534-2010",
        "expected_place_id": "1273908924",
        "expected_name": "청결한방충망",
    },
    {
        "phone": "070-4534-4274",
        "expected_place_id": "1852876162",
        "expected_name": "(미상)",
    },
    {
        "phone": "070-4534-5117",
        "expected_place_id": "1082735804",
        "expected_name": "(미상)",
    },
]

UA_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
)
UA_PC = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


@dataclass
class ExtractResult:
    method: str
    phone: str
    place_id: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    category: Optional[str] = None
    raw_match: bool = False           # 핵심 필드 모두 추출됨
    response_ms: int = 0
    http_status: int = 0
    error: Optional[str] = None


# ════════════════════════════════════════════════════════════
#  Method A — 모바일 통합 검색 (m.search.naver.com)
# ════════════════════════════════════════════════════════════
async def method_a_mobile_search(client: httpx.AsyncClient, phone: str) -> ExtractResult:
    """
    m.search.naver.com 통합 검색에서 플레이스 카드 추출.
    HTML 응답 안에 {"placeId": "...", "name": "...", "address": "..."} 형태로
    JSON 데이터가 임베디드 되어 있음.
    """
    t0 = time.perf_counter()
    url = f"https://m.search.naver.com/search.naver?query={phone}"
    try:
        r = await client.get(url, headers={"User-Agent": UA_MOBILE}, timeout=8.0)
        elapsed = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return ExtractResult(
                method="A_mobile_search",
                phone=phone,
                http_status=r.status_code,
                response_ms=elapsed,
                error=f"HTTP {r.status_code}",
            )

        html = r.text

        # 1) place/{ID}/home 같은 링크에서 ID 추출
        place_id_match = re.search(r'place/(\d{6,15})(?:/home|/menu|\?|")', html)
        place_id = place_id_match.group(1) if place_id_match else None

        # 2) 검색 결과 카드의 상호명 추출 — 여러 패턴 시도
        name = None
        # 2-1) "name":"..." JSON 패턴
        name_match = re.search(r'"name"\s*:\s*"([^"]{2,60})"', html)
        if name_match:
            name = name_match.group(1)
        # 2-2) data-name="..." 패턴 (백업)
        if not name:
            m2 = re.search(r'data-name="([^"]{2,60})"', html)
            if m2:
                name = m2.group(1)

        # 3) 주소 추출
        address = None
        addr_match = re.search(r'"address"\s*:\s*"([^"]{5,120})"', html)
        if addr_match:
            address = addr_match.group(1)
        else:
            # 백업: "roadAddress" 또는 "fullAddress"
            m3 = re.search(r'"(?:roadAddress|fullAddress|jibunAddress)"\s*:\s*"([^"]{5,120})"', html)
            if m3:
                address = m3.group(1)

        # 4) 카테고리
        category = None
        cat_match = re.search(r'"category"\s*:\s*"([^"]{1,40})"', html)
        if cat_match:
            category = cat_match.group(1)

        return ExtractResult(
            method="A_mobile_search",
            phone=phone,
            place_id=place_id,
            name=name,
            address=address,
            category=category,
            raw_match=bool(place_id and name and address),
            response_ms=elapsed,
            http_status=200,
        )
    except Exception as e:
        return ExtractResult(
            method="A_mobile_search",
            phone=phone,
            response_ms=int((time.perf_counter() - t0) * 1000),
            error=type(e).__name__ + ": " + str(e)[:120],
        )


# ════════════════════════════════════════════════════════════
#  Method B — 지도 통합 검색 API (map.naver.com)
# ════════════════════════════════════════════════════════════
async def method_b_map_api(client: httpx.AsyncClient, phone: str) -> ExtractResult:
    """
    map.naver.com 의 통합 검색 JSON API.
    엔드포인트: https://map.naver.com/p/api/search/allSearch?query={phone}&type=all
    """
    t0 = time.perf_counter()
    url = (
        "https://map.naver.com/p/api/search/allSearch"
        f"?query={phone}&type=all&searchCoord=126.9784;37.5666&boundary="
    )
    try:
        r = await client.get(
            url,
            headers={
                "User-Agent": UA_PC,
                "Referer": "https://map.naver.com/",
                "Accept": "application/json, text/plain, */*",
            },
            timeout=8.0,
        )
        elapsed = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return ExtractResult(
                method="B_map_api",
                phone=phone,
                http_status=r.status_code,
                response_ms=elapsed,
                error=f"HTTP {r.status_code}",
            )

        data = r.json()
        # 응답 구조: result.place.list[]
        place = None
        place_list = (
            data.get("result", {}).get("place", {}).get("list")
            if isinstance(data, dict)
            else None
        )
        if place_list and len(place_list) > 0:
            place = place_list[0]

        if not place:
            return ExtractResult(
                method="B_map_api",
                phone=phone,
                http_status=200,
                response_ms=elapsed,
                error="no_place_in_result",
            )

        return ExtractResult(
            method="B_map_api",
            phone=phone,
            place_id=str(place.get("id") or place.get("seq") or ""),
            name=place.get("name") or place.get("title"),
            address=place.get("address") or place.get("roadAddress"),
            category=place.get("category"),
            raw_match=bool(place.get("id") and place.get("name")),
            http_status=200,
            response_ms=elapsed,
        )
    except json.JSONDecodeError:
        return ExtractResult(
            method="B_map_api",
            phone=phone,
            response_ms=int((time.perf_counter() - t0) * 1000),
            error="not_json_response",
        )
    except Exception as e:
        return ExtractResult(
            method="B_map_api",
            phone=phone,
            response_ms=int((time.perf_counter() - t0) * 1000),
            error=type(e).__name__ + ": " + str(e)[:120],
        )


# ════════════════════════════════════════════════════════════
#  Method C — m.place.naver.com 리스트 검색
# ════════════════════════════════════════════════════════════
async def method_c_place_list(client: httpx.AsyncClient, phone: str) -> ExtractResult:
    """
    m.place.naver.com 의 검색 리스트 페이지.
    URL: https://m.place.naver.com/place/list?query={phone}
    """
    t0 = time.perf_counter()
    url = f"https://m.place.naver.com/place/list?query={phone}"
    try:
        r = await client.get(
            url,
            headers={"User-Agent": UA_MOBILE},
            timeout=8.0,
            follow_redirects=True,
        )
        elapsed = int((time.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            return ExtractResult(
                method="C_place_list",
                phone=phone,
                http_status=r.status_code,
                response_ms=elapsed,
                error=f"HTTP {r.status_code}",
            )

        html = r.text

        # __APOLLO_STATE__ 또는 __NEXT_DATA__ 형태로 JSON 임베디드
        place_id = None
        name = None
        address = None

        # 검색 결과 첫 번째 플레이스의 ID
        pid_match = re.search(r'PlaceSummary:(\d{6,15})', html)
        if pid_match:
            place_id = pid_match.group(1)
        else:
            # alt: place/{id}/home URL 패턴
            pid_match = re.search(r'/place/(\d{6,15})(?:/home|"|\?)', html)
            if pid_match:
                place_id = pid_match.group(1)

        # 상호명
        name_match = re.search(r'"name"\s*:\s*"([^"]{2,60})"', html)
        if name_match:
            name = name_match.group(1)

        # 주소
        addr_match = re.search(
            r'"(?:roadAddress|fullAddress|address)"\s*:\s*"([^"]{5,120})"',
            html,
        )
        if addr_match:
            address = addr_match.group(1)

        return ExtractResult(
            method="C_place_list",
            phone=phone,
            place_id=place_id,
            name=name,
            address=address,
            raw_match=bool(place_id and name),
            http_status=200,
            response_ms=elapsed,
            error=None if place_id else "no_place_id_found",
        )
    except Exception as e:
        return ExtractResult(
            method="C_place_list",
            phone=phone,
            response_ms=int((time.perf_counter() - t0) * 1000),
            error=type(e).__name__ + ": " + str(e)[:120],
        )


# ════════════════════════════════════════════════════════════
#  메인 — 5건 샘플에 대해 3가지 방법 모두 시도
# ════════════════════════════════════════════════════════════
async def main():
    print("=" * 78)
    print("070 → Place ID 자동 추출 PoC (Step B)")
    print("=" * 78)
    print(f"샘플: {len(SAMPLES)}건 × 3 방법 = {len(SAMPLES) * 3}회 호출")
    print()

    async with httpx.AsyncClient(http2=False, follow_redirects=True) as client:
        all_results: list[ExtractResult] = []

        for i, sample in enumerate(SAMPLES, 1):
            phone = sample["phone"]
            expected = sample["expected_place_id"]
            print(f"[{i}/{len(SAMPLES)}] {phone}  (예상 Place ID: {expected})")
            print("-" * 78)

            # 3 방법 동시 실행
            results = await asyncio.gather(
                method_a_mobile_search(client, phone),
                method_b_map_api(client, phone),
                method_c_place_list(client, phone),
            )

            for r in results:
                all_results.append(r)
                ok = "✓" if r.raw_match else ("△" if r.place_id else "✗")
                match = "MATCH" if r.place_id == expected else ("MISS" if r.place_id else "NONE")
                err = f"  err={r.error}" if r.error else ""
                print(
                    f"  {ok} {r.method:18s} {r.response_ms:4d}ms  "
                    f"id={(r.place_id or '—'):<12s}  "
                    f"name={(r.name or '—')[:18]:18s}  [{match}]{err}"
                )
                if r.address:
                    print(f"     addr: {r.address[:70]}")
            print()

        # 통계
        print("=" * 78)
        print("통계")
        print("=" * 78)

        for method_name in ["A_mobile_search", "B_map_api", "C_place_list"]:
            method_results = [r for r in all_results if r.method == method_name]
            full_match = sum(1 for r in method_results if r.raw_match)
            partial = sum(1 for r in method_results if r.place_id and not r.raw_match)
            none = sum(1 for r in method_results if not r.place_id)
            avg_ms = (
                sum(r.response_ms for r in method_results) / len(method_results)
                if method_results
                else 0
            )

            # Place ID 정확도 (예상 ID와 일치 여부)
            id_correct = sum(
                1
                for r, s in zip(method_results, SAMPLES)
                if r.place_id == s["expected_place_id"]
            )

            print(
                f"  {method_name:18s}  "
                f"full={full_match}/{len(method_results)}  "
                f"partial={partial}  none={none}  "
                f"id_correct={id_correct}/{len(method_results)}  "
                f"avg={avg_ms:.0f}ms"
            )

        # 추천 전략
        print()
        print("=" * 78)
        print("추천 전략")
        print("=" * 78)
        scores = {}
        for method_name in ["A_mobile_search", "B_map_api", "C_place_list"]:
            method_results = [r for r in all_results if r.method == method_name]
            id_correct = sum(
                1
                for r, s in zip(method_results, SAMPLES)
                if r.place_id == s["expected_place_id"]
            )
            scores[method_name] = id_correct
        best = max(scores, key=scores.get)
        print(
            f"  ⭐ 1차 추천: {best} (정확도 {scores[best]}/{len(SAMPLES)})"
        )

        # JSON 결과 출력 (분석용)
        print()
        print("=" * 78)
        print("JSON 상세 (분석용)")
        print("=" * 78)
        for r in all_results:
            print(json.dumps(asdict(r), ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
