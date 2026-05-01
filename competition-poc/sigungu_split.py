"""
시·군·구 prefix 분할 방식 검증:
1. 강남구 흥신소 → 압구정동 27건 케이스 재현
2. 시·도 17개 + 시군구 229개 분할 비교
3. 동별 타지역 갯수 집계 + 4단계 등급
"""
import asyncio
import httpx
import re
import json
import time
from urllib.parse import quote
from collections import Counter

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"


def _balanced(text, start):
    if start >= len(text) or text[start] != "{": return None
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
    items, total = [], 0
    for m in re.finditer(r"window\.__RQ_STREAMING_STATE__\.push\(", html):
        s = m.end()
        if s >= len(html) or html[s] != "{": continue
        ob = _balanced(html, s)
        if not ob: continue
        try: obj = json.loads(ob)
        except: continue
        for q in obj.get("queries", []) or []:
            data = (q.get("state") or {}).get("data") or {}
            tc = data.get("totalCount", 0)
            if isinstance(tc, int) and tc > total: total = tc
            for it in data.get("items") or []: items.append(it)
    return total, items


async def fetch(client, url):
    headers = {"User-Agent": UA, "Referer": "https://m.naver.com/"}
    r = await client.get(url, headers=headers, follow_redirects=True)
    return r.status_code, r.text


def is_other_region(item):
    """타지역 = 번지 없음."""
    road = (item.get("roadAddress") or "").strip()
    addr = (item.get("address") or "").strip()
    if re.search(r"(로|길)\s*\d", road): return False
    if re.search(r"(동|가|리|면)\s*\d", addr): return False
    return True


def parse_dong(item):
    addr = (item.get("address") or item.get("roadAddress") or "").strip()
    tokens = addr.split()
    if not tokens: return ("", "", "")
    sido = tokens[0]
    sigungu = tokens[1] if len(tokens) > 1 else ""
    if len(tokens) > 2 and tokens[2].endswith(("면", "읍")):
        sigungu = f"{tokens[1]} {tokens[2]}"
    dong = ""
    for tok in tokens[1:]:
        if tok.endswith(("동", "리", "가")):
            dong = tok; break
    return (sido, sigungu, dong)


def grade(n):
    if n == 0: return "⚪없음"
    if n <= 5: return "🟢청정"
    if n <= 10: return "🟡경쟁"
    if n <= 15: return "🟠과열"
    return "🔴포화"


async def main():
    # 1단계: 강남구 흥신소 단독 검증
    keyword = "흥신소"
    test_q = f"서울 강남구 {keyword}"
    print(f"### [검증 1] '{test_q}' — 압구정동 27개 케이스 재현 시도\n")

    async with httpx.AsyncClient(timeout=20.0) as client:
        url = f"https://m.map.naver.com/search2/search.naver?query={quote(test_q)}&displayCount=75"
        st, html = await fetch(client, url)
        total, items = parse_items(html)
        print(f"  status={st}  totalCount={total:,}  items={len(items)}")

        # 강남구만 필터
        gn_items = [it for it in items if "강남구" in (it.get("address") or "")]
        print(f"  강남구 items: {len(gn_items)}")

        # 동별 집계
        dong_other = Counter()
        dong_main = Counter()
        sample_per_dong = {}
        for it in gn_items:
            _, _, dong = parse_dong(it)
            if not dong: continue
            if is_other_region(it):
                dong_other[dong] += 1
                sample_per_dong.setdefault(dong, []).append(it)
            else:
                dong_main[dong] += 1

        print(f"\n  강남구 동별 타지역 갯수:")
        for d, n in dong_other.most_common():
            m = dong_main.get(d, 0)
            print(f"    {grade(n)}  {d:8s}  타지역 {n:2d} / 메인 {m}")

        # 압구정 케이스
        if "압구정동" in dong_other:
            print(f"\n  ✅ 압구정동: 타지역 {dong_other['압구정동']}건")
            for it in sample_per_dong["압구정동"][:8]:
                print(f"    - {it.get('name', '')[:30]:30s} | {it.get('tel', ''):17s} | {it.get('address')}")

        # 2단계: 좀 더 정밀하게 - 압구정동 직접 검색
        await asyncio.sleep(1)
        print(f"\n### [검증 2] '압구정동 {keyword}' 직접 검색")
        url2 = f"https://m.map.naver.com/search2/search.naver?query={quote('압구정동 ' + keyword)}&displayCount=75"
        st2, html2 = await fetch(client, url2)
        total2, items2 = parse_items(html2)
        ag_items = [it for it in items2 if "압구정" in (it.get("address") or "")]
        ag_other = sum(1 for it in ag_items if is_other_region(it))
        print(f"  totalCount={total2}  items={len(items2)}  압구정 매칭={len(ag_items)}  타지역={ag_other}")
        for it in ag_items[:10]:
            tag = "❌타지역" if is_other_region(it) else "✅메인"
            print(f"    {tag} {it.get('name', '')[:30]:30s} | {it.get('address')}")

        # 3단계: 시·도 17개 분할 시간 측정
        await asyncio.sleep(1)
        print(f"\n### [검증 3] 시·도 17개 분할 (전국 커버리지 확인)")
        SIDOS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
                 "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
        all_items = {}
        t0 = time.time()
        sem = asyncio.Semaphore(5)
        async def one_sido(sido):
            async with sem:
                u = f"https://m.map.naver.com/search2/search.naver?query={quote(sido + ' ' + keyword)}&displayCount=75"
                s, h = await fetch(client, u)
                t, its = parse_items(h)
                await asyncio.sleep(0.5)
                return sido, t, its
        results = await asyncio.gather(*[one_sido(s) for s in SIDOS])
        for sido, t, its in results:
            new = sum(1 for it in its if it.get("id") not in all_items)
            for it in its:
                all_items[it.get("id")] = it
            print(f"  {sido:5s}  totalCount={t:6d}  받은={len(its):3d}  new={new}")
        elapsed = time.time() - t0
        print(f"\n  소요: {elapsed:.1f}초  /  고유 업체: {len(all_items):,}")

        # 4단계: 동별 집계 (전국)
        print(f"\n### [검증 4] 시·도 17개 분할로 받은 데이터의 동별 집계 top 30")
        dong_other_all = Counter()
        dong_total = Counter()
        for it in all_items.values():
            _, _, dong = parse_dong(it)
            if not dong: continue
            sido, sigungu, _ = parse_dong(it)
            key = f"{sido} {sigungu} {dong}"
            dong_total[key] += 1
            if is_other_region(it):
                dong_other_all[key] += 1

        for k, n in dong_other_all.most_common(30):
            print(f"  {grade(n)}  {k:35s}  타지역 {n:3d} / 전체 {dong_total[k]}")


asyncio.run(main())
