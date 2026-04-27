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
    """검증 결과 + 등록 정보.

    place_id / registered_dong / business_name 은 등록 직후(추출 전) 검증을
    수행하는 경우 NULL 일 수 있음. 추출 실패 시에도 NULL 그대로 반환.
    """
    model_config = ConfigDict(from_attributes=True)

    place_id_ref: int             # registered_places.id
    phone: str
    place_id: str | None = None   # 네이버 Place ID (등록 직후 NULL 가능)
    registered_dong: str | None = None
    business_name: str | None = None

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
