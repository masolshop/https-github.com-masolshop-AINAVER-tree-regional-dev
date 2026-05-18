"""
m.map.naver.com/search 의 정확한 JSON 임베딩 위치 확인 + 페이징.
"""
import asyncio
import httpx
import re
import json
from urllib.parse import quote

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"


async def fetch(url):
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.naver.com/",
    }
    async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
        r = await c.get(url)
        return r.status_code, r.headers.get("content-type", ""), r.text


async def main():
    q = "흥신소"
    url = f"https://m.map.naver.com/search2/search.naver?query={quote(q)}"
    status, ct, html = await fetch(url)
    print(f"status={status}  ct={ct}  size={len(html):,}")

    # 1. <script> 안의 큰 JSON 블록 위치 확인
    script_blocks = re.findall(r"<script[^>]*>([\s\S]*?)</script>", html)
    print(f"\n<script> blocks: {len(script_blocks)}")
    for i, sb in enumerate(script_blocks):
        if "흥신소" in sb or "address" in sb:
            print(f"\n  [block {i}] size={len(sb):,}")
            # 변수 할당 패턴 찾기
            assigns = re.findall(r"(?:var|let|const|window\.|self\.)\s*(\w+)\s*=\s*[{\[]", sb[:5000])
            print(f"    assignments (first 10): {assigns[:10]}")
            # 첫 200자
            head = sb.strip()[:300]
            print(f"    head: {head!r}")

    # 2. NEXT_DATA / __APP_STATE / __NUXT 모든 변종 검색
    patterns = [
        (r"__NEXT_DATA__\s*=\s*", "__NEXT_DATA__"),
        (r"__APP_STATE__\s*=\s*", "__APP_STATE__"),
        (r"window\.__APOLLO_STATE__\s*=\s*", "window.__APOLLO_STATE__"),
        (r"window\.__SEARCH__\s*=\s*", "window.__SEARCH__"),
        (r"window\.SEARCH_DATA\s*=\s*", "SEARCH_DATA"),
        (r"window\.SEARCH_RESULT\s*=\s*", "SEARCH_RESULT"),
        (r'id="__NEXT_DATA__"[^>]*>', "id=__NEXT_DATA__"),
        (r'window\.__INITIAL_STATE__\s*=\s*', "INITIAL_STATE"),
    ]
    print("\nPattern matches:")
    for pat, name in patterns:
        m = re.search(pat, html)
        print(f"  {name}: {'FOUND@' + str(m.start()) if m else 'no'}")

    # 3. address 속성 등장 패턴 분석
    print("\n'address' 컨텍스트 (앞뒤 50자):")
    for m in re.finditer(r'.{50}"address"\s*:\s*"[^"]+".{50}', html[:50000]):
        print(f"  ... {m.group()} ...")
        break

    # 4. id="__NEXT_DATA__" 강조 추출
    nd = re.search(r'<script\s+id="__NEXT_DATA__"\s+type="application/json"[^>]*>([\s\S]*?)</script>', html)
    if nd:
        body = nd.group(1)
        print(f"\n✅ __NEXT_DATA__ found: size={len(body):,}")
        try:
            data = json.loads(body)
            print(f"  top keys: {list(data.keys())}")
            # props.pageProps.searchResult
            props = data.get("props", {})
            page_props = props.get("pageProps", {})
            print(f"  pageProps keys: {list(page_props.keys())[:15]}")
        except Exception as e:
            print(f"  JSON parse fail: {e}")

    # 5. site/place 객체가 직접 임베드됐을 가능성 — id/key 패턴
    samples = re.findall(r'\{"id":"\d+","name":"[^"]*"[^}]{0,500}\}', html)
    print(f"\n place-object pattern matches: {len(samples)}")
    for s in samples[:3]:
        print(f"  {s[:200]}")

    # 6. JSON 더보기 호출 단서 — fetch / api 경로
    apis = re.findall(r"(/[a-zA-Z0-9_/-]+\.naver|/api/[a-zA-Z0-9_/-]+)\?[^\"' ]{5,100}", html)
    api_unique = list(set(apis))[:15]
    print(f"\n API paths in HTML: {len(api_unique)}")
    for a in api_unique:
        print(f"  {a}")


asyncio.run(main())
