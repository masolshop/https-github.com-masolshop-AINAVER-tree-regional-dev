/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5) API 클라이언트.
 *
 * 정책 (070+동 단일 매칭):
 *  · AUTO_MATCHED   — 070 매칭 완료 (자동 확정). dong_changed=true 이면 등록동≠실제 노출동
 *  · NEEDS_MANUAL   — 070 검색 결과 0건 등 예외 (이론상 거의 없음)
 *  · PENDING_MATCH  — 매칭 대기
 *
 * 백엔드:
 *   POST /api/v1/rank-tracker/upload
 *   GET  /api/v1/rank-tracker/places
 *   GET  /api/v1/rank-tracker/dong-changed       (변경 노출 배너용)
 *   POST /api/v1/rank-tracker/run-match
 *   GET  /api/v1/rank-tracker/history/{pk}?days=30
 *   POST /api/v1/rank-tracker/run-rank-check     (admin)
 *   POST /api/v1/rank-tracker/places/{pk}/confirm-candidate  [DEPRECATED → 410]
 */
import { api } from './client'

/* ─────────── 업로드 ─────────── */
export interface RankUploadRow {
  phone: string
  registered_dong: string
  business_name: string
  tracking_keywords: string[] | string
}

export interface RankUploadRowResult {
  row_index: number
  phone: string
  status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR'
  place_pk?: number | null
  message?: string | null
}

export interface RankUploadResponse {
  total: number
  created: number
  updated: number
  skipped: number
  errors: number
  rows: RankUploadRowResult[]
}

/* ─────────── 매칭 목록 ─────────── */
export type MatchStatus =
  | 'AUTO_MATCHED'
  | 'NEEDS_MANUAL'
  | 'PENDING_MATCH'
  | null

export interface RankPlaceCandidate {
  place_id: string
  name: string
  category: string
  phone: string
  virtual_phone: string
  address: string
  reasons: string[]
}

export interface RankPlaceOut {
  id: number
  phone: string
  registered_dong: string | null
  business_name: string | null
  place_id: string | null
  tracking_keywords: string[]
  match_status: MatchStatus
  matched_at: string | null
  /** 매칭된 단일 플레이스 (070 일치 1건). 070+동 정책에선 후보 목록이 아니라 단일 매칭. */
  matched: RankPlaceCandidate | null
  /** 변경 노출 플래그 — true 이면 등록동과 실제 노출동이 다름 */
  dong_changed: boolean
  actual_dong: string | null
  /** 2단계 UX: 추적 키워드 등록 여부 (false 면 "키워드 추가" 인라인 UI 노출) */
  has_keywords: boolean
}

export interface RankPlaceListOut {
  total: number
  auto_matched: number
  needs_manual: number
  pending: number
  /** 변경 노출 건수 — 대시보드 배너 표시 트리거 */
  dong_changed_count: number
  /** monitor 에 등록되었지만 아직 추적 키워드를 등록하지 않은 업체 수 */
  no_keywords_count: number
  items: RankPlaceOut[]
}

/* ─────────── 추적 키워드 인라인 편집 (2단계 UX) ─────────── */
export interface UpdateKeywordsRequest {
  tracking_keywords: string[]
}

export interface UpdateKeywordsResponse {
  place_pk: number
  tracking_keywords: string[]
  match_status: MatchStatus
  auto_matched: boolean
  rank_check_enqueued: boolean
}

export const updateKeywords = (
  placePk: number,
  keywords: string[],
) =>
  api.patch<UpdateKeywordsResponse>(
    `/api/v1/rank-tracker/places/${placePk}/keywords`,
    { tracking_keywords: keywords },
    { timeoutMs: 30_000 },
  )

