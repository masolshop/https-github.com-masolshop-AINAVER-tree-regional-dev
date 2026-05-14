"""데모 전용 정적 데이터 엔드포인트.

외부 공개 데모(is_demo=True) 게스트가 다음 3개 솔루션을 체험할 수 있도록,
미리 캡처된 실제 네이버 응답 JSON(흥신소 + 서울 강남구/압구정동)을 그대로
반환한다.

  · GET /api/v1/demo/keyword-dna           — 키워드DNA (analyze + graph + recommend)
  · GET /api/v1/demo/keyword-discover      — 키워드 발굴 (강남구/압구정동 × 흥신소)
  · GET /api/v1/demo/competition           — 지역별 경쟁도 (강남구 전체 동 × 흥신소)
  · GET /api/v1/demo/info                  — 데모 키워드/지역 메타정보 (인증 불필요)

특징:
  · 인증 필요 (require_complete_profile) — 데모 JWT 로 호출 가능.
  · GET 이므로 block_demo_mutations 미들웨어가 통과시킴 (차단 prefix 에도 미포함).
  · 응답은 실제 API 의 응답 스키마와 100% 동일하므로,
    프론트는 isDemo 일 때 동일 컴포넌트로 그대로 렌더링 가능.
  · JSON 은 app/demo_data/*.json — 서버 부팅 시 1회 로드 후 메모리에 캐시.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_complete_profile

router = APIRouter(prefix="/demo", tags=["demo"])

# backend/app/demo_data/*.json
_DATA_DIR = Path(__file__).resolve().parent.parent / "demo_data"


@lru_cache(maxsize=8)
def _load(name: str) -> dict:
    p = _DATA_DIR / name
    if not p.exists():
        raise HTTPException(
            status_code=503,
            detail=f"데모 데이터 파일이 없습니다: {name}. 서버 관리자에게 문의하세요.",
        )
    try:
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=503,
            detail=f"데모 데이터 로드 실패: {exc}",
        ) from exc


# ── 메타정보 (인증 불필요) ─────────────────────────────────
@router.get("/info")
def demo_info():
    """데모에 사용되는 키워드/지역 메타. 프론트가 입력창 prefill 에 사용."""
    return {
        "keyword": "흥신소",
        "sido": "서울특별시",
        "sigungu": "강남구",
        "dong": "압구정동",
        "endpoints": {
            "keyword_dna": "/api/v1/demo/keyword-dna",
            "keyword_discover": "/api/v1/demo/keyword-discover",
            "competition": "/api/v1/demo/competition",
        },
        "note": (
            "외부 공개 데모는 미리 캡처된 실제 네이버 응답을 보여줍니다. "
            "실시간 분석을 원하시면 회원가입 후 이용해 주세요."
        ),
    }


# ── 키워드 DNA ─────────────────────────────────────────────
@router.get("/keyword-dna")
def demo_keyword_dna(_user=Depends(require_complete_profile)):
    """캡처된 흥신소 DNA 분석/그래프/추천 통합 응답."""
    data = _load("keyword_dna_heungsinso.json")
    return {
        "captured_at": data.get("captured_at"),
        "keyword": data.get("keyword", "흥신소"),
        "analyze": data.get("analyze", {}),
        "graph": data.get("graph", {}),
        "recommend": data.get("recommend", {}),
    }


# ── 키워드 발굴 ────────────────────────────────────────────
@router.get("/keyword-discover")
def demo_keyword_discover(_user=Depends(require_complete_profile)):
    """캡처된 강남구/압구정동 × 흥신소 (mode=both) 결과.

    실제 POST /keyword/discover-by-region 응답 스키마와 동일.
    """
    data = _load("keyword_discover_heungsinso.json")
    # captured_at 은 프론트에서 안내 표시용으로 별도 노출.
    out = {k: v for k, v in data.items() if k != "captured_at"}
    out["captured_at"] = data.get("captured_at")
    return out


# ── 경쟁도 ────────────────────────────────────────────────
@router.get("/competition")
def demo_competition(_user=Depends(require_complete_profile)):
    """캡처된 강남구 전체 동 × 흥신소 정밀 스캔 결과.

    실제 GET /competition/jobs/{job_id}?include_results=true 응답 스키마와 동일
    (status=done, job_id='demo-static').
    """
    data = _load("competition_heungsinso.json")
    out = {k: v for k, v in data.items() if k != "captured_at"}
    out["captured_at"] = data.get("captured_at")
    return out
