"""다중 키워드 비교 매트릭스 생성기.

여러 키워드를 동시 분석하여:
  - 공유 토큰 (모든 키워드에 등장)
  - 고유 토큰 (특정 키워드에만 등장)
  - 토큰 × 키워드 가중치 매트릭스 (히트맵용)
  - 키워드 간 유사도 (Jaccard / Cosine)
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, List

from .analyzer import analyze_keyword
from .dictionary import CATEGORIES, load_dictionary


def compare_keywords(
    keywords: List[str],
    top_per_category: int = 12,
    min_df: int = 2,
) -> Dict:
    """다중 키워드 매트릭스 분석."""
    keywords = [k.strip() for k in keywords if k and k.strip()]
    if len(keywords) < 2:
        return {"error": "최소 2개 키워드가 필요합니다", "keywords": keywords}

    # 1) 각 키워드 개별 분석
    per_kw: Dict[str, Dict] = {}
    for kw in keywords:
        per_kw[kw] = analyze_keyword(
            kw,
            top_per_category=top_per_category,
            min_df=min_df,
            include_examples=0,  # 예시 불필요
        )

    # 2) 토큰 풀 구축 — 모든 키워드에서 등장한 토큰
    token_kw_weight: Dict[str, Dict[str, float]] = defaultdict(dict)
    token_kw_df: Dict[str, Dict[str, int]] = defaultdict(dict)
    token_category: Dict[str, str] = {}
    d = load_dictionary()

    for kw, res in per_kw.items():
        if res.get("error"):
            continue
        for cat in CATEGORIES:
            for t in res["dna"].get(cat, []):
                token_kw_weight[t["token"]][kw] = float(t["weight"])
                token_kw_df[t["token"]][kw] = int(t["df"])
                token_category[t["token"]] = cat

    # 3) 매트릭스 행 — 가중치 합 desc, 등장 키워드 수 desc
    rows = []
    for tok, by_kw in token_kw_weight.items():
        total_w = sum(by_kw.values())
        kw_count = len(by_kw)
        rows.append({
            "token": tok,
            "category": token_category.get(tok, "main"),
            "kw_count": kw_count,
            "total_weight": total_w,
            "weights": {kw: by_kw.get(kw, 0.0) for kw in keywords},
            "dfs": {kw: token_kw_df[tok].get(kw, 0) for kw in keywords},
            "is_shared": kw_count == len(keywords),
            "is_unique": kw_count == 1,
        })
    rows.sort(key=lambda r: (-r["kw_count"], -r["total_weight"]))

    # 4) 키워드 간 Jaccard 유사도 — action/material/place 토큰 집합 기반
    sets: Dict[str, set] = {}
    for kw, res in per_kw.items():
        toks = set()
        for cat in ("action", "material", "place"):
            for t in res["dna"].get(cat, []):
                toks.add(t["token"])
        sets[kw] = toks

    similarity: List[Dict] = []
    for i, kw1 in enumerate(keywords):
        for kw2 in keywords[i+1:]:
            a, b = sets[kw1], sets[kw2]
            if not a or not b:
                jac = 0.0
            else:
                jac = len(a & b) / max(1, len(a | b))
            # cosine — 가중치 기반
            common = a & b
            dot = sum(token_kw_weight[t][kw1] * token_kw_weight[t][kw2] for t in common)
            n1 = math.sqrt(sum(w*w for w in [token_kw_weight[t][kw1] for t in a]))
            n2 = math.sqrt(sum(w*w for w in [token_kw_weight[t][kw2] for t in b]))
            cos = dot / (n1 * n2) if (n1 and n2) else 0.0
            similarity.append({
                "kw1": kw1,
                "kw2": kw2,
                "jaccard": round(jac, 4),
                "cosine": round(cos, 4),
                "shared": sorted(common),
                "shared_count": len(common),
            })

    # 5) 키워드별 KPI 요약
    summary = []
    for kw in keywords:
        s = per_kw[kw].get("stats", {})
        summary.append({
            "keyword": kw,
            "matched": s.get("matched", 0),
            "weight_matched": s.get("weight_matched", 0.0),
            "share": (s.get("weight_matched", 0.0) / s.get("total_weight", 1.0))
                     if s.get("total_weight", 0) else 0.0,
            "elapsed_ms": s.get("elapsed_ms", 0),
        })

    # 6) 공유/고유 카운트
    shared_count = sum(1 for r in rows if r["is_shared"])
    unique_count = sum(1 for r in rows if r["is_unique"])

    return {
        "keywords": keywords,
        "summary": summary,
        "matrix": rows[:200],  # cap to 200 rows
        "matrix_total": len(rows),
        "similarity": similarity,
        "shared_count": shared_count,
        "unique_count": unique_count,
    }
