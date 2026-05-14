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
# 매칭 결과 조회 (070+동 단일 매칭 정책)
# ─────────────────────────────────────────────────────────
class RankPlaceCandidate(BaseModel):
    """매칭된 단일 플레이스 (예전 명칭 호환 — 실제로는 단일 매칭)."""
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str
    reasons: list[str] = Field(default_factory=list)


class RankPlaceOut(BaseModel):
    id: int
    phone: str
    registered_dong: str | None
    business_name: str | None
    place_id: str | None
    tracking_keywords: list[str] = Field(default_factory=list)
    match_status: str | None       # AUTO_MATCHED / NEEDS_MANUAL / PENDING_MATCH
    matched_at: datetime | None
    # 매칭된 단일 플레이스 (070 일치 1건)
    matched: RankPlaceCandidate | None = None
    # 변경 노출 플래그 — True 이면 등록동과 실제 노출동이 다름
    dong_changed: bool = False
    actual_dong: str | None = None

    model_config = {"from_attributes": True}


class RankPlaceListOut(BaseModel):
    total: int
    auto_matched: int
    needs_manual: int
    pending: int
    dong_changed_count: int = 0
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
    needs_manual: int
    errors: int


class ConfirmCandidateRequest(BaseModel):
    """[DEPRECATED] 070+동 정책 도입 후 사용 안 함. 호환용으로만 유지."""
    place_id: str = Field(..., description="(deprecated) 확정할 네이버 place_id")


# ─────────────────────────────────────────────────────────
# 변경 노출 배너용 응답 (대시보드 상단)
# ─────────────────────────────────────────────────────────
class DongChangedItem(BaseModel):
    """변경 노출 1건 — 등록동과 실제 노출동이 다른 케이스."""
    id: int
    phone: str
    business_name: str | None
    registered_dong: str | None
    actual_dong: str | None
    place_id: str | None
    address: str | None = None


class DongChangedListOut(BaseModel):
    """변경 노출 N건 — 대시보드 상단 배너에 표시할 데이터."""
    count: int
    items: list[DongChangedItem]


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
# 매트릭스용 벌크 엔드포인트 (등록동×키워드 한 방 조회)
# ─────────────────────────────────────────────────────────
class LatestRankCell(BaseModel):
    """매트릭스 셀 1개 — (place_pk, keyword)의 최신 순위."""
    place_pk: int
    keyword: str
    rank: int | None
    out_of_range: bool = False
    check_date: date | None = None


class LatestRanksResponse(BaseModel):
    """매트릭스용 전체 응답 — DB 한 번 조회로 모든 (place×keyword) 최신 순위 반환.

    프론트엔드 매트릭스가 N개 플레이스에 대해 개별 /history 호출하던 것을
    이 단일 엔드포인트로 치환 (네이버 검색 호출 없음, DB SELECT 1회).
    """
    count: int
    cells: list[LatestRankCell]


# ─────────────────────────────────────────────────────────
# 일별 배치 실행 (수동 트리거, 관리자)
# ─────────────────────────────────────────────────────────
class RunRankCheckResponse(BaseModel):
    started: int
    skipped_unmatched: int
    elapsed_sec: int | None = None
    message: str | None = None
