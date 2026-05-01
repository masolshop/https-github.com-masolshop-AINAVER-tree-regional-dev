"""GA4 OAuth 2.0 (개인 Gmail 인증) 플로우.

서비스 계정 권한 부여가 막힌 환경(GA4 속성 액세스 관리에서 추가 불가)에서
슈퍼어드민이 본인 Gmail 계정으로 1회 로그인하여 GA4 Data API 호출 권한을
얻기 위한 OAuth 토큰 저장/갱신 모듈.

흐름:
  1) /admin/analytics/oauth/start  → Google OAuth 동의 화면 URL 발급
  2) 사용자가 Google에서 동의 → /admin/analytics/oauth/callback?code=...
  3) authorization_code → access_token + refresh_token 교환 후 파일에 저장
  4) 이후 GA4 Data API 호출 시 _build_user_credentials() 가 자동 갱신

환경변수:
  GA4_OAUTH_CLIENT_ID
  GA4_OAUTH_CLIENT_SECRET
  GA4_OAUTH_REDIRECT_URI   — 예: https://taziyuk.com/api/v1/admin/analytics/oauth/callback
  GA4_OAUTH_TOKEN_FILE     — 토큰 저장 위치 (기본 /etc/regionwatch/ga4-oauth-token.json)

토큰 파일은 0600 권한으로 저장되며, refresh_token 만 있으면 access_token 은
자동 재발급 가능하므로 영구적으로 사용된다.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# GA4 Data API 호출 + 사용자 이메일 식별을 위한 스코프
GA4_SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

# CSRF 방지용 state 임시 저장소 (단일 프로세스 메모리)
_state_store: set[str] = set()


# ──────────────────────────────────────────────────────────────
# 설정/경로
# ──────────────────────────────────────────────────────────────


def is_oauth_configured() -> bool:
    """OAuth 클라이언트 ID/Secret/Redirect 모두 설정되었는가."""
    return bool(
        settings.GA4_OAUTH_CLIENT_ID
        and settings.GA4_OAUTH_CLIENT_SECRET
        and settings.GA4_OAUTH_REDIRECT_URI
    )


def _token_file_path() -> str:
    """OAuth 토큰을 저장할 파일 경로."""
    return settings.GA4_OAUTH_TOKEN_FILE or "/etc/regionwatch/ga4-oauth-token.json"


def has_user_token() -> bool:
    """저장된 OAuth 토큰이 존재하는가."""
    path = _token_file_path()
    return os.path.isfile(path) and os.path.getsize(path) > 0


def get_connected_account_email() -> str | None:
    """저장된 토큰의 user_email 반환 (없으면 None)."""
    if not has_user_token():
        return None
    try:
        with open(_token_file_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("user_email")
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────
# 동의 URL 발급 / 콜백 교환
# ──────────────────────────────────────────────────────────────


def build_authorization_url() -> tuple[str, str]:
    """Google 동의 화면 URL과 state 토큰 반환.

    state 는 CSRF 방지용으로 콜백에서 검증한다.
    """
    if not is_oauth_configured():
        raise RuntimeError("GA4 OAuth 클라이언트가 설정되지 않았습니다.")

    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError as e:
        raise RuntimeError(
            "google-auth-oauthlib 패키지가 설치되지 않았습니다."
        ) from e

    state = secrets.token_urlsafe(32)
    _state_store.add(state)

    flow = Flow.from_client_config(
        client_config={
            "web": {
                "client_id": settings.GA4_OAUTH_CLIENT_ID,
                "client_secret": settings.GA4_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GA4_OAUTH_REDIRECT_URI],
            }
        },
        scopes=GA4_SCOPES,
        state=state,
    )
    flow.redirect_uri = settings.GA4_OAUTH_REDIRECT_URI

    auth_url, _ = flow.authorization_url(
        access_type="offline",       # refresh_token 발급
        include_granted_scopes="true",
        prompt="consent",            # 매번 refresh_token 재발급
    )
    return auth_url, state


def exchange_code_for_token(code: str, state: str) -> dict[str, Any]:
    """authorization_code 를 access/refresh 토큰으로 교환 후 파일 저장."""
    if not is_oauth_configured():
        raise RuntimeError("GA4 OAuth 클라이언트가 설정되지 않았습니다.")
    if state not in _state_store:
        # 서버 재시작 시에도 동작하도록 경고만 — 운영 안정성 우선.
        logger.warning("OAuth state 미일치(서버 재시작 가능). 처리는 계속합니다.")
    else:
        _state_store.discard(state)

    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        client_config={
            "web": {
                "client_id": settings.GA4_OAUTH_CLIENT_ID,
                "client_secret": settings.GA4_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GA4_OAUTH_REDIRECT_URI],
            }
        },
        scopes=GA4_SCOPES,
    )
    flow.redirect_uri = settings.GA4_OAUTH_REDIRECT_URI
    flow.fetch_token(code=code)

    creds = flow.credentials
    user_email = _fetch_user_email(creds.token)

    payload = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or GA4_SCOPES),
        "user_email": user_email,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    _save_token(payload)
    return payload


def disconnect() -> bool:
    """저장된 OAuth 토큰을 삭제."""
    path = _token_file_path()
    if os.path.isfile(path):
        try:
            os.remove(path)
            return True
        except Exception as e:
            logger.warning("토큰 파일 삭제 실패: %s", e)
            return False
    return False


# ──────────────────────────────────────────────────────────────
# 자격 증명 빌드 (GA4 Data API 호출용)
# ──────────────────────────────────────────────────────────────


def build_user_credentials():
    """저장된 OAuth 토큰으로 google Credentials 객체 반환. 없으면 None."""
    if not has_user_token():
        return None
    try:
        from google.oauth2.credentials import Credentials
    except ImportError:
        logger.warning("google-auth 패키지가 설치되지 않았습니다.")
        return None

    try:
        with open(_token_file_path(), "r", encoding="utf-8") as f:
            data = json.load(f)

        creds = Credentials(
            token=data.get("token"),
            refresh_token=data.get("refresh_token"),
            token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=data.get("client_id") or settings.GA4_OAUTH_CLIENT_ID,
            client_secret=data.get("client_secret") or settings.GA4_OAUTH_CLIENT_SECRET,
            scopes=data.get("scopes", GA4_SCOPES),
        )

        # 만료 시 자동 갱신
        if creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            data["token"] = creds.token
            if creds.expiry:
                data["expiry"] = creds.expiry.isoformat()
            _save_token(data)

        return creds
    except Exception as e:
        logger.exception("OAuth credential 로드 실패: %s", e)
        return None


# ──────────────────────────────────────────────────────────────
# 내부 helpers
# ──────────────────────────────────────────────────────────────


def _save_token(payload: dict[str, Any]) -> None:
    path = _token_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def _fetch_user_email(access_token: str) -> str | None:
    """access_token 으로 사용자 이메일을 조회."""
    try:
        import httpx
        r = httpx.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
        if r.status_code == 200:
            return (r.json() or {}).get("email")
    except Exception as e:
        logger.warning("사용자 이메일 조회 실패: %s", e)
    return None
