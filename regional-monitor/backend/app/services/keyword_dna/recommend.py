"""키워드 추천 자동화 — 미커버 영역 탐지.

전략:
  1) 입력 키워드(seed)를 포함하는 상호 풀 분석
  2) 풀에서 자주 등장하는 action/material/place 토큰 추출
  3) 각 후보 조합(seed+modifier)에 대해:
       - 등록 회선수(가중치) → 시장 수요
       - 등록 상호 수 → 경쟁
       - 시장기회 점수 = 회선수 / (1 + log(상호수)) — 수요 대비 경쟁이 낮은 곳
  4) 미커버 영역(=후보 조합에 해당하는 등록 상호가 거의 없는데 모분포에서 자주 보이는)을 강조
"""
from __future__ import annotations

import math
import time
from collections import Counter, defaultdict
from typing import Dict, List

from .analyzer import _get_tokenizer, _normalize
from .dictionary import CATEGORIES, load_business_names, load_dictionary


def recommend_keywords(
    seed: str,
    top: int = 20,
    min_modifier_df: int = 3,
) -> Dict:
    """미커버/저경쟁 키워드 조합 추천.

    Returns:
        {
          seed, normalized,
          candidates: [{combo, modifier, modifier_category,
                        market_weight, registered_count, opportunity, status}, ...],
          stats: {seed_matched, candidate_count, elapsed_ms}
        }
    """
    t0 = time.perf_counter()
    norm = _normalize(seed)
    if not norm:
        return {"error": "seed 키워드가 비어 있습니다"}

    names = load_business_names()
    tokenizer = _get_tokenizer()
    d = load_dictionary()

    # 1) seed 포함 상호 추출
    seed_matched = []
    for name, w in names:
        if norm in _normalize(name):
            seed_matched.append((name, w))
    if not seed_matched:
        return {
            "seed": seed,
            "normalized": norm,
            "candidates": [],
            "stats": {"seed_matched": 0, "candidate_count": 0,
                      "elapsed_ms": int((time.perf_counter() - t0) * 1000)},
        }

    # 2) 모분포 — seed 풀의 modifier 토큰(action/material/place) 추출
    mod_weight: Counter = Counter()
    mod_df: Counter = Counter()
    for name, w in seed_matched:
        toks = set(tokenizer.tokenize(name))
        for t in toks:
            if t == norm:
                continue
            cat = d["tokens"].get(t, {}).get("category")
            if cat not in ("action", "material", "place"):
                continue
            mod_weight[t] += w
            mod_df[t] += 1

    candidates: List[Dict] = []
    seen_combos = set()

    # 3) seed + modifier 조합 후보 생성
    for mod, w in mod_weight.most_common():
        if mod_df[mod] < min_modifier_df:
            continue
        cat = d["tokens"].get(mod, {}).get("category", "action")
        # 후보 조합 키 (seed가 명사형이라 보통 modifier 가 뒤 — 단, place는 앞에)
        if cat == "place":
            combo = f"{mod} {norm}"
        else:
            combo = f"{norm} {mod}"
        if combo in seen_combos:
            continue
        seen_combos.add(combo)

        # 4) 등록 상호에서 (seed AND mod) 가 동시에 들어간 건 수 → 경쟁
        comp_w = 0.0
        comp_n = 0
        for name, ww in seed_matched:
            nname = _normalize(name)
            if mod in nname:
                comp_w += ww
                comp_n += 1

        # 5) 기회 점수 — 시장 수요(mod의 모분포 가중치) ÷ (1 + log(이미 등록된 회선수+1))
        opportunity = w / (1.0 + math.log1p(comp_w))

        # 상태 라벨
        if comp_n == 0:
            status = "uncovered"          # 미커버 (블루오션)
            status_label = "미커버"
        elif comp_n <= 2:
            status = "low_competition"    # 저경쟁
            status_label = "저경쟁"
        elif comp_n <= 5:
            status = "moderate"
            status_label = "중간"
        else:
            status = "saturated"
            status_label = "포화"

        candidates.append({
            "combo": combo,
            "modifier": mod,
            "modifier_category": cat,
            "market_weight": float(w),       # mod 토큰 모분포 가중치
            "market_df": int(mod_df[mod]),   # mod 토큰 모분포 등장 상호수
            "competition_weight": float(comp_w),  # seed+mod 동시 등장 회선수
            "competition_count": int(comp_n),     # seed+mod 동시 등장 상호수
            "opportunity": round(opportunity, 2),
            "status": status,
            "status_label": status_label,
        })

    # 6) opportunity desc — 시장 수요 대비 경쟁이 낮은 키워드가 위로
    candidates.sort(key=lambda r: -r["opportunity"])
    candidates = candidates[:top]

    return {
        "seed": seed,
        "normalized": norm,
        "candidates": candidates,
        "stats": {
            "seed_matched": len(seed_matched),
            "candidate_count": len(candidates),
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        },
    }
