"""인증 코어 — JWT 발급/검증 + Google ID 토큰 검증 + 비밀번호 해싱.

- create_access_token(sub, extra)  : HS256 JWT 발급
- decode_token(token)              : 만료/위변조 검증 후 payload 반환 (실패 시 예외)
- verify_google_id_token(id_token) : Google이 발급한 ID 토큰 검증 → payload (email/sub/name/picture)
- hash_password(plain)             : bcrypt 해시
- verify_password(plain, hashed)   : bcrypt 검증
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.core.config import settings


# ─────────────────────────── 자체 JWT ───────────────────────────

def create_access_token(*, sub: str, extra: dict[str, Any] | None = None) -> str:
    """우리 서비스용 JWT 발급.

    sub : User.id (문자열)
    extra : email, plan 등 비민감 정보를 함께 담아 캐시처럼 사용
    """
    now = datetime.now(tz=timezone.utc)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.JWT_EXPIRES_HOURS)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


class TokenError(Exception):
    """JWT 검증 실패."""


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise TokenError(str(e)) from e


# ─────────────────────────── Google ID 토큰 ───────────────────────────

class GoogleAuthError(Exception):
    """Google ID 토큰 검증 실패."""


def verify_google_id_token(token: str) -> dict[str, Any]:
    """프론트가 받은 Google ID 토큰을 검증하고 payload(claims)를 반환한다.

    DEV 모드(GOOGLE_CLIENT_ID 미설정) 에서는 보안 검증을 건너뛰고
    토큰을 단순 디코드하여 사용한다 (UI 흐름 테스트용).
    운영 환경에서는 반드시 GOOGLE_CLIENT_ID 를 설정해야 한다.
    """
    client_id = settings.GOOGLE_CLIENT_ID.strip()

    if client_id:
        # 운영: 표준 검증 (서명/만료/issuer/aud 모두 확인)
        try:
            claims = google_id_token.verify_oauth2_token(
                token, google_requests.Request(), client_id
            )
        except ValueError as e:
            raise GoogleAuthError(f"google verify failed: {e}") from e
    else:
        # 개발: 검증 없이 디코드만 (jose가 키 없이도 디코드 가능)
        try:
            claims = jwt.get_unverified_claims(token)
        except JWTError as e:
            raise GoogleAuthError(f"id_token decode failed: {e}") from e

    # 최소 필드 확인
    if not claims.get("email") or not claims.get("sub"):
        raise GoogleAuthError("id_token missing email/sub claim")
    return claims


# ─────────────────────────── 비밀번호 해싱 ───────────────────────────
# bcrypt 의 입력 길이 제한(72 byte) 우회 위해 sha256 pre-hash 후 base64 인코딩.
# 표준 패턴이며 Django/FastAPI Users 등 다수 프레임워크가 동일 방식을 사용.

import base64
import hashlib


def _prehash(plain: str) -> bytes:
    """bcrypt 72 byte 제한 우회용 SHA-256 + base64 prehash."""
    digest = hashlib.sha256(plain.encode("utf-8")).digest()
    return base64.b64encode(digest)  # 44 bytes → bcrypt 안전


def hash_password(plain: str) -> str:
    """평문 비밀번호 → bcrypt 해시 문자열."""
    if not plain or not isinstance(plain, str):
        raise ValueError("password must be non-empty str")
    salt = bcrypt.gensalt(rounds=12)
    h = bcrypt.hashpw(_prehash(plain), salt)
    return h.decode("utf-8")


def verify_password(plain: str, hashed: str | None) -> bool:
    """평문 vs bcrypt 해시 검증. hashed 가 None/빈문자면 False."""
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(_prehash(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False
