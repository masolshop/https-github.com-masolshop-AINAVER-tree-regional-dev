"""RankTracker (솔루션 #5) Pydantic 스키마."""
from __future__ import annotations

from datetime import datetime, date
from typing import Any

from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────────────────
# 업로드 입력
# ─────────────────────────────────────────────────────────
class RankUploadRow(BaseModel):
    """업로드 1행 (Excel 4컬럼: 070전번 | 등록동 | 상호 | 추적키워드)."""
    phone: str = Field(..., description="070-XXXX-XXXX 형식")
    registered_dong: str = Field(..., description="등록동 (예: 압구정동)")
    business_name: str = Field(..., description="상호")
    tracking_keywords: list[str] = Field(
        default_factory=list,
        description="추적 키워드 배열 (최대 5개)",
        max_length=5,
    )

    @field_validator("tracking_keywords", mode="before")
    @classmethod
    def _split_keywords(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [k.strip() for k in v.split(",") if k.strip()]
        if isinstance(v, list):
            return [str(k).strip() for k in v if str(k).strip()]
        return []


class RankUploadRequest(BaseModel):
    rows: list[RankUploadRow]


class RankUploadRowResult(BaseModel):
    """업로드 결과 1행."""
    row_index: int
    phone: str
    status: str  # CREATED / UPDATED / SKIPPED / ERROR
    place_pk: int | None = None
    message: str | None = None


class RankUploadResponse(BaseModel):
    total: int
    created: int
    updated: int
    skipped: int
    errors: int
    rows: list[RankUploadRowResult]


# ─────────────────────────────────────────────────────────
# 매칭 결과 조회
# ─────────────────────────────────────────────────────────
class RankPlaceCandidate(BaseModel):
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str
    score: int
    reasons: list[str] = Field(default_factory=list)


class RankPlaceOut(BaseModel):
    id: int
    phone: str
    registered_dong: str | None
    business_name: str | None
    place_id: str | None
    tracking_keywords: list[str] = Field(default_factory=list)
    match_status: str | None
    match_confidence: int | None
    matched_at: datetime | None
    candidates: list[RankPlaceCandidate] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class RankPlaceListOut(BaseModel):
    total: int
    auto_matched: int
    review_needed: int
    not_found: int
    pending: int
    confirmed: int
    items: list[RankPlaceOut]


# ─────────────────────────────────────────────────────────
# 매칭 실행 / 후보 선택
# ─────────────────────────────────────────────────────────
class RunMatchRequest(BaseModel):
    """전체 PENDING_MATCH 행을 다시 매칭 시도. 옵션으로 특정 ID만 지정 가능."""
    place_ids: list[int] | None = None


class RunMatchResponse(BaseModel):
    requested: int
    processed: int
    auto_matched: int
    review_needed: int
    not_found: int
    errors: int


class ConfirmCandidateRequest(BaseModel):
    place_id: str = Field(..., description="확정할 네이버 place_id")


# ─────────────────────────────────────────────────────────
# 순위 이력 조회
# ─────────────────────────────────────────────────────────
class RankHistoryPoint(BaseModel):
    check_date: date
    rank: int | None
    out_of_range: bool
    rank_delta: int | None = None
    total_results: int | None = None


class RankHistorySeries(BaseModel):
    keyword: str
    points: list[RankHistoryPoint]


class RankHistoryResponse(BaseModel):
    place_pk: int
    business_name: str | None
    registered_dong: str | None
    series: list[RankHistorySeries]


# ─────────────────────────────────────────────────────────
# 일별 배치 실행 (수동 트리거, 관리자)
# ─────────────────────────────────────────────────────────
class RunRankCheckResponse(BaseModel):
    started: int
    skipped_unmatched: int
    elapsed_sec: int | None = None
    message: str | None = None
