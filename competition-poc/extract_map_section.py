"""
m.search.naver.com '흥신소' HTML에서 지도 섹션 데이터를 추출.

확인 항목:
1. Apollo State 안에 어떤 키들이 있는지 (Place vs PlaceMap)
2. 한 번 호출로 받는 업체 갯수
3. 주소 형태 (번지 있음/없음 분포)
4. 시·도/시군구/동 분포
"""
import asyncio
import json
import re
import httpx
from urllib.parse import quote
from collections import Counter

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"


def _extract_balanced_object(text: str, start: int) -> str | None:
    """start 위치에서 시작하는 '{' 부터 매칭되는 '}' 까지 추출."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if in_str:
            if ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


async def fetch(query: str) -> str:
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.naver.com/",
    }
    url = f"https://m.search.naver.com/search.naver?where=m&sm=mtb_jum&query={quote(query)}"
    async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
        r = await c.get(url)
        return r.text


def extract_apollo(html: str) -> dict | None:
    m = re.search(r"__APOLLO_STATE__\s*=\s*", html)
    if not m:
        return None
    obj = _extract_balanced_object(html, m.end())
    if not obj:
        return None
    try:
        return json.loads(obj)
    except Exception as e:
        print(f"  apollo parse fail: {e}")
        return None


def has_bunji(addr: str) -> bool:
    """주소에 번지(숫자-숫자 또는 숫자) 패턴이 있으면 True."""
    if not addr:
        return False
    # 동/리/면 다음에 숫자가 있는지
    return bool(re.search(r"(동|리|면|가|로|길)\s*\d+(-\d+)?", addr))


async def main():
    html = await fetch("흥신소")
    print(f"HTML size: {len(html):,}")

    apollo = extract_apollo(html)
    if not apollo:
        print("Apollo state not found")
        return

    # 모든 Place* 키 통계
    type_counter = Counter()
    place_keys = []
    for k in apollo.keys():
        # 보통 "Place:1234567" 형태
        prefix = k.split(":", 1)[0] if ":" in k else k
        type_counter[prefix] += 1
        if prefix in ("Place", "PlaceSummary", "PlaceLocal", "BusinessSummary"):
            place_keys.append(k)

    print(f"\nApollo top-level types (top 20):")
    for t, c in type_counter.most_common(20):
        print(f"  {t}: {c}")

    print(f"\nPlace-like keys: {len(place_keys)}")
    if not place_keys:
        # ROOT_QUERY 안 list 검색
        root = apollo.get("ROOT_QUERY") or {}
        print(f"ROOT_QUERY keys: {list(root.keys())[:10]}")
        return

    # 첫 5개 샘플
    print("\nSample 5 places:")
    sample = []
    for k in place_keys[:50]:
        v = apollo[k]
        if not isinstance(v, dict):
            continue
        name = v.get("name") or ""
        if isinstance(name, dict):
            name = name.get("json", "")
        addr = v.get("address") or ""
        road = v.get("roadAddress") or ""
        cat = v.get("category") or ""
        phone = v.get("phone") or v.get("virtualPhone") or ""
        sample.append({
            "key": k, "name": str(name)[:40], "addr": str(addr)[:60],
            "road": str(road)[:60], "cat": str(cat)[:30], "phone": str(phone),
        })

    for s in sample[:8]:
        bunji = "✅번지" if has_bunji(s["road"] or s["addr"]) else "❌번지없음"
        print(f"  [{bunji}] {s['name']:20} | {s['cat']:18} | {s['phone']:15} | {s['addr']}")

    # 전체 place 통계 — 번지 유/무
    yes_bunji = no_bunji = 0
    sido_counter = Counter()
    sigungu_counter = Counter()
    dong_counter = Counter()
    all_places = []

    for k in place_keys:
        v = apollo[k]
        if not isinstance(v, dict):
            continue
        addr = v.get("address") or ""
        road = v.get("roadAddress") or ""
        full = road or addr
        if not full:
            continue

        if has_bunji(full):
            yes_bunji += 1
        else:
            no_bunji += 1

        tokens = full.split()
        if len(tokens) >= 1:
            sido_counter[tokens[0]] += 1
        if len(tokens) >= 2:
            sigungu_counter[f"{tokens[0]} {tokens[1]}"] += 1
        # 동 추출 — 마지막에 동/리/면/가 단어
        dong = None
        for tok in tokens:
            if tok.endswith(("동", "리", "면", "가")) and not tok.endswith("로"):
                dong = tok
        if dong and len(tokens) >= 2:
            dong_counter[f"{tokens[0]} {tokens[1]} {dong}"] += 1

        all_places.append({
            "name": v.get("name"), "addr": full,
            "phone": v.get("phone") or v.get("virtualPhone"),
            "category": v.get("category"),
            "has_bunji": has_bunji(full),
        })

    print(f"\n=== 통계 (총 place {len(place_keys)}건 중 주소有 {len(all_places)}건) ===")
    print(f"  번지 있음 (메인후보): {yes_bunji}")
    print(f"  번지 없음 (타지역후보): {no_bunji}")
    print(f"\n  시도 분포 top10:")
    for sido, n in sido_counter.most_common(10):
        print(f"    {sido}: {n}")
    print(f"\n  시군구 분포 top15:")
    for sg, n in sigungu_counter.most_common(15):
        print(f"    {sg}: {n}")
    print(f"\n  동 분포 top20 (이게 경쟁도 분석의 핵심):")
    for d, n in dong_counter.most_common(20):
        print(f"    {d}: {n}")

    # 결과 저장
    with open("hungshin_places.json", "w", encoding="utf-8") as f:
        json.dump(all_places, f, ensure_ascii=False, indent=2)
    print(f"\n저장: hungshin_places.json ({len(all_places)} rows)")


asyncio.run(main())