/* ─────────── 일괄 키워드 적용 (A안 — 한 번에 N건 동일 키워드 셋 적용) ─────────── */
export interface BulkKeywordsFilter {
  /** True 면 키워드 미등록 행만 대상 (안전한 디폴트) */
  only_no_keywords?: boolean
  /** 시도 정확 일치 (예: '전라남도') */
  sido?: string | null
  /** 상호 부분 일치 (대소문자 무시) */
  business_name_contains?: string | null
}

export interface BulkKeywordsRequest {
  /** 적용할 키워드 (1~5개). 빈 배열 금지. */
  tracking_keywords: string[]
  /** 'replace' = 덮어쓰기, 'append' = 기존에 추가 */
  mode?: 'replace' | 'append'
  filter?: BulkKeywordsFilter
}

export interface BulkKeywordsResponse {
  total_matched: number
  updated: number
  skipped_no_change: number
  auto_matched: number
  pending_match: number
  sample_place_pks: number[]
}

export const bulkApplyKeywords = (req: BulkKeywordsRequest) =>
  api.post<BulkKeywordsResponse>(
    '/api/v1/rank-tracker/places/bulk-keywords',
    {
      tracking_keywords: req.tracking_keywords,
      mode: req.mode ?? 'replace',
      filter: req.filter ?? {},
    },
    { timeoutMs: 60_000 },
  )

/* ─────────── 매칭 실행 ─────────── */
export interface RunMatchRequest {
  place_ids?: number[]
}

export interface RunMatchResponse {
  requested: number
  processed: number
  auto_matched: number
  needs_manual: number
  errors: number
}

/* ─────────── 변경 노출 배너 ─────────── */
export interface DongChangedItem {
  id: number
  phone: string
  business_name: string | null
  registered_dong: string | null
  actual_dong: string | null
  place_id: string | null
  address: string | null
}

export interface DongChangedListOut {
  count: number
  items: DongChangedItem[]
}

/* ─────────── 매트릭스 벌크 (등록동 × 키워드 한 방 조회) ─────────── */
export interface LatestRankCell {
  place_pk: number
  keyword: string
  rank: number | null
  out_of_range: boolean
  check_date: string | null
}

export interface LatestRanksResponse {
  /** cells.length — 검증 히스토리가 있는 셀 수만 */
  count: number
  /** [2026-05-16+] 사용자가 등록한 모든 (place × tracked_keyword) 조합 수.
   *  미검증 셀까지 포함하는 진짜 전체 개수. UI 의 "전체 셀" 분모. */
  total_cells?: number
  /** [2026-05-16+] 한 번도 검증되지 않은 (place, keyword) 조합 수 = total_cells - count */
  missing_count?: number
  cells: LatestRankCell[]
}

/* ─────────── 순위 이력 ─────────── */
export interface RankHistoryPoint {
  check_date: string
  rank: number | null
  out_of_range: boolean
  rank_delta: number | null
  total_results: number | null
}

export interface RankHistorySeries {
  keyword: string
  points: RankHistoryPoint[]
}

export interface RankHistoryResponse {
  place_pk: number
  business_name: string | null
  registered_dong: string | null
  series: RankHistorySeries[]
}

/* ─────────── 일일 배치 트리거 (관리자) ─────────── */
export interface RunRankCheckResponse {
  started: number
  skipped_unmatched: number
  elapsed_sec: number | null
  message: string | null
}

/* ─────────── 사용자 수동 검증 (타지역 정책 — 자동 트리거 비활성) ─────────── */
export interface ManualRankCheckRequest {
  /** 비어있으면 본인의 모든 자격 행 검증 */
  place_ids?: number[]
}

export interface ManualRankCheckResponse {
  started: number
  skipped: number
  message: string | null
}

/* ─────────── 순위권 없음 셀 재검증 (2026-05-16) ───────────
 * 매트릭스 "순위권 없음 N" 으로 집계된 셀들 중 상당수가 실제 20위권 밖이 아니라
 * 검증 당시의 일시 오류 (네이버 IP 차단, 페이지 로딩 실패 등) 로 인해
 * out_of_range=True 로 저장된 케이스. 이 버튼은 그 셀들의 place 를 재검증한다.
 */
