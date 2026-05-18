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
    """GA4 Data API 호출이 가능한 환경인지 확인.

    1) Property ID 가 있고
    2) 서비스 계정 키(파일/JSON) 또는 OAuth 사용자 토큰 중 하나라도 존재해야 한다.
    """
    if not settings.GA4_PROPERTY_ID:
        return False
    if settings.GA4_CREDENTIALS_FILE or settings.GA4_CREDENTIALS_JSON:
        return True
    # OAuth 사용자 토큰 확인
    try:
        from app.services import ga4_oauth
        return ga4_oauth.has_user_token()
    except Exception:
        return False


def _get_client(force_refresh: bool = False):
    """BetaAnalyticsDataClient 인스턴스 반환. 미설정/미설치 시 None.

    우선순위:
      1) OAuth 사용자 토큰 (개인 Gmail 인증, 서비스 계정 차단 우회)
      2) 서비스 계정 JSON 환경변수
      3) 서비스 계정 키 파일

    Args:
        force_refresh: True 시 OAuth 토큰을 무조건 refresh 후 클라이언트 생성.
            (401 발생 후 재시도용)
    """
    if not settings.GA4_PROPERTY_ID:
        return None
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
    except ImportError:
        logger.warning("google-analytics-data 패키지가 설치되지 않았습니다.")
        return None

    # 1) OAuth 사용자 토큰 우선 시도
    try:
        from app.services import ga4_oauth
        user_creds = ga4_oauth.build_user_credentials(force_refresh=force_refresh)
        if user_creds is not None:
            return BetaAnalyticsDataClient(credentials=user_creds)
    except Exception as e:
        logger.warning("OAuth credential 사용 실패, 서비스 계정 fallback: %s", e)

    # 2/3) 서비스 계정 fallback
    if not (settings.GA4_CREDENTIALS_FILE or settings.GA4_CREDENTIALS_JSON):
        return None
    try:
        from google.oauth2 import service_account
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


def _is_auth_error(exc: Exception) -> bool:
    """예외가 인증 만료(401) 관련인지 판별."""
    msg = str(exc).lower()
    if "unauthenticated" in msg or "401" in msg:
        return True
    # google-api-core 의 Unauthenticated 예외 클래스 이름으로 판별
    name = type(exc).__name__.lower()
    return "unauthenticated" in name or "unauthorized" in name


def _call_with_auto_refresh(fn):
    """GA4 호출 함수를 401 발생 시 토큰 강제 refresh 후 1회 재시도하는 래퍼.

    `_get_client()` 가 OAuth 토큰을 사용하는 경우, access_token 이 만료되었거나
    revoke 상태에서 401(Unauthenticated)이 떨어지면 한 번 더 강제 refresh 후
    동일 호출을 시도한다. 두 번째 시도도 실패하면 그대로 예외를 전파한다.

    fn 시그니처: fn(client) -> Any
    """
    client = _get_client(force_refresh=False)
    if client is None:
        return None  # caller 가 None 처리
    try:
        return fn(client)
    except Exception as e:
        if not _is_auth_error(e):
            raise
        logger.warning("GA4 호출 401 → 토큰 강제 refresh 후 재시도: %s", type(e).__name__)
        client2 = _get_client(force_refresh=True)
        if client2 is None:
            raise
        return fn(client2)


def _property_path() -> str:
    return f"properties/{settings.GA4_PROPERTY_ID}"


# ──────────────────────────────────────────────────────────────
# 보고서 함수들
# ──────────────────────────────────────────────────────────────


def get_summary(start_date: str = "7daysAgo", end_date: str = "today") -> dict[str, Any]:
    """기간별 핵심 KPI(활성 사용자/세션/조회/이탈률/평균 세션 시간) 합계."""
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
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
    resp = _call_with_auto_refresh(lambda c: c.run_report(req))
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
    if _get_client() is None:
        return {"configured": False, "active_users_30min": 0, "by_country": []}

    from google.analytics.data_v1beta.types import (
        Dimension, Metric, RunRealtimeReportRequest,
    )

    # 총 활성 사용자
    total_req = RunRealtimeReportRequest(
        property=_property_path(),
        metrics=[Metric(name="activeUsers")],
    )
    total_resp = _call_with_auto_refresh(lambda c: c.run_realtime_report(total_req))
    active = 0
    if total_resp.rows:
        active = int(float(total_resp.rows[0].metric_values[0].value or 0))

    # 국가별 분포
    country_req = RunRealtimeReportRequest(
        property=_property_path(),
        dimensions=[Dimension(name="country")],
        metrics=[Metric(name="activeUsers")],
    )
    country_resp = _call_with_auto_refresh(lambda c: c.run_realtime_report(country_req))
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
