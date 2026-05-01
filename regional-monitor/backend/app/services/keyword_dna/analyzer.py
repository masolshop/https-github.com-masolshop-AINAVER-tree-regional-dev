"""키워드 DNA 분석기 — 사용자 입력 키워드를 포함하는 상호만 모아
회선수 가중치로 토큰 빈도를 산출, 6 카테고리 DNA 생성.
"""
from __future__ import annotations

import re
import time
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

from .dictionary import (
    CATEGORIES,
    load_business_names,
    load_dictionary,
)
from .tokenizer import LongestMatchTokenizer

_TOKENIZER: Optional[LongestMatchTokenizer] = None


def _get_tokenizer() -> LongestMatchTokenizer:
    global _TOKENIZER
    if _TOKENIZER is None:
        d = load_dictionary()
        _TOKENIZER = LongestMatchTokenizer(d["tokens"])
    return _TOKENIZER


def _normalize(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip())


def list_known_keywords(top: int = 50) -> List[Dict]:
    """추천 키워드(메인 카테고리, 가중치 상위)."""
    d = load_dictionary()
    rows = [
        {"token": tok, "category": v["category"], "df": v["df"], "weight": v["weight"]}
        for tok, v in d["tokens"].items()
        if v["category"] == "main" and v["df"] >= 3
    ]
    rows.sort(key=lambda r: (-r["weight"], -r["df"]))
    return rows[:top]


def analyze_keyword(
    keyword: str,
    top_per_category: int = 15,
    min_df: int = 2,
    include_examples: int = 30,
) -> Dict:
    """주어진 키워드를 포함하는 상호를 모아 토큰 DNA를 생성.

    Returns:
        {
          keyword, normalized,
          stats: { matched, total, weight_matched, total_weight, elapsed_ms },
          dna: { main: [...], action: [...], material: [...], place: [...], brand: [...], tag: [...] },
          golden: [...],         # 핵심 키워드 조합 (main+action 페어)
          examples: [...]        # 매칭된 상호 샘플 (회선수 desc)
        }
    """
    t0 = time.perf_counter()
    norm = _normalize(keyword)
    if not norm:
        return {"keyword": keyword, "error": "empty keyword"}

    names = load_business_names()
    tokenizer = _get_tokenizer()

    # 1) 키워드 포함 상호 추출 (공백/쉼표 제거 후 substring 검색)
    matched: List[Tuple[str, float]] = []
    total_w = 0.0
    for name, w in names:
        total_w += w
        if norm in _normalize(name):
            matched.append((name, w))

    if not matched:
        return {
            "keyword": keyword,
            "normalized": norm,
            "stats": {
                "matched": 0,
                "total": len(names),
                "weight_matched": 0.0,
                "total_weight": total_w,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            },
            "dna": {c: [] for c in CATEGORIES},
            "golden": [],
            "examples": [],
        }

    # 2) 토큰 빈도 (가중치 적용) — 키워드 자기 자신은 제외
    tok_count: Counter = Counter()
    tok_weight: Counter = Counter()
    cooc: Dict[str, Counter] = defaultdict(Counter)  # main 토큰별 동반 토큰
    examples: List[Tuple[str, float, List[str]]] = []

    weight_matched = 0.0
    for name, w in matched:
        weight_matched += w
        toks = tokenizer.tokenize(name)
        seen = set()
        for t in toks:
            if t == norm:
                continue
            if t in seen:
                continue
            seen.add(t)
            tok_count[t] += 1
            tok_weight[t] += w
        # 동시 출현(cooc) — main과 다른 카테고리 토큰 짝
        d = load_dictionary()
        main_toks = [t for t in seen if d["tokens"].get(t, {}).get("category") == "main"]
        action_toks = [t for t in seen if d["tokens"].get(t, {}).get("category") == "action"]
        for m in main_toks:
            for a in action_toks:
                cooc[m][a] += w
        examples.append((name, w, toks))

    # 3) 카테고리별 정렬
    d = load_dictionary()
    by_cat: Dict[str, List[Dict]] = {c: [] for c in CATEGORIES}
    for tok, cnt in tok_count.items():
        if cnt < min_df:
            continue
        cat = d["tokens"].get(tok, {}).get("category", "main")
        by_cat[cat].append({
            "token": tok,
            "df": cnt,
            "weight": float(tok_weight[tok]),
            "share": (tok_weight[tok] / weight_matched) if weight_matched > 0 else 0.0,
        })

    for c in CATEGORIES:
        by_cat[c].sort(key=lambda r: (-r["weight"], -r["df"]))
        by_cat[c] = by_cat[c][:top_per_category]

    # 4) golden combos — 사용자 키워드 + 동반 action top
    # 입력 키워드 자체를 main 으로 간주
    golden: List[Dict] = []
    action_co: Counter = Counter()
    place_co: Counter = Counter()
    material_co: Counter = Counter()
    for name, w, toks in examples:
        seen_toks = set(toks)
        for t in seen_toks:
            if t == norm:
                continue
            cat = d["tokens"].get(t, {}).get("category")
            if cat == "action":
                action_co[t] += w
            elif cat == "place":
                place_co[t] += w
            elif cat == "material":
                material_co[t] += w

    for action, w in action_co.most_common(10):
        golden.append({
            "combo": f"{norm} {action}",
            "main": norm,
            "modifier": action,
            "modifier_category": "action",
            "weight": float(w),
        })
    for place, w in place_co.most_common(5):
        golden.append({
            "combo": f"{place} {norm}",
            "main": norm,
            "modifier": place,
            "modifier_category": "place",
            "weight": float(w),
        })
    for mat, w in material_co.most_common(5):
        golden.append({
            "combo": f"{mat} {norm}",
            "main": norm,
            "modifier": mat,
            "modifier_category": "material",
            "weight": float(w),
        })
    golden.sort(key=lambda r: -r["weight"])
    golden = golden[:15]

    # 5) 예시 상호 (회선수 desc)
    examples.sort(key=lambda r: -r[1])
    examples_out = [
        {"name": n, "weight": float(w), "tokens": toks}
        for n, w, toks in examples[:include_examples]
    ]

    return {
        "keyword": keyword,
        "normalized": norm,
        "stats": {
            "matched": len(matched),
            "total": len(names),
            "weight_matched": float(weight_matched),
            "total_weight": float(total_w),
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        },
        "dna": by_cat,
        "golden": golden,
        "examples": examples_out,
    }
