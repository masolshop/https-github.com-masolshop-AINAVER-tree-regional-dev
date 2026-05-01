"""타지역키워드 DNA 파싱 솔루션 — API.

POST /api/v1/keyword-dna/analyze         — 단일 키워드 DNA 분석
POST /api/v1/keyword-dna/analyze/batch   — 다중 키워드 (최대 10개)
GET  /api/v1/keyword-dna/recommended     — 추천 키워드 (회선수 desc)
GET  /api/v1/keyword-dna/health
GET  /api/v1/keyword-dna/dictionary/stats
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import require_complete_profile
from app.services.keyword_dna import (
    analyze_keyword,
    list_known_keywords,
    load_dictionary,
    compare_keywords,
    build_graph,
    recommend_keywords,
)
from app.services.keyword_dna.dictionary import load_categories_list

router = APIRouter(prefix="/keyword-dna", tags=["keyword-dna"])


class AnalyzeRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=30)
    top_per_category: int = Field(default=15, ge=3, le=30)
    min_df: int = Field(default=2, ge=1, le=10)
    examples: int = Field(default=30, ge=5, le=100)


class AnalyzeBatchRequest(BaseModel):
    keywords: List[str] = Field(..., min_items=1, max_items=10)
    top_per_category: int = Field(default=10, ge=3, le=30)
    min_df: int = Field(default=2, ge=1, le=10)
    examples: int = Field(default=15, ge=5, le=50)


class CompareRequest(BaseModel):
    keywords: List[str] = Field(..., min_items=2, max_items=8)
    top_per_category: int = Field(default=12, ge=3, le=30)
    min_df: int = Field(default=2, ge=1, le=10)


class GraphRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=30)
    max_nodes: int = Field(default=40, ge=10, le=80)
    min_edge_weight: float = Field(default=1.0, ge=0.0)


class RecommendRequest(BaseModel):
    seed: str = Field(..., min_length=1, max_length=30)
    top: int = Field(default=20, ge=5, le=50)
    min_modifier_df: int = Field(default=3, ge=1, le=10)


@router.get("/health")
def health():
    d = load_dictionary()
    return {
        "status": "ok",
        "service": "keyword-dna",
        "dictionary": d.get("stats", {}),
    }


@router.get("/dictionary/stats")
def dictionary_stats(_user=Depends(require_complete_profile)):
    d = load_dictionary()
    return {
        "categories": d["categories"],
        "stats": d["stats"],
    }


@router.get("/recommended")
def recommended(
    top: int = 50,
    _user=Depends(require_complete_profile),
):
    return {
        "count": top,
        "items": list_known_keywords(top=top),
    }


@router.get("/categories")
def categories():
    """타지역업종리스트 (categories.xlsx) 카테고리·회선수 전체.

    공개 엔드포인트(인증 불필요) — '타지역 필수업종' 페이지에서 사용.
    """
    items = [{"category": c, "count": int(w)} for c, w in load_categories_list()]
    items.sort(key=lambda r: r["count"], reverse=True)
    total = sum(r["count"] for r in items)
    return {
        "count": len(items),
        "total_weight": total,
        "categories": items,
    }


@router.post("/analyze")
def analyze(
    req: AnalyzeRequest,
    _user=Depends(require_complete_profile),
):
    if not req.keyword.strip():
        raise HTTPException(status_code=422, detail="키워드가 비어 있습니다")
    try:
        return analyze_keyword(
            req.keyword.strip(),
            top_per_category=req.top_per_category,
            min_df=req.min_df,
            include_examples=req.examples,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"분석 실패: {exc}") from exc


@router.post("/analyze/batch")
def analyze_batch(
    req: AnalyzeBatchRequest,
    _user=Depends(require_complete_profile),
):
    keywords = [k.strip() for k in req.keywords if k and k.strip()]
    if not keywords:
        raise HTTPException(status_code=422, detail="키워드 리스트가 비어 있습니다")
    results = []
    for kw in keywords:
        try:
            results.append(analyze_keyword(
                kw,
                top_per_category=req.top_per_category,
                min_df=req.min_df,
                include_examples=req.examples,
            ))
        except Exception as exc:  # pragma: no cover
            results.append({"keyword": kw, "error": str(exc)})
    return {"count": len(results), "results": results}


@router.post("/compare")
def compare(
    req: CompareRequest,
    _user=Depends(require_complete_profile),
):
    """다중 키워드 비교 매트릭스 — 토큰 × 키워드 가중치 + 유사도."""
    try:
        return compare_keywords(
            req.keywords,
            top_per_category=req.top_per_category,
            min_df=req.min_df,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"비교 실패: {exc}") from exc


@router.post("/graph")
def graph(
    req: GraphRequest,
    _user=Depends(require_complete_profile),
):
    """단일 키워드 동시출현 네트워크 (nodes/edges)."""
    if not req.keyword.strip():
        raise HTTPException(status_code=422, detail="키워드가 비어 있습니다")
    try:
        return build_graph(
            req.keyword.strip(),
            max_nodes=req.max_nodes,
            min_edge_weight=req.min_edge_weight,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"그래프 빌드 실패: {exc}") from exc


@router.post("/recommend")
def recommend(
    req: RecommendRequest,
    _user=Depends(require_complete_profile),
):
    """미커버/저경쟁 키워드 조합 추천 (opportunity score desc)."""
    if not req.seed.strip():
        raise HTTPException(status_code=422, detail="seed 키워드가 비어 있습니다")
    try:
        return recommend_keywords(
            req.seed.strip(),
            top=req.top,
            min_modifier_df=req.min_modifier_df,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"추천 실패: {exc}") from exc
