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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.services import ga4_analytics, ga4_oauth
from .deps import require_superadmin

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin-analytics"],
    dependencies=[Depends(require_superadmin)],
)

# OAuth 콜백은 Google 리디렉션이 토큰을 들고 오므로 require_superadmin 가드를
# 적용하지 않는 별도 라우터로 등록한다 (콜백 자체에서 state 검증).
oauth_callback_router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin-analytics-oauth"],
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
    """GA4 자격 증명·Property ID 설정 여부.

    `oauth_connected` 는 토큰 파일 존재 여부만 본다.
    `oauth_token_valid` 는 실제로 refresh 가 가능한지(즉 GA4 호출이
    실제로 작동할지) 검증한 결과이다 — 만료/revoke 된 refresh_token 의 경우
    파일은 존재해도 False 가 된다. 프론트는 이 값을 보고 재인증 안내를
    표시한다.
    """
    # 자격 증명 소스 우선순위: oauth_user > json_env > file
    has_oauth = ga4_oauth.has_user_token()
    if has_oauth:
        cred_source = "oauth_user"
    elif settings.GA4_CREDENTIALS_JSON:
        cred_source = "json_env"
    elif settings.GA4_CREDENTIALS_FILE:
        cred_source = "file"
    else:
        cred_source = None

    # 토큰 유효성 — OAuth 사용 시에만 의미가 있다.
    # 서비스 계정 자격증명은 별도의 만료 개념이 없으므로 None 으로 둔다.
    if has_oauth:
        token_valid: bool | None = ga4_oauth.is_user_token_valid()
    else:
        token_valid = None

    return {
        "configured": ga4_analytics.is_ga4_configured(),
        "property_id": settings.GA4_PROPERTY_ID or None,
        "credentials_source": cred_source,
        "oauth_configured": ga4_oauth.is_oauth_configured(),
        "oauth_connected": has_oauth,
        "oauth_token_valid": token_valid,
        "oauth_account_email": ga4_oauth.get_connected_account_email(),
    }


# ──────────────────────────────────────────────────────────────
# OAuth 플로우 (개인 Gmail 인증)
# ──────────────────────────────────────────────────────────────


@router.get("/oauth/start")
def oauth_start() -> dict:
    """Google 동의 화면 URL 발급 — 슈퍼어드민이 본인 Gmail 로 GA4 권한 위임."""
    if not ga4_oauth.is_oauth_configured():
        raise HTTPException(
            status_code=503,
            detail="GA4_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI 환경변수가 설정되지 않았습니다.",
        )
    try:
        auth_url, state = ga4_oauth.build_authorization_url()
    except Exception as e:
        logger.exception("OAuth 동의 URL 생성 실패")
        raise HTTPException(status_code=500, detail=f"OAuth 시작 실패: {type(e).__name__}: {e}")
    return {"authorization_url": auth_url, "state": state}


@router.post("/oauth/disconnect")
def oauth_disconnect() -> dict:
    """저장된 OAuth 사용자 토큰 삭제 (연결 해제)."""
    removed = ga4_oauth.disconnect()
    return {"disconnected": removed}


@oauth_callback_router.get("/oauth/callback")
def oauth_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
):
    """Google 로부터 redirect 받아 authorization_code → token 교환 후 어드민으로 복귀."""
    if error:
        msg = f"OAuth 동의 거부 또는 오류: {error}"
        return _render_oauth_result_html(success=False, message=msg)
    if not code or not state:
        return _render_oauth_result_html(success=False, message="code/state 파라미터 누락")

    try:
        payload = ga4_oauth.exchange_code_for_token(code=code, state=state)
        email = payload.get("user_email") or "(이메일 미상)"
        return _render_oauth_result_html(
            success=True,
            message=f"GA4 OAuth 연결 완료 — {email}",
        )
    except Exception as e:
        logger.exception("OAuth code 교환 실패")
        return _render_oauth_result_html(
            success=False,
            message=f"토큰 교환 실패: {type(e).__name__}: {e}",
        )


def _render_oauth_result_html(success: bool, message: str):
    """간단한 결과 페이지 렌더(자동 닫기 + 부모창 갱신)."""
    from fastapi.responses import HTMLResponse
    color = "#10b981" if success else "#ef4444"
    icon = "✅" if success else "❌"
    redirect_to = settings.GA4_OAUTH_SUCCESS_REDIRECT or "/admin?tab=analytics"
    html = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>GA4 OAuth</title>
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       margin:0;padding:48px 24px;background:#0f172a;color:#e2e8f0;text-align:center}}
  .card{{max-width:520px;margin:0 auto;background:#1e293b;padding:32px;border-radius:12px;
        border:2px solid {color}}}
  h1{{font-size:22px;margin:0 0 16px;color:{color}}}
  p{{font-size:15px;line-height:1.6}}
  a.btn{{display:inline-block;margin-top:24px;background:{color};color:#fff;
       padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600}}
</style></head><body>
<div class="card">
  <h1>{icon} GA4 OAuth {'성공' if success else '실패'}</h1>
  <p>{message}</p>
  <a class="btn" href="{redirect_to}">슈퍼어드민 콘솔로 돌아가기</a>
</div>
<script>
  // 부모창에서 GA4 헬스 카드 자동 갱신
  if (window.opener) {{
    try {{ window.opener.postMessage({{type:'ga4-oauth-result', success:{str(success).lower()}}}, '*'); }} catch(e){{}}
  }}
  // 3초 뒤 자동 이동
  setTimeout(function(){{ window.location.href = '{redirect_to}'; }}, 3000);
</script>
</body></html>"""
    return HTMLResponse(content=html, status_code=200 if success else 400)


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
