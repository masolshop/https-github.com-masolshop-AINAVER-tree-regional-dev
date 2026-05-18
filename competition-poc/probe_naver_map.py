"""
네이버 지도 섹션 API 구조 조사 — '흥신소' 키워드 기반.

목표:
1. 시나리오 A: 키워드 1번으로 전국 결과 받아오기 (가능한지 확인)
2. 시나리오 B: '서울 흥신소' / '강남구 흥신소' / '압구정동 흥신소' 단위 호출 비교
3. 응답 구조에서 주소 형태 (번지 없는 케이스 = 타지역) 확인
"""
import asyncio
import json
import httpx
from urllib.parse import quote

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"

# 네이버 지도 검색 API 후보들 (모바일/데스크톱)
ENDPOINTS = {
    # 1. 모바일 통합검색 — 지도 섹션 SSR
    "m_search": "https://m.search.naver.com/search.naver?where=m&sm=mtb_jum&query={q}",

    # 2. 데스크톱 지도 검색 (가장 널리 알려진 비공식 API)
    "map_v5_instance": "https://map.naver.com/v5/api/instance?caller=pcweb&query={q}&type=all&page=1&displayCount=50&isPlaceRecommendationReplace=true&lang=ko",

    # 3. 데스크톱 지도 — 장소 검색 신버전 (2024+)
    "map_search_place": "https://map.naver.com/p/api/search/allSearch?query={q}&type=all&searchCoord=127.0276;37.4979&boundary=",

    # 4. 모바일 지도 섹션 (지도 위 핀 데이터)
    "m_map": "https://m.map.naver.com/search2/searchMore.naver?query={q}&sm=clk&style=v5&displayCount=50&type=SITE_1&page=1",
}

async def probe(name: str, url: str):
    print(f"\n{'='*60}\n[{name}] {url[:100]}...\n{'='*60}")
    headers = {
        "User-Agent": UA,
        "Accept": "application/json,text/html,*/*",
        "Referer": "https://map.naver.com/",
        "Accept-Language": "ko-KR,ko;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
            r = await c.get(url)
            print(f"  status={r.status_code}  content-type={r.headers.get('content-type','?')}  size={len(r.content)}")
            ct = r.headers.get("content-type", "")
            if "json" in ct:
                try:
                    data = r.json()
                    keys = list(data.keys()) if isinstance(data, dict) else type(data).__name__
                    print(f"  JSON top-level: {keys}")
                    print(f"  preview: {json.dumps(data, ensure_ascii=False)[:500]}")
                except Exception as e:
                    print(f"  JSON parse fail: {e}")
                    print(f"  body[:300]: {r.text[:300]}")
            else:
                # HTML — apollo state 또는 script JSON 위치 확인
                t = r.text
                markers = ["__APOLLO_STATE__", "window.__APP", "__NEXT_DATA__", '"places"', "searchAdsList", "siteSearchResult", "place\":"]
                found = [m for m in markers if m in t]
                print(f"  HTML markers found: {found}")
                # '흥신소' 라는 단어가 몇 번 등장하는지
                print(f"  '흥신소' occurrences: {t.count('흥신소')}")
                # 주소 패턴 미리보기 (도로명/지번 추출)
                import re
                addrs = re.findall(r'"(?:road_)?[Aa]ddress[^"]*":"([^"]{5,80})"', t)[:5]
                if addrs:
                    print(f"  sample addresses: {addrs}")
    except Exception as e:
        print(f"  ERROR: {type(e).__name__}: {e}")

async def main():
    q = "흥신소"
    for name, tmpl in ENDPOINTS.items():
        await probe(name, tmpl.format(q=quote(q)))
        await asyncio.sleep(0.5)

asyncio.run(main())
