"""
m.map 페이징/영역 검색 우회 시도:
1. searchCoord (좌표 지정) — 압구정동, 부산, 대전 등 다른 지역 좌표
2. boundary (영역 BBox) — 수도권 / 영남 / 호남 등
3. displayCount 늘리기 (50/100/200)
4. mapBoundary, x, y, level 파라미터 시도
5. start (오프셋) 시도
"""
import asyncio
import httpx
import re
import json
from urllib.parse import quote
from collections import Counter

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"


def _balanced(text, start):
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0; in_str = False; esc = False
    for i in range(start, len(text)):
        c = text[i]
        if esc: esc = False; continue
        if in_str:
            if c == "\\": esc = True
            elif c == '"': in_str = False
            continue
        if c == '"': in_str = True
        elif c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: return text[start:i+1]
    return None


def parse_items(html):
    items = []
    total = 0
    for m in re.finditer(r"window\.__RQ_STREAMING_STATE__\.push\(", html):
        s = m.end()
        if s >= len(html) or html[s] != "{": continue
        ob = _balanced(html, s)
        if not ob: continue
        try:
            obj = json.loads(ob)
        except: continue
        for q in obj.get("queries", []) or []:
            data = (q.get("state") or {}).get("data") or {}
            tc = data.get("totalCount", 0)
            if isinstance(tc, int) and tc > total: total = tc
            for it in data.get("items") or []:
                items.append(it)
    return total, items


async def fetch(url):
    headers = {"User-Agent": UA, "Referer": "https://m.naver.com/"}
    async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
        r = await c.get(url)
        return r.status_code, r.text


# 시·도 대표 좌표 (수동)
SIDO_COORDS = {
    "서울": (126.9784, 37.5665),
    "부산": (129.0756, 35.1796),
    "대구": (128.6014, 35.8714),
    "광주": (126.8526, 35.1595),
    "대전": (127.3845, 36.3504),
    "강원": (128.1555, 37.8228),
    "제주": (126.5312, 33.4996),
    "압구정동": (127.0288, 37.5274),
    "부평구": (126.7220, 37.4914),
}


async def main():
    q = "흥신소"
    print(f"\n## 1. 좌표 변경 시도 (query='{q}')")
    seen_ids = set()
    region_results = {}
    for label, (x, y) in SIDO_COORDS.items():
        # 가장 흔한 좌표 파라미터 조합 시도
        for params in [
            f"&x={x}&y={y}",
            f"&searchCoord={x};{y}",
            f"&clientX={x}&clientY={y}",
            f"&lng={x}&lat={y}",
        ]:
            url = f"https://m.map.naver.com/search2/search.naver?query={quote(q)}{params}&displayCount=100"
            try:
                st, html = await fetch(url)
                t, items = parse_items(html)
                ids_now = set(it.get("id") for it in items)
                new_ids = ids_now - seen_ids
                addr_sample = items[0].get("address") if items else "-"
                if new_ids or label == "서울":
                    print(f"  [{label}] {params:40s}  total={t:6d} items={len(items):3d} new={len(new_ids):3d}  first_addr={addr_sample}")
                seen_ids.update(ids_now)
                if label not in region_results:
                    region_results[label] = items
            except Exception as e:
                print(f"  ERR {label} {params}: {e}")
            await asyncio.sleep(0.4)

    # 누적된 시·도 분포
    sido_counter = Counter()
    all_items = {}
    for label, items in region_results.items():
        for it in items:
            iid = it.get("id")
            if iid in all_items: continue
            all_items[iid] = it
            addr = (it.get("address") or "").strip()
            if addr:
                sido_counter[addr.split()[0]] += 1
    print(f"\n  누적 고유 업체: {len(all_items)}")
    print(f"  시·도 분포:")
    for s, n in sido_counter.most_common(15):
        print(f"    {s}: {n}")

    print(f"\n## 2. displayCount 시도 (서울)")
    for dc in [100, 200, 300, 500, 1000]:
        url = f"https://m.map.naver.com/search2/search.naver?query={quote(q)}&displayCount={dc}"
        st, html = await fetch(url)
        t, items = parse_items(html)
        print(f"  displayCount={dc}  total={t}  items={len(items)}")
        await asyncio.sleep(0.5)

    print(f"\n## 3. start (offset) 시도")
    for start in [0, 75, 150, 225]:
        url = f"https://m.map.naver.com/search2/search.naver?query={quote(q)}&start={start}&displayCount=75"
        st, html = await fetch(url)
        t, items = parse_items(html)
        first_id = items[0].get("id") if items else "-"
        first_name = items[0].get("name", "")[:20] if items else "-"
        print(f"  start={start:3d}  items={len(items):3d}  first_id={first_id} first={first_name}")
        await asyncio.sleep(0.5)

    print(f"\n## 4. clientCoord (실제 모바일 검색의 좌표 파라미터)")
    for x, y, lbl in [(127.0288, 37.5274, "압구정"), (129.0756, 35.1796, "부산"), (126.8526, 35.1595, "광주")]:
        url = f"https://m.map.naver.com/search2/search.naver?query={quote(q)}&clientX={x}&clientY={y}&displayCount=75"
        st, html = await fetch(url)
        t, items = parse_items(html)
        sido_dist = Counter((it.get("address") or "").split()[0] for it in items if it.get("address"))
        print(f"  [{lbl}] items={len(items)}  sido_dist={dict(sido_dist.most_common(5))}")
        await asyncio.sleep(0.5)

    print(f"\n## 5. '{q}'에 시도명 prefix 추가 — 가장 확실한 방법")
    for prefix in ["서울", "부산", "대구", "강원도", "제주도"]:
        url = f"https://m.map.naver.com/search2/search.naver?query={quote(prefix + ' ' + q)}&displayCount=75"
        st, html = await fetch(url)
        t, items = parse_items(html)
        sido_dist = Counter((it.get("address") or "").split()[0] for it in items if it.get("address"))
        print(f"  '{prefix} {q}'  total={t} items={len(items)}  sido={dict(sido_dist.most_common(3))}")
        await asyncio.sleep(0.5)


asyncio.run(main())
