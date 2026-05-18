"""
m.map.naver.com 정식 파싱 + 페이징 + 동별 경쟁도 집계.
"""
import asyncio
import httpx
import re
import json
from urllib.parse import quote
from collections import Counter

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"


def _extract_balanced_object(text: str, start: int) -> str | None:
    if start >= len(text) or text[start] not in "{[":
        return None
    open_ch = text[start]
    close_ch = "}" if open_ch == "{" else "]"
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
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_rq_streaming(html: str) -> list[dict]:
    """모든 window.__RQ_STREAMING_STATE__.push({...}) 호출에서 items 추출."""
    items = []
    total = 0
    for m in re.finditer(r"window\.__RQ_STREAMING_STATE__\.push\(", html):
        start = m.end()
        if start >= len(html) or html[start] != "{":
            continue
        obj_str = _extract_balanced_object(html, start)
        if not obj_str:
            continue
        try:
            obj = json.loads(obj_str)
        except Exception:
            continue
        for q in obj.get("queries", []) or []:
            data = (q.get("state") or {}).get("data") or {}
            tc = data.get("totalCount")
            if isinstance(tc, int) and tc > total:
                total = tc
            for it in data.get("items") or []:
                items.append(it)
    return total, items


async def fetch(query: str, page: int = 1, display: int = 100) -> str:
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.naver.com/",
    }
    url = (
        f"https://m.map.naver.com/search2/search.naver?"
        f"query={quote(query)}&page={page}&displayCount={display}"
    )
    async with httpx.AsyncClient(timeout=20.0, headers=headers, follow_redirects=True) as c:
        r = await c.get(url)
        return r.status_code, r.text


def is_other_region(item: dict) -> bool:
    """타지역 판정: roadAddress 비어있고 address가 동/리/면/가까지만."""
    road = (item.get("roadAddress") or "").strip()
    addr = (item.get("address") or "").strip()
    full = road or addr
    if not full:
        return True
    # 도로명에 길/로 + 숫자 = 메인
    if re.search(r"(로|길)\s*\d", road):
        return False
    # 지번에 동/가/리 + 숫자 = 메인
    if re.search(r"(동|가|리|면)\s*\d", addr):
        return False
    return True


def parse_dong(item: dict) -> tuple[str, str, str]:
    """주소에서 (시도, 시군구, 동/리)."""
    addr = (item.get("address") or item.get("roadAddress") or "").strip()
    tokens = addr.split()
    if not tokens:
        return ("", "", "")
    sido = tokens[0]
    sigungu = tokens[1] if len(tokens) > 1 else ""
    # 두 토큰 시군구 ('강릉시 강동면')
    if len(tokens) > 2 and tokens[2].endswith(("면", "읍")):
        sigungu = f"{tokens[1]} {tokens[2]}"
    dong = ""
    for tok in tokens[1:]:
        if tok.endswith(("동", "리", "가")):
            dong = tok
            break
    return (sido, sigungu, dong)


async def main():
    q = "흥신소"
    print(f"\n=== '{q}' 페이징 테스트 ===")
    all_items = []
    total = 0
    for page in range(1, 8):  # 7페이지까지
        status, html = await fetch(q, page=page, display=100)
        t, items = parse_rq_streaming(html)
        print(f"  page={page} status={status} html={len(html):,} totalCount={t} items={len(items)}")
        if t and not total:
            total = t
        if not items:
            break
        all_items.extend(items)
        if len(items) < 50:  # 마지막 페이지
            break
        await asyncio.sleep(0.5)

    # 중복 제거 (id 기준)
    seen = set()
    uniq = []
    for it in all_items:
        iid = it.get("id")
        if iid in seen:
            continue
        seen.add(iid)
        uniq.append(it)

    print(f"\n=== 통계 ===")
    print(f"  totalCount(네이버): {total:,}")
    print(f"  수집(중복 제거): {len(uniq):,}")

    # 타지역 판정
    others = [it for it in uniq if is_other_region(it)]
    main = [it for it in uniq if not is_other_region(it)]
    print(f"  타지역: {len(others):,}  / 메인: {len(main):,}")

    # 동별 집계
    dong_counter = Counter()
    dong_other_counter = Counter()
    sample_per_dong: dict[str, list] = {}
    for it in uniq:
        sido, sigungu, dong = parse_dong(it)
        if not dong:
            continue
        key = f"{sido} {sigungu} {dong}".strip()
        dong_counter[key] += 1
        if is_other_region(it):
            dong_other_counter[key] += 1
            sample_per_dong.setdefault(key, []).append(it)

    print(f"\n=== 동별 타지역 갯수 top 30 ===")
    for d, n in dong_other_counter.most_common(30):
        total_n = dong_counter[d]
        # 4단계 등급
        if n >= 16:
            grade = "🔴포화"
        elif n >= 11:
            grade = "🟠과열"
        elif n >= 6:
            grade = "🟡경쟁"
        elif n >= 1:
            grade = "🟢청정"
        else:
            grade = "⚪없음"
        print(f"  {grade}  {d:35s}  타지역 {n:3d}/{total_n:3d}")

    # 압구정동 케이스 확인
    apgu_keys = [k for k in dong_other_counter if "압구정" in k]
    if apgu_keys:
        print(f"\n=== 압구정동 검증 ===")
        for k in apgu_keys:
            print(f"  {k}: 타지역 {dong_other_counter[k]} / 전체 {dong_counter[k]}")
            for it in sample_per_dong.get(k, [])[:5]:
                print(f"    - {it.get('name'):25s} | {it.get('tel'):17s} | {it.get('address')}")


asyncio.run(main())
