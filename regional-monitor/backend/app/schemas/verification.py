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

    청크 진행 메타 (kind/chunk_index/total_chunks/total_targets):
      · 프론트가 100건씩 분할 호출할 때, 백엔드 `/verify/progress` 엔드포인트가
        "현재 몇 번째 청크가 진행 중인지" 를 다른 탭/새로고침 후에도 알 수 있도록
        클라이언트가 메타데이터를 함께 보낸다. 백엔드는 이 값을 메모리 dict 에
        저장만 하고 검증 로직 자체에는 영향을 주지 않는다.
    """
    place_ids: list[int] | None = None   # None = 사용자 등록 전체
    mode: str = "full"                   # "full" (전화+동 검증) / "fast" (페이지 존재 유무만)
    only_pending: bool = False           # True 시 current_verdict='PENDING' 인 등록만 검증
                                         # (재체크 버튼) — place_ids 와 동시 지정하면 교집합으로 동작
    # ── 청크 진행 메타 (Option B — backend progress sync) ───────────────────
    # 모두 옵션 — 누락되면 백엔드는 progress 만 partial 로 채운다 (구버전 호환).
    kind: str | None = None              # 'register' | 'recheck' (UI 라벨 용)
    chunk_index: int | None = None       # 0-based (1-based 가 아님; 백엔드는 +1 해서 노출)
    total_chunks: int | None = None
    total_targets: int | None = None     # 전체 대상 건수 (모든 청크 합계)


class LiveCheckResponse(BaseModel):
    """즉시 검증 응답."""
    total_ms: int
    avg_ms: int
    throughput: float          # req/s
    results: list[VerificationResult]
    summary: dict              # {ok, warning, danger}


# ──────────────────────────────────────────────────────────────────────────────
#  Verify Progress (Option B — backend-derived sync for LiveCheckTab)
# ──────────────────────────────────────────────────────────────────────────────
class VerifyProgress(BaseModel):
    """현재 사용자의 수동 검증(/verify/live) 진행 상태.

    프론트(`LiveCheckTab.tsx`)가 3초 간격으로 폴링하여 다음 UX 를 구현한다:
      · running=True 이면 등록 체크/재체크 버튼을 비활성화 (페이지 새로고침/다른 탭에서도 일관)
      · chunk_index/total_chunks 로 진행률 표시
      · done/total 로 누적 완료 건수 표시

    필드 의미:
      · running           — 사용자별 락이 점유되어 있거나, 마지막 청크 응답 후 30초 이내
      · kind              — 'register' / 'recheck' / None
      · chunk_index       — 현재 처리 중(또는 직전 처리된) 청크의 1-based 번호
      · total_chunks      — 프론트가 분할한 전체 청크 수 (클라이언트 제공)
      · done              — 현재까지 백엔드가 처리한 건수 (누적)
      · total             — 전체 대상 건수 (클라이언트 제공 — total_targets)
      · started_at        — 사용자가 첫 청크를 시작한 epoch ms
      · last_updated_at   — 가장 최근에 청크가 완료된 epoch ms (이걸 기준으로 stale 판정)
    """
    running: bool = False
    kind: str | None = None
    chunk_index: int | None = None
    total_chunks: int | None = None
    done: int = 0
    total: int = 0
    started_at: int | None = None        # epoch ms
    last_updated_at: int | None = None   # epoch ms
