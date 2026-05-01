"""Google Analytics 4 Data API 연동 서비스.

운영 환경에서 GA4 측정 데이터를 가져와 슈퍼어드민 대시보드에 노출한다.

환경변수:
  GA4_PROPERTY_ID         — GA4 속성 ID(숫자, 예: "486271234")
  GA4_CREDENTIALS_FILE    — 서비스 계정 JSON 키 파일 경로
  GA4_CREDENTIALS_JSON    — 또는 JSON 문자열 그 자체

서비스 계정에 GA4 속성 "뷰어" 권한이 부여되어 있어야 한다.

GA4 측정 ID(VITE_GA_MEASUREMENT_ID)는 프론트엔드 gtag.js 스크립트 주입용이고,
이 모듈에서는 GA4 Property ID(서버측 식별자)와 서비스 계정 인증을 사용한다.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_ga4_configured() -> bool:
    """GA4 Data API 호출이 가능한 환경인지 확인."""
    return bool(
        settings.GA4_PROPERTY_ID
        and (settings.GA4_CREDENTIALS_FILE or settings.GA4_CREDENTIALS_JSON)
    )


def _get_client():
    """BetaAnalyticsDataClient 인스턴스 반환. 미설정/미설치 시 None."""
    if not is_ga4_configured():
        return None
    try:
        from google.oauth2 import service_account
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
    except ImportError:
        logger.warning("google-analytics-data 패키지가 설치되지 않았습니다.")
        return None

    try:
        if settings.GA4_CREDENTIALS_JSON:
            info = json.loads(settings.GA4_CREDENTIALS_JSON)
            credentials = service_account.Credentials.from_service_account_info(info)
        else:
            path = settings.GA4_CREDENTIALS_FILE
            if not os.path.isfile(path):
                logger.warning("GA4 자격 증명 파일을 찾을 수 없습니다: %s", path)
                return None
            credentials = service_account.Credentials.from_service_account_file(path)
        return BetaAnalyticsDataClient(credentials=credentials)
    except Exception as e:
        logger.exception("GA4 클라이언트 초기화 실패: %s", e)
        return None


def _property_path() -> str:
    return f"properties/{settings.GA4_PROPERTY_ID}"


# ──────────────────────────────────────────────────────────────
# 보고서 함수들
# ──────────────────────────────────────────────────────────────


def get_summary(start_date: str = "7daysAgo", end_date: str = "today") -> dict[str, Any]:
    """기간별 핵심 KPI(활성 사용자/세션/조회/이탈률/평균 세션 시간) 합계."""
    client = _get_client()
    if client is None:
        return {"configured": False, "rows": []}

    from google.analytics.data_v1beta.types import (
        DateRange,
        Metric,
        RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        metrics=[
            Metric(name="activeUsers"),
            Metric(name="newUsers"),
            Metric(name="sessions"),
            Metric(name="screenPageViews"),
            Metric(name="bounceRate"),
            Metric(name="averageSessionDuration"),
        ],
    )
    resp = client.run_report(req)
    if not resp.rows:
        return {
            "configured": True,
            "active_users": 0, "new_users": 0, "sessions": 0,
            "page_views": 0, "bounce_rate": 0.0, "avg_session_seconds": 0.0,
        }
    r = resp.rows[0]
    vals = [v.value for v in r.metric_values]
    return {
        "configured": True,
        "active_users": int(float(vals[0] or 0)),
        "new_users": int(float(vals[1] or 0)),
        "sessions": int(float(vals[2] or 0)),
        "page_views": int(float(vals[3] or 0)),
        "bounce_rate": float(vals[4] or 0.0),
        "avg_session_seconds": float(vals[5] or 0.0),
    }


def get_timeseries(start_date: str = "28daysAgo", end_date: str = "today") -> list[dict[str, Any]]:
    """일자별 활성 사용자/세션/페이지뷰 시계열."""
    client = _get_client()
    if client is None:
        return []

    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        dimensions=[Dimension(name="date")],
        metrics=[
            Metric(name="activeUsers"),
            Metric(name="sessions"),
            Metric(name="screenPageViews"),
            Metric(name="newUsers"),
        ],
        order_bys=[OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date"))],
        limit=400,
    )
    resp = client.run_report(req)
    out: list[dict[str, Any]] = []
    for r in resp.rows:
        date_raw = r.dimension_values[0].value  # YYYYMMDD
        try:
            date_iso = datetime.strptime(date_raw, "%Y%m%d").strftime("%Y-%m-%d")
        except ValueError:
            date_iso = date_raw
        v = [mv.value for mv in r.metric_values]
        out.append({
            "date": date_iso,
            "active_users": int(float(v[0] or 0)),
            "sessions": int(float(v[1] or 0)),
            "page_views": int(float(v[2] or 0)),
            "new_users": int(float(v[3] or 0)),
        })
    return out


def get_top_pages(start_date: str = "7daysAgo", end_date: str = "today", limit: int = 20) -> list[dict[str, Any]]:
    """상위 페이지(경로별 조회수·평균 체류 시간)."""
    client = _get_client()
    if client is None:
        return []

    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        dimensions=[Dimension(name="pagePath"), Dimension(name="pageTitle")],
        metrics=[
            Metric(name="screenPageViews"),
            Metric(name="activeUsers"),
            Metric(name="averageSessionDuration"),
        ],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="screenPageViews"), desc=True)],
        limit=limit,
    )
    resp = client.run_report(req)
    out = []
    for r in resp.rows:
        path = r.dimension_values[0].value
        title = r.dimension_values[1].value
        v = [mv.value for mv in r.metric_values]
        out.append({
            "path": path,
            "title": title,
            "page_views": int(float(v[0] or 0)),
            "active_users": int(float(v[1] or 0)),
            "avg_session_seconds": float(v[2] or 0.0),
        })
    return out


def get_top_countries(start_date: str = "7daysAgo", end_date: str = "today", limit: int = 15) -> list[dict[str, Any]]:
    """국가별 활성 사용자."""
    client = _get_client()
    if client is None:
        return []

    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="activeUsers"), Metric(name="sessions")],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="activeUsers"), desc=True)],
        limit=limit,
    )
    resp = client.run_report(req)
    out = []
    for r in resp.rows:
        country = r.dimension_values[0].value
        v = [mv.value for mv in r.metric_values]
        out.append({
            "country": country,
            "active_users": int(float(v[0] or 0)),
            "sessions": int(float(v[1] or 0)),
        })
    return out


def get_devices(start_date: str = "7daysAgo", end_date: str = "today") -> list[dict[str, Any]]:
    """디바이스 카테고리별(데스크탑/모바일/태블릿) 사용자."""
    client = _get_client()
    if client is None:
        return []

    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        dimensions=[Dimension(name="deviceCategory")],
        metrics=[Metric(name="activeUsers"), Metric(name="sessions")],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="activeUsers"), desc=True)],
    )
    resp = client.run_report(req)
    out = []
    for r in resp.rows:
        dev = r.dimension_values[0].value
        v = [mv.value for mv in r.metric_values]
        out.append({
            "device": dev,
            "active_users": int(float(v[0] or 0)),
            "sessions": int(float(v[1] or 0)),
        })
    return out


def get_traffic_sources(start_date: str = "7daysAgo", end_date: str = "today", limit: int = 15) -> list[dict[str, Any]]:
    """유입 채널/소스/매체별 활성 사용자."""
    client = _get_client()
    if client is None:
        return []

    from google.analytics.data_v1beta.types import (
        DateRange, Dimension, Metric, OrderBy, RunReportRequest,
    )

    req = RunReportRequest(
        property=_property_path(),
        date_ranges=[DateRange(start_date=start_date, end_date=end_date)],
        dimensions=[
            Dimension(name="sessionDefaultChannelGroup"),
            Dimension(name="sessionSource"),
        ],
        metrics=[Metric(name="activeUsers"), Metric(name="sessions")],
        order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="activeUsers"), desc=True)],
        limit=limit,
    )
    resp = client.run_report(req)
    out = []
    for r in resp.rows:
        channel = r.dimension_values[0].value
        source = r.dimension_values[1].value
        v = [mv.value for mv in r.metric_values]
        out.append({
            "channel": channel,
            "source": source,
            "active_users": int(float(v[0] or 0)),
            "sessions": int(float(v[1] or 0)),
        })
    return out


def get_realtime() -> dict[str, Any]:
    """지난 30분 활성 사용자(실시간)."""
    client = _get_client()
    if client is None:
        return {"configured": False, "active_users_30min": 0, "by_country": []}

    from google.analytics.data_v1beta.types import (
        Dimension, Metric, RunRealtimeReportRequest,
    )

    # 총 활성 사용자
    total_req = RunRealtimeReportRequest(
        property=_property_path(),
        metrics=[Metric(name="activeUsers")],
    )
    total_resp = client.run_realtime_report(total_req)
    active = 0
    if total_resp.rows:
        active = int(float(total_resp.rows[0].metric_values[0].value or 0))

    # 국가별 분포
    country_req = RunRealtimeReportRequest(
        property=_property_path(),
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="activeUsers")],
    )
    country_resp = client.run_realtime_report(country_req)
    by_country = []
    for r in country_resp.rows:
        by_country.append({
            "country": r.dimension_values[0].value,
            "active_users": int(float(r.metric_values[0].value or 0)),
        })
    return {
        "configured": True,
        "active_users_30min": active,
        "by_country": by_country,
    }
