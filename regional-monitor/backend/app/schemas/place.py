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


# ─────────────────── 일괄 등록 (Excel/CSV) ───────────────────


class PlaceBulkRow(BaseModel):
    """일괄 등록 1행."""
    phone: str = Field(..., description="070-1234-5678 (자유 형식)")
    registered_dong_override: str | None = None
    business_name_override: str | None = None


class PlaceBulkRequest(BaseModel):
    """일괄 등록 요청.

    한 번의 API 호출에서 처리하는 청크 크기 — 권장 500건.
    - 클라이언트가 1만 행짜리 엑셀을 올려도 프론트에서 500건씩 청크로 나눠 호출.
    - 서버 상한은 안전망으로 1000건(이론상). 실 운용은 500건 청크.
    """
    rows: list[PlaceBulkRow] = Field(..., min_length=1, max_length=1000)


class BulkRowStatus(BaseModel):
    """일괄 등록 행별 결과."""
    phone: str                                # 입력값(정규화 시도 후)
    status: str                               # "created" / "duplicate" / "invalid_phone" / "extract_failed" / "quota_exceeded"
    place_id: str | None = None               # 성공 시
    business_name: str | None = None          # 성공 시
    error: str | None = None                  # 실패 시 사람 친화 메시지


class PlaceBulkResponse(BaseModel):
    """일괄 등록 결과."""
    requested: int
    created: int
    duplicate: int
    invalid_phone: int
    extract_failed: int
    quota_exceeded: int
    elapsed_ms: int
    quota_remaining: int                      # 남은 등록 가능 수
    rows: list[BulkRowStatus]


class PlaceBulkDeleteRequest(BaseModel):
    """일괄 삭제 요청.

    · ids 가 주어지면 해당 id 들만 삭제 (소유권 검증).
    · all=True 이고 ids 가 비어있으면 사용자의 모든 등록을 삭제.
    """
    ids: list[int] = Field(default_factory=list, max_length=10_000)
    all: bool = False


class PlaceBulkDeleteResponse(BaseModel):
    """일괄 삭제 결과."""
    requested: int     # 요청 건수 (all=True 인 경우 실제 삭제 시도 건수)
    deleted: int       # 실제 삭제된 건수
    not_found: int     # 소유권 없거나 존재하지 않은 건수
    elapsed_ms: int
