"""토큰 동시출현 네트워크 그래프 생성기.

키워드를 포함하는 상호의 토큰을 노드로,
같은 상호에 함께 등장한 토큰 쌍을 엣지로 변환.
프론트엔드 SVG force-directed 레이아웃에서 사용.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Dict, List, Optional

from .analyzer import _get_tokenizer, _normalize
from .dictionary import load_business_names, load_dictionary


def build_graph(
    keyword: str,
    max_nodes: int = 40,
    min_edge_weight: float = 1.0,
) -> Dict:
    """단일 키워드 기준 동시출현 네트워크.

    Returns:
        {
          keyword, normalized,
          nodes: [{id, category, weight, df}, ...],
          edges: [{source, target, weight, df}, ...],
          stats: {matched, node_count, edge_count, elapsed_ms}
        }
    """
    import time
    t0 = time.perf_counter()

    norm = _normalize(keyword)
    if not norm:
        return {"error": "키워드가 비어 있습니다"}

    names = load_business_names()
    tokenizer = _get_tokenizer()
    d = load_dictionary()

    # 1) 키워드 포함 상호만 추출
    matched: List[tuple] = []
    for name, w in names:
        if norm in _normalize(name):
            matched.append((name, w))

    if not matched:
        return {
            "keyword": keyword,
            "normalized": norm,
            "nodes": [],
            "edges": [],
            "stats": {
                "matched": 0,
                "node_count": 0,
                "edge_count": 0,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            },
        }

    # 2) 노드 가중치 (회선수 기반)
    node_weight: Counter = Counter()
    node_df: Counter = Counter()
    edge_weight: Dict[tuple, float] = defaultdict(float)
    edge_df: Counter = Counter()

    for name, w in matched:
        toks = tokenizer.tokenize(name)
        # 중심 키워드 추가 (사전에 없을 수 있음)
        seen = set(toks)
        seen.add(norm)
        seen = list(seen)
        for t in seen:
            node_weight[t] += w
            node_df[t] += 1
        # 페어 동시출현
        for i, t1 in enumerate(seen):
            for t2 in seen[i+1:]:
                key = (t1, t2) if t1 < t2 else (t2, t1)
                edge_weight[key] += w
                edge_df[key] += 1

    # 3) 노드 상위 max_nodes 추출 (중심 키워드 강제 포함)
    top_tokens = [t for t, _ in node_weight.most_common(max_nodes)]
    if norm not in top_tokens:
        top_tokens.append(norm)
    top_set = set(top_tokens)

    # 4) 노드 리스트 — 카테고리 라벨 부여
    nodes: List[Dict] = []
    max_w = max(node_weight[t] for t in top_set) if top_set else 1.0
    for t in top_tokens:
        cat = "main" if t == norm else d["tokens"].get(t, {}).get("category", "main")
        nodes.append({
            "id": t,
            "category": cat,
            "weight": float(node_weight[t]),
            "df": int(node_df[t]),
            "size": max(8.0, math.sqrt(node_weight[t] / max_w) * 28.0),
            "is_center": t == norm,
        })

    # 5) 엣지 — top_set 안의 페어만, min_edge_weight 이상
    edges: List[Dict] = []
    for (t1, t2), w in edge_weight.items():
        if t1 not in top_set or t2 not in top_set:
            continue
        if w < min_edge_weight:
            continue
        edges.append({
            "source": t1,
            "target": t2,
            "weight": float(w),
            "df": int(edge_df[(t1, t2)]),
        })
    # 엣지 가중치 desc, top 200
    edges.sort(key=lambda e: -e["weight"])
    edges = edges[:200]

    return {
        "keyword": keyword,
        "normalized": norm,
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "matched": len(matched),
            "node_count": len(nodes),
            "edge_count": len(edges),
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        },
    }
