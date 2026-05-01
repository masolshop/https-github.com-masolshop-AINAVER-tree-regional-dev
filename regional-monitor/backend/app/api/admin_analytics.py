"""슈퍼어드민 — 방문자 분석 (GA4 Data API 연동) 라우터.

엔드포인트(모두 require_superadmin 가드):
  GET /admin/analytics/health     — GA4 설정 상태
  GET /admin/analytics/summary    — 기간별 KPI 합계
  GET /admin/analytics/timeseries — 일자별 시계열
  GET /admin/analytics/pages      — 상위 페이지
  GET /admin/analytics/countries  — 국가별
  GET /admin/analytics/devices    — 디바이스별
  GET /admin/analytics/sources    — 유입 채널/소스
  GET /admin/analytics/realtime   — 실시간(지난 30분)

`range` 쿼리 파라미터로 GA4 형식 날짜를 지정. 기본 7일.
허용: today, yesterday, 7daysAgo, 14daysAgo, 28daysAgo, 90daysAgo
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.services import ga4_analytics
from .deps import require_superadmin

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin-analytics"],
    dependencies=[Depends(require_superadmin)],
)

# 허용 가능한 GA4 상대 날짜 표현
_ALLOWED_RANGES = {
    "today", "yesterday",
    "7daysAgo", "14daysAgo", "28daysAgo", "30daysAgo", "60daysAgo", "90daysAgo",
}


def _parse_range(range_: str) -> tuple[str, str]:
    """range 파라미터를 (start_date, end_date) 튜플로 변환."""
    range_ = (range_ or "7daysAgo").strip()
    if range_ not in _ALLOWED_RANGES:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 range 입니다: {range_}")
    return range_, "today"


def _safe_call(fn, *args, **kwargs) -> Any:
    """GA4 호출을 try/except 로 감싸 503 에 매핑한다."""
    try:
        return fn(*args, **kwargs)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GA4 호출 실패: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"GA4 Data API 호출 실패: {type(e).__name__}",
        )


# ──────────────────────────────────────────────────────────────


@router.get("/health")
def health() -> dict:
    """GA4 자격 증명·Property ID 설정 여부."""
    from app.core.config import settings
    return {
        "configured": ga4_analytics.is_ga4_configured(),
        "property_id": settings.GA4_PROPERTY_ID or None,
        "credentials_source": (
            "json_env" if settings.GA4_CREDENTIALS_JSON
            else ("file" if settings.GA4_CREDENTIALS_FILE else None)
        ),
    }


@router.get("/summary")
def summary(range: str = Query("7daysAgo")) -> dict:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_summary, start, end)


@router.get("/timeseries")
def timeseries(range: str = Query("28daysAgo")) -> list:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_timeseries, start, end)


@router.get("/pages")
def pages(range: str = Query("7daysAgo"), limit: int = Query(20, ge=1, le=100)) -> list:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_top_pages, start, end, limit)


@router.get("/countries")
def countries(range: str = Query("7daysAgo"), limit: int = Query(15, ge=1, le=100)) -> list:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_top_countries, start, end, limit)


@router.get("/devices")
def devices(range: str = Query("7daysAgo")) -> list:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_devices, start, end)


@router.get("/sources")
def sources(range: str = Query("7daysAgo"), limit: int = Query(15, ge=1, le=100)) -> list:
    start, end = _parse_range(range)
    return _safe_call(ga4_analytics.get_traffic_sources, start, end, limit)


@router.get("/realtime")
def realtime() -> dict:
    return _safe_call(ga4_analytics.get_realtime)
