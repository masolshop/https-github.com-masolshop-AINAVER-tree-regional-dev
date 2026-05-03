"""백엔드 2차 rate limit (slowapi).

목적
----
nginx limit_req 가 1차 방어선이지만 다음 경우엔 우회된다:
  · Cloudflare/nginx 미적용 환경 (개발 서버, 컨테이너 직접 노출)
  · 내부 호출 (다른 서비스가 127.0.0.1:8000 직접 호출)
  · nginx 설정 오류/롤백
  · IP 단위가 아니라 사용자(JWT sub) 단위로 제한하고 싶을 때

slowapi 는 Limiter 미들웨어를 통해 FastAPI 라우트 단위로 제한을 걸 수 있다.
키 함수는 X-Forwarded-For 우선 → fallback remote_addr.

사용 예 ::

    from app.core.rate_limit import limiter

    @router.post("/login")
    @limiter.limit("10/minute")
    async def login(request: Request, ...):
        ...

전역 적용은 ``main.py`` 에서 ``app.state.limiter = limiter`` 로 등록하면
SlowAPIMiddleware 가 모든 요청에 keyfunc 카운팅만 진행하고, 라우트 데코레이터가
있는 곳만 실제 차단한다.

Cloudflare 사용 시
-----------------
Cloudflare 를 거치면 remote_addr 는 항상 Cloudflare edge IP 이므로,
nginx real_ip_module 로 X-Forwarded-For 의 진짜 클라이언트 IP 를 복원한
뒤에야 slowapi 가 제대로 된 카운팅을 한다 (deploy/cloudflare/README.md 참조).
"""
from __future__ import annotations

import os
from typing import Callable

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


# ── 환경변수 토글 ────────────────────────────────────────────
# 운영 모드는 기본 ON. 부하 테스트/특수 운영 시 false 로 임시 OFF.
RATE_LIMIT_ENABLED: bool = (
    os.environ.get("RATE_LIMIT_ENABLED", "true").lower() in ("1", "true", "yes")
)

# 분당 전역 기본 제한 — 라우트 데코레이터가 없을 때도 폭주 방지용
DEFAULT_LIMITS: list[str] = [
    os.environ.get("RATE_LIMIT_DEFAULT", "120/minute"),
]


def _client_key(request: Request) -> str:
    """rate-limit 카운팅 키.

    우선순위:
      1) X-Forwarded-For 의 첫 IP (nginx/Cloudflare 가 신뢰 IP 로 채움)
      2) X-Real-IP (nginx proxy_set_header X-Real-IP)
      3) request.client.host (직결)

    JWT 인증된 사용자는 별도로 sub 단위로 묶고 싶을 수도 있으나,
    공격은 대부분 미인증 IP 폭격이므로 IP 단위가 충분.
    """
    # X-Forwarded-For: "client, proxy1, proxy2" — 가장 왼쪽이 진짜 클라이언트
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip", "")
    if real:
        return real.strip()
    # 마지막 fallback — slowapi 표준 헬퍼
    return get_remote_address(request)


# ── Limiter 인스턴스 (전역) ───────────────────────────────────
# storage_uri 미지정 → 인메모리. 단일 워커 배포(uvicorn --workers 1)에선 충분.
# 다중 워커/컨테이너로 확장 시 redis://... 로 교체 권장.
limiter = Limiter(
    key_func=_client_key,
    default_limits=DEFAULT_LIMITS if RATE_LIMIT_ENABLED else [],
    enabled=RATE_LIMIT_ENABLED,
    headers_enabled=True,  # 응답에 X-RateLimit-* 헤더 노출
    strategy="fixed-window",  # moving-window 보다 가볍고 nginx 와 정합
)


# ── 핸들러 — 429 응답 본문 표준화 ─────────────────────────────
async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
):
    """RateLimitExceeded 를 일관된 JSON 으로 변환.

    nginx 단의 429 (text/html) 와 형식이 달라 클라이언트가 둘 다 처리해야 한다.
    프론트엔드는 status === 429 만 보고 "잠시 후 다시 시도" 토스트를 띄우므로
    본문 차이는 문제 없음.
    """
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=429,
        content={
            "detail": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            "limit": str(exc.detail),
            "retry_after_seconds": 60,
        },
        headers={"Retry-After": "60"},
    )


__all__ = [
    "limiter",
    "rate_limit_exceeded_handler",
    "RATE_LIMIT_ENABLED",
]
