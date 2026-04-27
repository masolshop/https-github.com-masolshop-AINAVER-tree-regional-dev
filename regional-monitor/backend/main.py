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

from app.core import settings, init_db
from app.api import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    await init_db()
    print(f"✅ {settings.APP_NAME} v{settings.APP_VERSION} started")
    print(f"   DB: {settings.DATABASE_URL}")
    print(f"   Debug: {settings.DEBUG}")
    yield
    # ── shutdown ──
    print("👋 Shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="타지역서비스 실시간 노출 관리 솔루션 — Place ID 기반 4중 검증 SaaS",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS + ["*"] if settings.DEBUG else settings.CORS_ALLOW_ORIGINS,
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
