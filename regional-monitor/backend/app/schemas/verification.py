"""검증 결과 스키마."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from .common import VerdictType


class VerificationDetail(BaseModel):
    """4중 검증 상세."""
    alive: bool
    phone_match: bool
    dong_match: bool
    name_match: bool
    actual_phone: str | None = None
    actual_dong: str | None = None
    actual_name: str | None = None
    actual_address: str | None = None


class VerificationResult(BaseModel):
    """검증 결과 + 등록 정보."""
    model_config = ConfigDict(from_attributes=True)

    place_id_ref: int             # registered_places.id
    phone: str
    place_id: str                 # 네이버 Place ID
    registered_dong: str
    business_name: str

    detail: VerificationDetail
    verdict: VerdictType
    response_ms: int
    http_status: int
    error: str | None = None
    checked_at: datetime


class LiveCheckRequest(BaseModel):
    """즉시 검증 요청."""
    place_ids: list[int] | None = None   # None = 사용자 등록 전체


class LiveCheckResponse(BaseModel):
    """즉시 검증 응답."""
    total_ms: int
    avg_ms: int
    throughput: float          # req/s
    results: list[VerificationResult]
    summary: dict              # {ok, warning, danger}
