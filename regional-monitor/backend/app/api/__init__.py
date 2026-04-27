"""API 라우터 패키지."""
from fastapi import APIRouter

from .auth import router as auth_router
from .extract import router as extract_router
from .places import router as places_router
from .verify import router as verify_router

# 모든 라우터를 /api/v1 하위로 통합
api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(extract_router)
api_router.include_router(places_router)
api_router.include_router(verify_router)

__all__ = ["api_router"]