export interface RerunOutOfRangeResponse {
  started: number          // 재검증 큐에 들어간 셀 수 (= cells_to_recheck)
  cells_to_recheck: number // 자동 재검증 대상 (매칭 오류 의심 셀 제외)
  message: string | null
  // [2026-05-17 v4] 종료 토스트에서 "85건의 진짜 정체" 를 분해 표시
  unverified_count?: number   // 매칭 오류(DONG/PHONE_MISMATCH/DEAD) — 재매칭 필요
  null_total_count?: number   // total_results=NULL (네이버 호출 실패 의심)
  real_oor_count?: number     // total_results>0 (진짜 20위 밖일 가능성)
}

/* ─────────── 진행 상태 (업로드 후 폴링용) ─────────── */
export interface RankCheckProgress {
  total_places: number
  pending_match: number
  auto_matched: number
  needs_manual: number
  total_cells: number
  filled_cells: number
  in_progress: boolean
  /** Phase 5 - Fix A: 네이버 회로차단 상태.
   *  true 일 때 "지금 검증" 을 눌러도 모든 셀이 단락되어 결과가 안 쌓이므로
   *  프론트는 노란 배너로 "약 2분 후 다시 시도" 를 안내한다. */
  naver_circuit_open?: boolean
  /** Phase 7 — 사용자별 "수동 검증 실행 중" 플래그.
   *  /manual-rank-check 호출 시 set, 워커 종료 시 unset.
   *  프론트는 이 값을 단일 권위 신호로 사용하여 '지금 검증' 버튼을 비활성화한다. */
  manual_running?: boolean
  /** 이번 잡에 투입된 플레이스 개수 (시작 시점 스냅샷). */
  manual_started?: number
  /** 잡 시작 시각 ISO8601 (경과 시간/추정 잔여 시간 계산용). */
  manual_started_at?: string | null
  /** (2026-05-16) 이번 잡이 검증하는 셀 총수.
   *  rerun-out-of-range 같은 셀 단위 잡은 정확한 값(예: 105) 이 들어옴.
   *  manual-rank-check (place 단위) 는 null 이며, 프론트는 total_cells 를 분모로 사용. */
  manual_target_total?: number | null
  /** (2026-05-16) 잡 유형 라벨. 'manual' / 'rerun-out-of-range' 등.
   *  프론트가 진행 배너 텍스트를 분기 ("재검증 중 …") 하는 데 사용. */
  manual_label?: string | null
  /** (2026-05-17) 사용자가 POST /cancel 로 중지 요청한 상태.
   *  true 이면 프론트는 청크 루프를 즉시 중단하고 "중지됨" 토스트를 띄운다.
   *  잡이 완전히 종료되면 백엔드가 cancel flag 를 clear 하므로 false 로 돌아온다. */
  cancel_requested?: boolean
}

/* ─────────── API 함수 ─────────── */
export const uploadRankRows = (rows: RankUploadRow[]) =>
  api.post<RankUploadResponse>(
    '/api/v1/rank-tracker/upload',
    { rows },
    { timeoutMs: 60_000 },
  )

export const listRankPlaces = () =>
  api.get<RankPlaceListOut>('/api/v1/rank-tracker/places')

export const listDongChanged = () =>
  api.get<DongChangedListOut>('/api/v1/rank-tracker/dong-changed')

export const listLatestRanks = () =>
  api.get<LatestRanksResponse>('/api/v1/rank-tracker/latest-ranks')

export const runMatch = (req: RunMatchRequest = {}) =>
  api.post<RunMatchResponse>('/api/v1/rank-tracker/run-match', req)

export const getRankHistory = (placePk: number, days = 30) =>
  api.get<RankHistoryResponse>(
    `/api/v1/rank-tracker/history/${placePk}?days=${days}`,
  )

