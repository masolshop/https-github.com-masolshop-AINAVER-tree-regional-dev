"""API 라우터 패키지."""
from fastapi import APIRouter

from .admin import router as admin_router
from .admin_analytics import router as admin_analytics_router
from .admin_analytics import oauth_callback_router as admin_analytics_oauth_callback_router
from .auth import router as auth_router
from .backup import router as backup_router
from .events import router as events_router
from .extract import router as extract_router
from .competition import router as competition_router
from .keyword import router as keyword_router
from .keyword_dna import router as keyword_dna_router
from .places import router as places_router
from .rank_tracker import router as rank_tracker_router
from .settings import router as settings_router
from .sitemap import router as sitemap_router
from .verify import router as verify_router

# 모든 라우터를 /api/v1 하위로 통합
api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(extract_router)
api_router.include_router(places_router)
api_router.include_router(verify_router)
api_router.include_router(events_router)
api_router.include_router(settings_router)
api_router.include_router(admin_router)
api_router.include_router(admin_analytics_router)
api_router.include_router(admin_analytics_oauth_callback_router)
api_router.include_router(backup_router)
api_router.include_router(keyword_router)
api_router.include_router(competition_router)
api_router.include_router(keyword_dna_router)
api_router.include_router(rank_tracker_router)
api_router.include_router(sitemap_router)

__all__ = ["api_router"]
