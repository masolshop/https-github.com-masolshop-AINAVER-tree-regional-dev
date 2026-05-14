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
    # 2단계 UX: 추적 키워드 등록 여부 (없으면 "키워드 추가" 인라인 UI 노출)
    has_keywords: bool = False

    model_config = {"from_attributes": True}


class RankPlaceListOut(BaseModel):
    total: int
    auto_matched: int
    needs_manual: int
    pending: int
    dong_changed_count: int = 0
    # monitor 에 등록되었지만 아직 추적 키워드를 등록하지 않은 업체 수
    no_keywords_count: int = 0
    items: list[RankPlaceOut]


# ─────────────────────────────────────────────────────────
# 추적 키워드 인라인 편집 (2단계 UX)
# ─────────────────────────────────────────────────────────
class UpdateKeywordsRequest(BaseModel):
    """단일 업체의 tracking_keywords 만 인라인 업데이트.

    엑셀 업로드 대신 monitor 에 이미 등록된 업체에 키워드만 추가/수정한다.
    """
    tracking_keywords: list[str] = Field(
        default_factory=list,
        description="추적 키워드 배열 (0~5개). 빈 배열이면 키워드 전체 제거.",
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


class UpdateKeywordsResponse(BaseModel):
    """추적 키워드 업데이트 결과."""
    place_pk: int
    tracking_keywords: list[str]
    match_status: str | None
    auto_matched: bool                  # True 면 즉시 AUTO_MATCHED (rank check 시작)
    rank_check_enqueued: bool           # True 면 백그라운드에서 즉시 순위체크 시작


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
# 수동 place_id 확정 (NEEDS_MANUAL 행을 유저가 직접 해결)
# ─────────────────────────────────────────────────────────
class ConfirmPlaceIdRequest(BaseModel):
    """유저가 네이버에서 직접 찾은 place_id 를 입력해서 NEEDS_MANUAL → AUTO_MATCHED 승격.

    place_id 만 받아 페이지를 fetch 한 뒤:
      · 페이지 살아있음(200, dead 키워드 없음)
      · 페이지의 070/가상번호가 등록 070과 일치 (또는 force=True 로 우회)
    조건을 통과하면 AUTO_MATCHED 로 승격 + 즉시 rank check 시작.
    """
    place_id: str = Field(
        ...,
        description="네이버 place_id (예: '1062331436' 또는 URL의 마지막 숫자 부분)",
        min_length=3,
        max_length=20,
    )
    force: bool = Field(
        default=False,
        description=(
            "True 면 phone 불일치도 허용. "
            "유저가 '내 번호가 안 보여도 이 place 가 맞다'고 확신할 때 사용."
        ),
    )

    @field_validator("place_id", mode="before")
    @classmethod
    def _strip_place_id(cls, v: Any) -> str:
        s = str(v or "").strip()
        # URL 입력 케이스: ".../place/123456789/home" → "123456789"
        m = __import__("re").search(r"(\d{3,20})", s)
        return m.group(1) if m else s


class ConfirmPlaceIdResponse(BaseModel):
    """수동 확정 결과."""
    place_pk: int
    place_id: str
    status: str                 # AUTO_MATCHED / FAILED
    actual_name: str | None = None
    actual_phone: str | None = None
    actual_address: str | None = None
    phone_match: bool           # 페이지 phone 이 등록 070 과 일치했는지
    forced: bool                # force=True 로 phone 불일치를 우회했는지
    message: str | None = None


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
# 진행 상태 (업로드 직후 자동 매칭+순위체크 폴링용)
# ─────────────────────────────────────────────────────────
class RankCheckProgress(BaseModel):
    """프론트 폴링용 — 매칭/순위체크 진행 상태 요약.

    프론트는 업로드 후 이 엔드포인트를 5초 간격으로 폴링하여
    pending_match=0 AND filled_cells==total_cells 가 되면 폴링을 멈춘다.
    """
    total_places: int          # 사용자 등록 플레이스 총 개수
    pending_match: int          # 매칭 대기 중 (백그라운드 매칭 진행 중)
    auto_matched: int           # 매칭 완료 (rank check 가능)
    needs_manual: int           # 매칭 0건 (수동 확인 필요)
    total_cells: int            # AUTO_MATCHED × tracking_keywords 합산
    filled_cells: int           # PlaceRankHistory에 기록 있는 셀 개수
    in_progress: bool           # True 면 아직 작업 중 — 프론트는 폴링 계속


# ─────────────────────────────────────────────────────────
# 전체 초기화 (사용자 본인의 데이터 비우기)
# ─────────────────────────────────────────────────────────
class ResetAllResponse(BaseModel):
    """DELETE /reset-all 응답 — 삭제된 행 수 요약.

    사용자가 "재업로드하기 위해 초기화" 할 때 호출한다.
    본인 user_id 의 RegisteredPlace + PlaceRankHistory 만 삭제하며,
    다른 사용자의 데이터에는 영향 없음.
    """
    deleted_places: int
    deleted_history: int
    message: str


# ─────────────────────────────────────────────────────────
# 일별 배치 실행 (수동 트리거, 관리자)
# ─────────────────────────────────────────────────────────
class RunRankCheckResponse(BaseModel):
    started: int
    skipped_unmatched: int
    elapsed_sec: int | None = None
    message: str | None = None


# ─────────────────────────────────────────────────────────
# 경쟁업체 스냅샷 (모달에서 키워드 클릭 시)
# ─────────────────────────────────────────────────────────
class CompetitionItem(BaseModel):
    """단일 검색 결과 항목 (1~75위 중 1건)."""
    rank: int                       # 검색 결과 내 순위 (1-base)
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str
    is_me: bool = False             # 호출자의 등록 place_id 와 같으면 True


class CompetitionResponse(BaseModel):
    """{등록동} {keyword} 검색 결과 1~75위 + 내 업체 마킹."""
    place_pk: int
    keyword: str
    query: str                      # 실제 네이버에 던진 쿼리
    my_place_id: str | None
    my_rank: int | None             # 1~75 사이면 그 값, 75위 밖이면 None
    out_of_range: bool              # True 면 내 업체가 75위 밖
    total_count: int
    items: list[CompetitionItem]
    error: str | None = None
