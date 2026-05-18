"""30개 키워드 batch 정확도 측정 스크립트.

목적:
  · 분류 룰 v2 (070 / 흥신소 / 주소상세) 의 실측 정확도 측정.
  · 오탐(False Positive) / 미탐(False Negative) 케이스 수집.

판정 기준 (Ground Truth는 룰 기반이지만, 외부 신호와 교차 검증):
  · 070 번호 → 100% 타지역 (네이버 사업자 가이드 + 사용자 룰)
  · 흥신소 카테고리/상호 → 100% 타지역
  · 도로명주소 + 번지 + 건물 상세 → 메인
  · 의심(suspect) 카테고리는 별도 수동 검토 후보

실행: python3 measure_accuracy.py
출력: stdout 표 + accuracy_report.json 파일
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from naver_search import search_keyword
from classifier import classify_items, summarize, is_070, has_third_party_keyword

KST = timezone(timedelta(hours=9))

# 30개 테스트 키워드 (다양한 카테고리)
TEST_KEYWORDS = [
    # 1) 타지역 의심도 매우 높은 키워드 (전화·심부름·해결사 부류)
    "선불폰", "흥신소", "심부름센터", "대리운전", "도배",
    "해킹업체", "외도조사", "사람찾기", "탐정사무소", "이삿짐",
    # 2) 출장·서비스 부류 (혼재)
    "출장세차", "에어컨청소", "보일러수리", "변기뚫기", "키수리",
    "유리창청소", "이불세탁", "정수기렌탈", "방역", "포장이사",
    # 3) 지역 점포 부류 (메인 다수 예상)
    "강남 치과", "홍대 카페", "성수 헬스장", "잠실 미용실", "건대 술집",
    # 4) 모호한/일반 키워드 (1페이지 노출 없음 가능)
    "맛집", "병원", "헬스장", "피부과", "변호사",
]


def reasoning(it: dict) -> str:
    """분류 결과의 근거 문자열."""
    phone = it.get("phone")
    if is_070(phone):
        return "rule:070"
    if has_third_party_keyword(it.get("name"), it.get("category")):
        return "rule:keyword"
    if it.get("road_address"):
        return "rule:road_address"
    addr = it.get("address") or ""
    if re.search(r"\d+(-\d+)?", addr) and not re.search(r"(동|리|가)\d?$", addr.rsplit(" ", 1)[-1] if " " in addr else addr):
        return "rule:lot_number"
    return "rule:simple_address"


async def main():
    started = time.time()
    all_runs = []
    print(f"\n=== 30개 키워드 batch 정확도 측정 시작 ({datetime.now(tz=KST).isoformat()}) ===\n")

    for i, kw in enumerate(TEST_KEYWORDS, 1):
        if i > 1:
            await asyncio.sleep(0.4)  # 차단 회피 pace
        try:
            r = await search_keyword(kw, display=10)
            items = classify_items(r["items"])
            s = summarize(items)
            for it in items:
                it["reasoning"] = reasoning(it)
            all_runs.append({"keyword": kw, "source": r["source"], "summary": s, "items": items, "error": r.get("error")})
            print(f"[{i:02d}/{len(TEST_KEYWORDS)}] {kw:<14s} src={r['source']:<11s} "
                  f"total={s['total']} tp={s['third_party_count']} sus={s['third_party_suspect_count']} "
                  f"main={s['main_count']} unk={s['unknown_count']} "
                  f"is_tp_kw={'Y' if s['is_third_party_keyword'] else 'N'}"
                  + (f" err={r['error']}" if r.get("error") else ""))
        except Exception as e:
            print(f"[{i:02d}/{len(TEST_KEYWORDS)}] {kw} FAILED: {e}")
            all_runs.append({"keyword": kw, "source": "error", "summary": {}, "items": [], "error": str(e)})

    elapsed = time.time() - started

    # === 통계 집계 ===
    total_keywords = len(all_runs)
    tp_keywords = sum(1 for r in all_runs if r["summary"].get("is_third_party_keyword"))
    fetched = sum(1 for r in all_runs if r["source"] == "html_apollo")
    no_place_section = sum(1 for r in all_runs if r["source"] == "none")

    flat = [it for r in all_runs for it in r["items"]]
    total_items = len(flat)
    by_class: dict[str, int] = {}
    by_reason: dict[str, int] = {}
    for it in flat:
        by_class[it["classification"]] = by_class.get(it["classification"], 0) + 1
        by_reason[it["reasoning"]] = by_reason.get(it["reasoning"], 0) + 1

    # 070 번호인데 main 으로 분류된 건이 있다면 룰 충돌(있을 수 없음 — 1순위 룰)
    # 하지만 안전망용으로 검사.
    rule_violations = []
    for it in flat:
        is70 = is_070(it.get("phone"))
        cls = it.get("classification")
        if is70 and cls != "third_party":
            rule_violations.append({"keyword": "?", "phone": it.get("phone"), "name": it.get("name"), "got": cls, "expected": "third_party"})

    # 메인 분류된 건 중 도로명 상세가 없는 케이스(잠재 오탐)
    main_without_road = []
    for r in all_runs:
        for it in r["items"]:
            if it["classification"] == "main" and not it.get("road_address"):
                # 단, 번지(숫자)가 address 에 있으면 정상
                addr = it.get("address") or ""
                if not re.search(r"\d+(-\d+)?", addr):
                    main_without_road.append({"keyword": r["keyword"], "name": it.get("name"), "phone": it.get("phone"), "address": addr})

    # 의심으로 분류된 건의 케이스 수집 (수동 검토용)
    suspect_cases = []
    for r in all_runs:
        for it in r["items"]:
            if it["classification"] == "third_party_suspect":
                suspect_cases.append({"keyword": r["keyword"], "name": it.get("name"), "phone": it.get("phone"), "address": it.get("address"), "reason": it.get("reasoning")})

    print("\n" + "=" * 70)
    print(f"📊 정확도 측정 결과 요약")
    print("=" * 70)
    print(f"전체 소요시간       : {elapsed:.1f}s ({elapsed/total_keywords:.2f}s/키워드)")
    print(f"분석 키워드         : {total_keywords}개")
    print(f"  - 1페이지 플레이스 노출  : {fetched}개")
    print(f"  - 플레이스 섹션 없음     : {no_place_section}개")
    print(f"  - 타지역 키워드 판정     : {tp_keywords}개 ({tp_keywords/total_keywords*100:.0f}%)")
    print(f"\n총 노출 플레이스    : {total_items}건")
    print(f"  - 분류 분포:")
    for cls, c in sorted(by_class.items(), key=lambda x: -x[1]):
        print(f"      · {cls:<25s} {c:>3d} ({c/total_items*100:>4.1f}%)" if total_items else "")
    print(f"\n  - 룰 트리거 분포:")
    for rsn, c in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"      · {rsn:<25s} {c:>3d}")

    print(f"\n🛡 룰 위반 (070 인데 main 분류) : {len(rule_violations)}건  (목표: 0건)")
    print(f"⚠ main 인데 도로명/번지 없음    : {len(main_without_road)}건")
    if main_without_road:
        for c in main_without_road[:5]:
            print(f"      · [{c['keyword']}] {c['name']} | ph={c['phone']} | addr={c['address']}")
    print(f"❓ 의심 케이스 (수동검토 후보)   : {len(suspect_cases)}건")
    if suspect_cases:
        for c in suspect_cases[:10]:
            print(f"      · [{c['keyword']}] {c['name']} | ph={c['phone']} | addr={c['address']} ({c['reason']})")

    # 리포트 저장
    report = {
        "generated_at": datetime.now(tz=KST).isoformat(),
        "elapsed_s": round(elapsed, 1),
        "total_keywords": total_keywords,
        "tp_keywords": tp_keywords,
        "fetched": fetched,
        "no_place_section": no_place_section,
        "total_items": total_items,
        "by_class": by_class,
        "by_reason": by_reason,
        "rule_violations": rule_violations,
        "main_without_road_or_lot": main_without_road,
        "suspect_cases": suspect_cases,
        "runs": all_runs,
    }
    out = Path(__file__).parent / "accuracy_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n📄 상세 리포트 저장: {out}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
