"""Place(070 등록) 관련 스키마."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from .common import VerdictType


class PlaceCreate(BaseModel):
    """수동 등록 — 모든 필드 사용자 입력."""
    phone: str = Field(..., description="070-1234-5678")
    place_id: str = Field(..., description="네이버 Place ID (자동 추출 또는 수동)")
    registered_dong: str = Field(..., description="등록 시점 동/주소")
    business_name: str = Field(..., description="등록 상호")


class PlaceCreateAuto(BaseModel):
    """자동 등록 — 070만 입력하면 추출/저장."""
    phone: str = Field(..., description="070-1234-5678 (자유 형식)")
    # 사용자가 수정한 값을 우선 적용 (옵셔널)
    registered_dong_override: str | None = None
    business_name_override: str | None = None


class PlaceUpdate(BaseModel):
    """등록 정보 수정 (등록 동 / 상호명만)."""
    registered_dong: str | None = None
    business_name: str | None = None


class PlaceOut(BaseModel):
    """단건 응답."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    phone: str
    place_id: str
    registered_dong: str
    business_name: str
    full_address: str | None = None
    category: str | None = None
    current_verdict: VerdictType
    last_checked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class PlaceSummary(BaseModel):
    """등록 리스트 요약 카운트."""
    total: int
    ok: int
    warning: int      # PHONE_MISMATCH + DONG_MISMATCH + NAME_MISMATCH
    danger: int       # REGION_MISMATCH + DEAD
    pending: int      # PENDING + CHECKING


class PlaceListOut(BaseModel):
    """리스트 응답 (요약 + 목록)."""
    summary: PlaceSummary
    items: list[PlaceOut]
