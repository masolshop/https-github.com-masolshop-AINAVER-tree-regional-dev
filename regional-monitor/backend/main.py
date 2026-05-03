"""
Regional Monitor — FastAPI 진입점
================================
실행:
    uvicorn main:app --reload --port 8000
또는:
    python main.py
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler  # noqa: F401  (참고용)
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core import settings, init_db
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
