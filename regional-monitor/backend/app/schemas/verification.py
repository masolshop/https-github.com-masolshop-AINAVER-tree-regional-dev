"""검증 결과 스키마."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from .common import VerdictType


class VerificationDetail(BaseModel):
    """4중 검증 상세.

    fast 모드(페이지 존재 유무만 검증)에서는 phone_match/dong_match/name_match 가
    None 이며, UI에서 "—" 로 표시됨.
    """
    alive: bool
    phone_match: bool | None = False
    dong_match: bool | None = False
    name_match: bool | None = False
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
    """즉시 검증 요청.

    검증 프로세스 (UI 3단계):
      · 1단계 "등록 체크": place_ids=None, mode='full', only_pending=False
        → 사용자의 모든 등록을 정밀 검증.
      · 2단계 "재체크 (N건)": place_ids=None, mode='full', only_pending=True
        → current_verdict='PENDING' 인 항목만 정밀 재검증.
      · 3단계 "자동 정기 체크": 스케줄러가 매일 verify_slot 시각에 fast 모드로 자동 실행.
        (이 API 가 아닌 services.scheduler.run_slot_verification 이 담당)
    """
    place_ids: list[int] | None = None   # None = 사용자 등록 전체
    mode: str = "full"                   # "full" (전화+동 검증) / "fast" (페이지 존재 유무만)
    only_pending: bool = False           # True 시 current_verdict='PENDING' 인 등록만 검증
                                         # (재체크 버튼) — place_ids 와 동시 지정하면 교집합으로 동작


class LiveCheckResponse(BaseModel):
    """즉시 검증 응답."""
    total_ms: int
    avg_ms: int
    throughput: float          # req/s
    results: list[VerificationResult]
    summary: dict              # {ok, warning, danger}
