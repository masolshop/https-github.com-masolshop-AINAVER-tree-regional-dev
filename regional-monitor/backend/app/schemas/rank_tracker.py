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
# 일괄 키워드 적용 (A안 — N건에 1회 클릭으로 동일 키워드 셋 적용)
# ─────────────────────────────────────────────────────────
class BulkKeywordsFilter(BaseModel):
    """일괄 적용 대상을 좁히는 필터. 모두 옵션 (미지정 시 전체 적용)."""
    only_no_keywords: bool = Field(
        default=False,
        description="True 면 추적 키워드가 없는 행만 대상.",
    )
    sido: str | None = Field(
        default=None,
        description="시도 정확 일치 (예: '전라남도'). full_address 의 첫 토큰으로 매칭.",
    )
    business_name_contains: str | None = Field(
        default=None,
        description="상호 부분 일치 (대소문자 무시 contains).",
    )


class BulkKeywordsRequest(BaseModel):
    """N건에 동일 키워드 셋을 한 번에 적용."""
    tracking_keywords: list[str] = Field(
        ...,
        description="적용할 추적 키워드 (1~5개). 빈 배열은 허용 안 함 (해제 의도는 단건 PATCH 사용).",
        min_length=1,
        max_length=5,
    )
    mode: str = Field(
        default="replace",
        description="'replace' = 기존 키워드 덮어쓰기, 'append' = 기존에 추가 (5개 한도 내).",
        pattern="^(replace|append)$",
    )
    filter: BulkKeywordsFilter = Field(
        default_factory=BulkKeywordsFilter,
        description="적용 대상 필터.",
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


class BulkKeywordsResponse(BaseModel):
    """일괄 적용 결과."""
    total_matched: int                  # 필터에 매칭된 행 수
    updated: int                        # 실제 키워드가 갱신된 행 수
    skipped_no_change: int              # 동일 키워드 세트라 건너뜀
    auto_matched: int                   # place_id 가 있어 즉시 AUTO_MATCHED 된 수
    pending_match: int                  # 매칭 대기 큐로 들어간 수
    sample_place_pks: list[int] = Field(
        default_factory=list,
        description="갱신된 행 중 최대 10개 샘플 (디버그/확인용).",
    )


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

    [2026-05-16] 응답 슬림화 — 히스토리가 없는 (place, keyword) placeholder
    셀은 cells 에서 제외하고, 대신 total_cells / missing_count 메타 필드로
    노출 정보를 명시한다. 프론트는 이 메타로 "미검증 N" 배지를 정확히 표시.
    Backward compat: 기존 클라이언트는 count/cells 만 보고도 동작 가능
    (단 "검증 완료 N/N" 표시는 미검증 셀 수만큼 부족하게 보일 수 있음).
    """
    # cells.length — 실제 히스토리가 있는 셀 수 (기존 의미와 동일)
    count: int
    # 사용자가 등록한 모든 (place × tracked_keyword) 조합 수 (placeholder 포함하던
    # 이전 버전의 count 값과 동일한 의미). UI 의 "전체 셀" 표시 분모.
    total_cells: int = 0
    # 한 번도 검증되지 않은 (place, keyword) 조합 수 = total_cells - count
    missing_count: int = 0
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

    # Phase 5 - Fix A: 네이버 회로차단 상태를 프론트가 직접 볼 수 있도록 노출.
    # OPEN 인 동안에는 "지금 검증" 을 눌러도 모든 셀이 단락되어 결과가 안 쌓이므로
    # 프론트는 노란 배너로 "네이버 일시 차단 — 약 2분 후 다시 시도해주세요" 안내한다.
    naver_circuit_open: bool = False

    # Phase 7 — 사용자별 "수동 검증 잡이 백그라운드에서 실행 중" 플래그.
    # /manual-rank-check 가 호출되면 set, 워커가 try/finally 로 종료 시 unset.
    # 프론트는 이 값을 신뢰해서 '지금 검증' 버튼을 비활성화하고 진행률 텍스트를 표시.
    #   · manual_running       : 실행 중 여부 (단일 권위 신호)
    #   · manual_started       : 이 잡에 투입된 플레이스/셀 개수 (시작 시점 스냅샷)
    #   · manual_started_at    : 시작 시각 ISO8601 (경과 시간 계산용)
    #   · manual_target_total  : (2026-05-16) 이번 잡이 검증하는 셀 총수 (분모).
    #                            rerun-out-of-range 같이 "셀 단위" 잡일 때 진행률을
    #                            "X / target_total" 로 정확히 표시하기 위함.
    #                            None 이면 프론트는 total_cells 를 분모로 사용.
    #   · manual_label         : "manual" / "rerun-out-of-range" 등 잡 유형 라벨.
    #                            프론트가 진행률 텍스트를 분기 (예: "재검증 N건") 하는 데 사용.
    manual_running: bool = False
    manual_started: int = 0
    manual_started_at: str | None = None
    manual_target_total: int | None = None
    manual_label: str | None = None


# ─────────────────────────────────────────────────────────
# 전체 초기화 (사용자 본인의 데이터 비우기)
# ─────────────────────────────────────────────────────────
class ResetAllResponse(BaseModel):
    """DELETE /reset-all 응답 — 순위 데이터 초기화 결과 요약.

    🚨 중요: registered_places 테이블은 /monitor 페이지와 공유되므로
    플레이스 자체는 절대 삭제하지 않는다. RankTracker 전용 컬럼
    (tracking_keywords / match_* / dong_changed / actual_dong) 만
    NULL/False 로 리셋하고, PlaceRankHistory 만 진짜 DELETE 한다.

    필드:
      · reset_places    : 추적 키워드/매칭 결과가 초기화된 플레이스 수 (UPDATE rowcount)
      · deleted_history : 삭제된 일별 순위 이력 행 수 (DELETE rowcount)
    """
    reset_places: int
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
# 사용자별 수동 검증 (특정 행 ID 지정)
# ─────────────────────────────────────────────────────────
class ManualRankCheckRequest(BaseModel):
    """사용자가 매트릭스에서 '지금 검증' 클릭 시 — 본인의 특정 place_pk 들만 즉시 순위 체크.

    place_ids 가 비어있으면 본인의 모든 AUTO_MATCHED + 키워드 보유 행이 대상.
    타지역 정책상 자동 트리거가 모두 비활성화되어, 사용자는 명시적으로 이 엔드포인트를 호출해야 함.
    """
    place_ids: list[int] = Field(
        default_factory=list,
        description="검증할 RegisteredPlace.id 배열. 비어있으면 본인 전체.",
    )


class ManualRankCheckResponse(BaseModel):
    """수동 검증 트리거 응답."""
    started: int                # 백그라운드 작업 큐에 들어간 행 수
    skipped: int                # 자격 미달로 스킵된 행 수 (매칭 안됨/키워드 없음)
    message: str | None = None


# ─────────────────────────────────────────────────────────
# "순위권 없음" 셀 재검증 트리거 (2026-05-16)
# ─────────────────────────────────────────────────────────
# 배경
#   현재 매트릭스에서 "순위권 없음 N" 으로 집계되는 셀들 중 상당수가
#   "TOP_N(20) 밖 진짜 순위권 외" 가 아니라 검증 당시의 일시 오류
#   (페이지 로딩 실패, 네이버 IP 차단으로 응답 0건 등) 로 인해
#   rank_checker._search_and_rank 가 out_of_range=True, total_results=NULL
#   로 저장한 케이스. 사용자 관찰상 타지역(서울 외)은 본인이 실제로
#   20위권 밖인 경우가 극소수이고, 대부분 재검증하면 진짜 순위가 잡힌다.
#
# 동작
#   - 최근 7일 내 out_of_range=True 인 PlaceRankHistory 를 본인 소유 한정으로 조회
#   - 해당 place_pk 집합을 자격 조건(AUTO_MATCHED/CONFIRMED + place_id + keyword 보유)으로 필터
#   - _run_rank_check_for_ids 로 디스패치 (manual-rank-check 와 동일 워커)
#
# 필터 정책
#   total_results IS NULL 만 재시도하는 게 더 안전해 보이지만, 사용자 관찰상
#   total_results 가 채워진 채로 out_of_range=True 인 셀들도 대부분 재검증하면
#   실제 순위가 잡힘. 따라서 out_of_range=True 전체를 대상으로 함.
# ─────────────────────────────────────────────────────────
class RerunOutOfRangeResponse(BaseModel):
    """순위권 없음 셀 재검증 트리거 응답."""
    started: int                # 백그라운드 큐에 들어간 place 수
    cells_to_recheck: int       # 대상이 된 (place, keyword) 셀 누계 (참고용)
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
