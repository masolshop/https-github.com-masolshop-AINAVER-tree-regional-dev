"""
Regional Monitor — FastAPI 진입점
================================
실행:
    uvicorn main:app --reload --port 8000
또는:
    python main.py
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler  # noqa: F401  (참고용)
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core import settings, init_db, decode_token, TokenError
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.api import api_router
from app.services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    await init_db()
    print(f"✅ {settings.APP_NAME} v{settings.APP_VERSION} started")
    print(f"   DB: {settings.DATABASE_URL}")
    print(f"   Debug: {settings.DEBUG}")
    # APScheduler — 매 시각(KST) 정각마다 슬롯별 자동 검증
    if settings.SCHEDULER_ENABLED:
        sched = start_scheduler()
        job = sched.get_job("slot_verification")
        nxt = job.next_run_time if job else None
        print(f"⏰ Scheduler armed (KST) — next run: {nxt}")
    else:
        print("⏰ Scheduler disabled (SCHEDULER_ENABLED=false)")
    yield
    # ── shutdown ──
    stop_scheduler()
    print("👋 Shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="타지역서비스 실시간 노출 관리 솔루션 — Place ID 기반 4중 검증 SaaS",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── slowapi 2차 rate limit (nginx 우회/내부 호출 방어) ──
# nginx limit_req 가 1차 방어선이고, slowapi 는 백엔드 직접 호출에도 작동하는 안전망.
# 라우트 데코레이터(@limiter.limit("10/minute")) 로 엔드포인트별 제한 가능.
# 전역 default_limits 는 app/core/rate_limit.py 의 DEFAULT_LIMITS 참조.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# ─────────────────────────────────────────────────────────
# 외부 공개 데모(is_demo=True) 게스트 차단 미들웨어
# ─────────────────────────────────────────────────────────
# /demo?t=... 로 진입한 게스트는 모든 mutation (POST/PATCH/PUT/DELETE) +
# 네이버 트래픽 발생 GET 엔드포인트에서 자동 차단된다.
# 의존성 주입 방식 대신 미들웨어로 한 곳에서 처리해 누락 위험을 제거.
#
# 통과(allow) 규칙:
#   1) GET / HEAD / OPTIONS — 단순 조회는 모두 허용 (단, 네이버 트래픽 GET 은 차단 목록에 명시)
#   2) /api/v1/auth/demo-login — 데모 로그인 자체
#   3) /api/v1/auth/logout, /api/v1/auth/me — 로그아웃/세션 확인
#   4) JWT 가 데모가 아닌 경우 — 일반 회원/관리자는 영향 없음
_DEMO_ALLOW_POST_PATHS = {
    "/api/v1/auth/demo-login",
    "/api/v1/auth/logout",
}

# 데모 차단 대상 GET 엔드포인트 (네이버 외부 트래픽 발생).
# prefix 매칭 — startswith 로 검사.
_DEMO_BLOCK_GET_PREFIXES = (
    "/api/v1/verify/live",                       # 단건 라이브 검증
    "/api/v1/rank-tracker/competition/",         # 키워드별 경쟁업체 조회
)


def _extract_jwt_payload(request: Request) -> dict | None:
    """Authorization: Bearer <jwt> 에서 payload 추출. 실패 시 None."""
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        return decode_token(token)
    except TokenError:
        return None


@app.middleware("http")
async def block_demo_mutations(request: Request, call_next):
    """데모 게스트의 mutation/외부 트래픽 호출을 403 으로 차단.

    is_demo 판정은 JWT payload 에 담긴 user_id 로 DB 조회 1회 (캐시 없음).
    GET 다수 호출 시 DB 부하 우려 → JWT 자체에 demo flag 를 박지 않고,
    오직 'mutation 또는 차단대상 GET' 일 때만 DB 조회한다.
    """
    method = request.method.upper()
    path = request.url.path

    # 1) safe method (HEAD/OPTIONS) — 항상 통과
    if method in ("HEAD", "OPTIONS"):
        return await call_next(request)

    # 2) GET 은 차단 prefix 에 해당될 때만 검사
    needs_check = False
    if method in ("POST", "PATCH", "PUT", "DELETE"):
        if path in _DEMO_ALLOW_POST_PATHS:
            return await call_next(request)
        needs_check = True
    elif method == "GET":
        if any(path.startswith(p) for p in _DEMO_BLOCK_GET_PREFIXES):
            needs_check = True

    if not needs_check:
        return await call_next(request)

    # 3) JWT 검사 — 없거나 잘못된 토큰이면 미들웨어 통과 (라우터 401 처리에 위임)
    payload = _extract_jwt_payload(request)
    if not payload:
        return await call_next(request)

    sub = payload.get("sub")
    try:
        user_id = int(sub) if sub is not None else None
    except (TypeError, ValueError):
        user_id = None

    if user_id is None:
        return await call_next(request)

    # 4) DB 조회 — is_demo 인지 확인 (격리된 세션 사용)
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import select as _select
    from app.models.user import User as _User

    try:
        async with AsyncSessionLocal() as _db:
            res = await _db.execute(_select(_User.is_demo).where(_User.id == user_id))
            is_demo = bool(res.scalar_one_or_none())
    except Exception:  # noqa: BLE001
        # DB 오류 시 미들웨어가 라우터 흐름을 막지 않도록 통과
        return await call_next(request)

    if is_demo:
        return JSONResponse(
            status_code=403,
            content={
                "detail": "외부 공개 데모 계정에서는 실제 기능을 사용할 수 없습니다. 회원가입 후 이용해주세요.",
                "reason": "demo_readonly",
            },
            headers={"X-Demo-Readonly": "1"},
        )

    return await call_next(request)

# CORS — credentials=True 와 origins="*" 는 브라우저가 거부하므로 분리
# DEBUG 모드: 모든 출처 허용 (credentials 없이)
# 운영 모드: 명시 도메인 + 정규식(sandbox.novita.ai 와일드카드)
if settings.DEBUG:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,  # credentials 없이만 wildcard 허용
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ALLOW_ORIGINS,
        allow_origin_regex=r"https://.*\.sandbox\.novita\.ai",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 라우터
app.include_router(api_router)


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="info",
    )
