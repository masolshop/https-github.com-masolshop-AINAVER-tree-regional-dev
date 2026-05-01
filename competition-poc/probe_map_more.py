"""
'지도 더보기' / '지도 영역 검색' 엔드포인트 탐색.

타겟:
1. m.map.naver.com 검색 (모바일 지도 앱)
2. 좌표 기반 검색 (압구정동 좌표로 흥신소 검색)
3. 통합검색 더보기 버튼 진입 URL
"""
import asyncio
import httpx
import re
import json
from urllib.parse import quote

UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
UA_MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"

# 압구정동 좌표 (37.5274, 127.0288)
ENDPOINTS = [
    # 1. m.map 진입 페이지 (Next.js)
    ("m_map_search", "https://m.map.naver.com/search2/search.naver?query={q}", UA_MOBILE),

    # 2. PC map - 핵심 instance API (좌표 + 영역 지정)
    ("map_v5_pcweb", "https://map.naver.com/v5/api/instance?caller=pcweb&query={q}&type=all&searchCoord=127.0288;37.5274&boundary=126.9700;37.4900;127.0900;37.5700&displayCount=50&page=1", UA_DESKTOP),

    # 3. 신 v5 API (graphql)
    ("map_v5_search", "https://map.naver.com/p/api/search/allSearch?query={q}&searchCoord=127.0288;37.5274&boundary=126.9700;37.4900;127.0900;37.5700&displayCount=50", UA_DESKTOP),

    # 4. 모바일 검색의 '지도' 탭 (where=m_map)
    ("m_search_map_tab", "https://m.search.naver.com/search.naver?where=nexearch&query={q}&sm=mtb_jum&qdt=0&prevSearchType=&p_dispcnt=", UA_MOBILE),

    # 5. m.place.naver.com 검색
    ("m_place_list", "https://m.place.naver.com/place/list?query={q}&x=127.0288&y=37.5274&level=12&output=json", UA_MOBILE),

    # 6. PC 통합검색 — 지도 섹션 보여주는 엔드포인트
    ("pc_search", "https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query={q}", UA_DESKTOP),

    # 7. PC 지도 검색 — site
    ("pc_map_site", "https://map.naver.com/v5/api/sites?query={q}&page=1&displayCount=50", UA_DESKTOP),
]


async def probe(name, url, ua):
    print(f"\n{'='*70}\n[{name}] {url[:120]}\n{'='*70}")
    headers = {
        "User-Agent": ua,
        "Accept": "application/json,text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://map.naver.com/",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
            r = await c.get(url)
            ct = r.headers.get("content-type", "")
            print(f"  status={r.status_code}  ct={ct}  size={len(r.content)}  final_url={str(r.url)[:120]}")

            t = r.text
            if "json" in ct.lower():
                try:
                    data = r.json()
                    if isinstance(data, dict):
                        print(f"  JSON keys: {list(data.keys())[:8]}")
                        # 검색 결과 안에 있는 place / result.place / items 등
                        for path in ["result.place.list", "result.places", "place.list", "items", "result.list"]:
                            cur = data
                            for p in path.split("."):
                                if isinstance(cur, dict):
                                    cur = cur.get(p)
                                else:
                                    cur = None
                                    break
                            if isinstance(cur, list):
                                print(f"  '{path}' list: {len(cur)} items")
                                if cur:
                                    print(f"    sample[0] keys: {list(cur[0].keys())[:12] if isinstance(cur[0], dict) else cur[0]}")
                                break
                    print(f"  preview: {json.dumps(data, ensure_ascii=False)[:400]}")
                except Exception as e:
                    print(f"  parse fail: {e}")
                    print(f"  body[:300]: {t[:300]}")
            else:
                # HTML — markers 찾기
                markers = ["__APOLLO_STATE__", "__NEXT_DATA__", "window.__APP", "ENTRY_POINT_DATA", "graphql", "SEARCH_RESULT", '"place":', "moreLink"]
                found = [m for m in markers if m in t]
                print(f"  HTML markers: {found}")
                print(f"  '흥신소' count: {t.count('흥신소')}, '주소' count: {t.count('주소')}, 'address' count: {t.count('address')}")
                # JSON 블록 안 주소 후보
                addrs = re.findall(r'"(?:road_?[Aa]ddress|address|jibunAddress|fullAddress|roadAddr)"\s*:\s*"([^"]{5,80})"', t)
                if addrs:
                    print(f"  found {len(addrs)} addresses, samples: {addrs[:5]}")
    except Exception as e:
        print(f"  ERR: {type(e).__name__}: {e}")


async def main():
    q = "흥신소"
    for name, tmpl, ua in ENDPOINTS:
        await probe(name, tmpl.format(q=quote(q)), ua)
        await asyncio.sleep(0.6)


asyncio.run(main())
