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
)

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
