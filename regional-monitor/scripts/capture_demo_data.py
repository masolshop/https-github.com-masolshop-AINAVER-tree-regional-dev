"""데모용 실제 네이버 데이터 캡처 스크립트.

서버에서 1회 실행하여 흥신소 + 강남 압구정동 데이터를 가져와
backend/app/demo_data/*.json 으로 저장.

실행 (서버):
    cd /opt/regionwatch/regional-monitor/backend
    ./venv/bin/python ../scripts/capture_demo_data.py

3개 솔루션:
  · 키워드DNA   — analyze_keyword("흥신소")
  · 키워드 발굴 — discover_one_region("흥신소", 서울 강남구 압구정동, mode=both)
  · 경쟁도      — scan-precise 시뮬레이션 (강남구 모든 동/리 × "흥신소")
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 경로 — 이 스크립트가 scripts/ 에 있고, backend/ 와 형제 디렉토리
ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

# demo_data 출력 폴더
OUT_DIR = BACKEND / "app" / "demo_data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

KEYWORD = "흥신소"
SIDO = "서울특별시"
SIGUNGU = "강남구"
DONG = "압구정동"

KST = timezone(timedelta(hours=9))


async def capture_keyword_dna() -> dict:
    from app.services.keyword_dna import analyze_keyword, build_graph, recommend_keywords

    print(f"[1/3] 키워드DNA 캡처 — analyze_keyword({KEYWORD!r}) ...")
    analyze = analyze_keyword(KEYWORD, top_per_category=15, min_df=2, include_examples=30)
    print(f"        matched={analyze.get('stats', {}).get('matched')} categories={list(analyze.get('dna', {}).keys())}")

    print(f"        build_graph({KEYWORD!r}) ...")
    graph = build_graph(KEYWORD, max_nodes=40, min_edge_weight=1.0)
    print(f"        nodes={len(graph.get('nodes', []))} edges={len(graph.get('edges', []))}")

    print(f"        recommend_keywords({KEYWORD!r}) ...")
    recommend = recommend_keywords(KEYWORD, top=20, min_modifier_df=3)
    print(f"        candidates={len(recommend.get('candidates', []))}")

    return {
        "captured_at": datetime.now(tz=KST).isoformat(),
        "keyword": KEYWORD,
        "analyze": analyze,
        "graph": graph,
        "recommend": recommend,
    }


async def capture_keyword_discover() -> dict:
    from app.services.keyword_classifier import classify_items, summarize
    from app.services.naver_keyword import search_keyword

    async def _one(query: str, label: str, mode: str, sigungu: str, dong: str) -> dict:
        print(f"        [{mode}] query={query!r} ...")
        raw = await search_keyword(query, display=10)
        items = classify_items(raw["items"])
        sm = summarize(items)
        exposed = sm.get("total", 0) > 0
        return {
            "scope": "region",
            "mode": mode,
            "sigungu": sigungu,
            "dong": dong,
            "keyword": KEYWORD,
            "query": query,
            "label": label,
            "source": raw["source"],
            "fetched_at": datetime.now(tz=KST).isoformat(),
            "elapsed_ms": 0,
            "summary": sm,
            "items": items,
            "exposed": exposed,
            "message": None if exposed else ("타지역 노출 없음" if mode == "dong" else None),
            "error": raw.get("error"),
            "from_cache": False,
        }

    print(f"[2/3] 키워드 발굴 캡처 — sido={SIDO} sigungu={SIGUNGU} dong={DONG}")
    sg_query = f"{SIGUNGU} {KEYWORD}"
    dong_query = f"{DONG} {KEYWORD}"

    sg_res = await _one(sg_query, sg_query, "sigungu", SIGUNGU, DONG)
    await asyncio.sleep(0.4)
    dong_res = await _one(dong_query, dong_query, "dong", SIGUNGU, DONG)

    return {
        "captured_at": datetime.now(tz=KST).isoformat(),
        "sido": SIDO,
        "sigungu": SIGUNGU,
        "dong": DONG,
        "mode": "both",
        "count": 1,
        "results": [
            {
                "keyword": KEYWORD,
                "sigungu_result": sg_res,
                "dong_result": dong_res,
            }
        ],
    }


async def capture_competition() -> dict:
    """강남구의 모든 동/리 × '흥신소' precise scan 결과를 캡처.

    실제 precise scan 로직과 동일하게 m.map.naver.com 호출 → 동별 집계.
    """
    from app.services.naver_map import search_map
    from app.services.competition_classifier import (
        GRADE_LABEL,
        aggregate_by_dong,
        enrich,
        grade_distribution,
    )
    from app.services.region_loader import list_dong, load_regions

    print(f"[3/3] 경쟁도 캡처 — {SIDO} {SIGUNGU} 모든 동 × {KEYWORD!r}")
    tree = load_regions()
    if SIGUNGU not in tree.get(SIDO, {}):
        raise RuntimeError(f"시군구 {SIGUNGU} 가 region tree 에 없음")

    dongs = list_dong(SIDO, SIGUNGU)
    print(f"        총 {len(dongs)}개 동/리 대상")

    started_at = datetime.now(tz=KST)
    all_items: list = []
    seen: set[str] = set()
    errors: list = []

    sem = asyncio.Semaphore(5)

    async def one_dong(d: str) -> None:
        token = d.split()[-1] if d else d
        query = f"{token} {KEYWORD}"
        async with sem:
            try:
                r = await search_map(query, display=75)
                if r.error:
                    errors.append({"query": query, "error": r.error})
                else:
                    for it in r.items:
                        if it.place_id and it.place_id in seen:
                            continue
                        if it.place_id:
                            seen.add(it.place_id)
                        all_items.append(it)
                print(f"        ✓ {d} ({len(r.items)} items)")
            except Exception as e:  # noqa: BLE001
                errors.append({"query": query, "error": str(e)})
                print(f"        ✗ {d} — {e}")
            await asyncio.sleep(0.4)

    await asyncio.gather(*[one_dong(d) for d in dongs])

    enrich(all_items)
    buckets = aggregate_by_dong(all_items)
    rows = list(buckets.values())
    rows.sort(key=lambda b: (-b["other"], -b["main"], b["dong"]))
    dist = grade_distribution(buckets)
    total_other = sum(b["other"] for b in rows)
    total_main = sum(b["main"] for b in rows)

    finished_at = datetime.now(tz=KST)

    return {
        "captured_at": started_at.isoformat(),
        # PreciseJobStatus 모양 그대로
        "job_id": "demo-static",
        "status": "done",
        "total": len(dongs),
        "done": len(dongs),
        "progress": 1.0,
        "created_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "error": None,
        "keyword": KEYWORD,
        "scope": "sigungu",
        "sido": SIDO,
        "sigungu": SIGUNGU,
        "raw_item_count": len(all_items),
        "errors": errors,
        "rows": rows,
        "dist": dist,
        "dist_label": {k: GRADE_LABEL[k] for k in dist.keys()},
        "totals": {
            "dong_count": len(rows),
            "other_count": total_other,
            "main_count": total_main,
            "place_count": total_other + total_main,
        },
    }


async def _maybe_serialize(obj):
    """dataclass/pydantic 모델이 섞인 경우를 위해 default 직렬화 헬퍼."""
    import dataclasses
    if dataclasses.is_dataclass(obj):
        return dataclasses.asdict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


def _json_default(obj):
    import dataclasses
    if dataclasses.is_dataclass(obj):
        return dataclasses.asdict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


async def main():
    dna = await capture_keyword_dna()
    (OUT_DIR / "keyword_dna_heungsinso.json").write_text(
        json.dumps(dna, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    print(f"  → 저장: {OUT_DIR / 'keyword_dna_heungsinso.json'}")

    discover = await capture_keyword_discover()
    (OUT_DIR / "keyword_discover_heungsinso.json").write_text(
        json.dumps(discover, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    print(f"  → 저장: {OUT_DIR / 'keyword_discover_heungsinso.json'}")

    competition = await capture_competition()
    (OUT_DIR / "competition_heungsinso.json").write_text(
        json.dumps(competition, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    print(f"  → 저장: {OUT_DIR / 'competition_heungsinso.json'}")

    print("\n✅ 데모 데이터 캡처 완료")


if __name__ == "__main__":
    asyncio.run(main())
