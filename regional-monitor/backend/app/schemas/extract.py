"""070 → Place 자동 추출 API 스키마."""
from pydantic import BaseModel, Field


class ExtractRequest(BaseModel):
    phone: str = Field(..., description="070-XXXX-XXXX 또는 자유 형식")


class ExtractResponse(BaseModel):
    success: bool
    phone: str
    place_id: str | None = None
    name: str | None = None
    address: str | None = None
    dong: str | None = None
    category: str | None = None
    response_ms: int = 0
    error: str | None = None