export const triggerRankCheckNow = () =>
  api.post<RunRankCheckResponse>('/api/v1/rank-tracker/run-rank-check', {})

/** 사용자 수동 검증 — 타지역 정책상 자동 트리거가 없으므로 사용자가 명시적으로 호출.
 *  placeIds 비어있으면 본인의 모든 자격 행 검증.
 */
export const triggerManualRankCheck = (placeIds: number[] = []) =>
  api.post<ManualRankCheckResponse>(
    '/api/v1/rank-tracker/manual-rank-check',
    { place_ids: placeIds },
    { timeoutMs: 30_000 },
  )

/** 순위권 없음 셀 재검증 — 최근 7일 내 out_of_range=True 인 본인 셀 전체. */
export const triggerRerunOutOfRange = () =>
  api.post<RerunOutOfRangeResponse>(
    '/api/v1/rank-tracker/rerun-out-of-range',
    {},
    { timeoutMs: 30_000 },
  )

export const getRankProgress = () =>
  api.get<RankCheckProgress>('/api/v1/rank-tracker/progress')

/** (2026-05-17) 진행 중인 순위 검증 잡 중지 요청.
 *  서버는 cancel 플래그만 set 하고 즉시 200 을 반환한다 (멱등). 워커는 다음 셀부터
 *  빠르게 종료된다. 이미 시작된 셀의 네이버 호출은 그대로 완료됨에 유의. */
export const cancelRankCheck = () =>
  api.post<{ ok: boolean; was_running: boolean }>(
    '/api/v1/rank-tracker/cancel',
    {},
    { timeoutMs: 10_000 },
  )

/* ─────────── 순위 데이터 초기화 (등록 플레이스는 보존) ───────────
 * 🚨 registered_places 테이블은 /monitor 페이지와 공유되므로
 * 플레이스 자체는 삭제하지 않고, RankTracker 전용 컬럼만 NULL/False 로 리셋.
 *   - reset_places    : 추적 키워드/매칭 결과가 초기화된 플레이스 수 (UPDATE rowcount)
 *   - deleted_history : 삭제된 일별 순위 이력 행 수 (DELETE rowcount)
 */
export interface ResetAllResponse {
  reset_places: number
  deleted_history: number
  message: string
}

export const resetAllRankData = () =>
  api.del<ResetAllResponse>('/api/v1/rank-tracker/reset-all', { timeoutMs: 60_000 })

/* ─────────── 수동 place_id 확정 (NEEDS_MANUAL 해결) ─────────── */
export interface ConfirmPlaceIdRequest {
  place_id: string
  force?: boolean
}

export interface ConfirmPlaceIdResponse {
  place_pk: number
  place_id: string
  status: string
  actual_name: string | null
  actual_phone: string | null
  actual_address: string | null
  phone_match: boolean
  forced: boolean
  message: string | null
}

export const confirmPlaceId = (
  placePk: number,
  req: ConfirmPlaceIdRequest,
) =>
  api.post<ConfirmPlaceIdResponse>(
    `/api/v1/rank-tracker/places/${placePk}/confirm-place-id`,
    req,
    { timeoutMs: 30_000 },
  )

/* ─────────── 경쟁업체 스냅샷 (모달에서 키워드 클릭 시) ─────────── */
export interface CompetitionItem {
  rank: number
  place_id: string
  name: string
  category: string
  phone: string
  virtual_phone: string
  address: string
  is_me: boolean
}

export interface CompetitionResponse {
  place_pk: number
  keyword: string
  query: string
  my_place_id: string | null
  my_rank: number | null
  out_of_range: boolean
  total_count: number
  items: CompetitionItem[]
  error: string | null
}

export const getCompetition = (placePk: number, keyword: string) =>
  api.get<CompetitionResponse>(
    `/api/v1/rank-tracker/competition/${placePk}?keyword=${encodeURIComponent(keyword)}`,
    { timeoutMs: 30_000 },
  )
