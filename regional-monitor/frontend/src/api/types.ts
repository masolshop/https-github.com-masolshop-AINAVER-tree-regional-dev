/**
 * 백엔드 API 스키마와 1:1 매칭되는 TypeScript 타입
 * (FastAPI Pydantic 모델 기반 — snake_case 그대로 유지)
 *
 * UI 레이어에서 쓰는 camelCase 타입은 src/pages/Monitor/types.ts 참고.
 * 두 레이어 사이는 매퍼(`mapPlace`, `mapVerification`)로 변환한다.
 */

/* ─────────── Verdict (백엔드 enum) ─────────── */
export type ApiVerdict =
  | 'OK'
  | 'PHONE_MISMATCH'
  | 'DONG_MISMATCH'
  | 'NAME_MISMATCH'
  | 'REGION_MISMATCH'
  | 'DEAD'
  | 'PENDING'
  | 'CHECKING'

/* ─────────── /api/v1/extract/phone ─────────── */
export interface ExtractRequest {
  phone: string
}

export interface ExtractResponse {
  success: boolean
  phone: string
  place_id: string | null
  name: string | null
  address: string | null
  dong: string | null
  category: string | null
  response_ms: number
  error: string | null
}

/* ─────────── /api/v1/places ─────────── */
export interface PlaceCreate {
  phone: string
  place_id: string
  registered_dong: string
  business_name: string
}

export interface PlaceCreateAuto {
  phone: string
  registered_dong_override?: string | null
  business_name_override?: string | null
}

export interface PlaceUpdate {
  registered_dong?: string | null
  business_name?: string | null
}

export interface PlaceOut {
  id: number
  phone: string
  // 등록 직후(추출 전)에는 NULL 일 수 있음. 검증 시 자동 채워짐.
  place_id: string | null
  registered_dong: string | null
  business_name: string | null
  full_address: string | null
  category: string | null
  current_verdict: ApiVerdict
  last_checked_at: string | null
  created_at: string
  updated_at: string
  // 미포함 번호 추적 — 최근 업로드 엑셀에 포함됐는지
  in_latest_upload: boolean
  excluded_at: string | null
}

export interface PlaceSummary {
  total: number
  ok: number
  warning: number
  danger: number
  pending: number
  excluded: number   // 미포함 번호 (최근 업로드 엑셀에서 빠진 번호)
}

export interface PlaceListOut {
  summary: PlaceSummary
  items: PlaceOut[]
}

/* ─────────── 일괄 등록 (Excel/CSV) ─────────── */

export interface PlaceBulkRow {
  phone: string
  registered_dong_override?: string | null
  business_name_override?: string | null
}

export interface PlaceBulkRequest {
  rows: PlaceBulkRow[]                 // 1~1000건 (권장 500건 청크)
  is_first_chunk?: boolean             // 새 업로드 시작 — 미포함 마킹 트랜잭션 실행
  is_last_chunk?: boolean              // 업로드 종료 (정보용)
}

export type BulkRowStatusKey =
  | 'created'
  | 'duplicate'
  | 'invalid_phone'
  | 'extract_failed'
  | 'quota_exceeded'

export interface BulkRowStatus {
  phone: string
  status: BulkRowStatusKey
  place_id?: string | null
  business_name?: string | null
  error?: string | null
}

export interface PlaceBulkResponse {
  requested: number
  created: number
  duplicate: number
  invalid_phone: number
  extract_failed: number
  quota_exceeded: number
  elapsed_ms: number
  quota_remaining: number
  excluded_marked?: number      // 이번 업로드에서 미포함으로 표시된 번호 수
  excluded_restored?: number    // 다시 포함되어 미포함 해제된 번호 수
  rows: BulkRowStatus[]
}

/* ─────────── /api/v1/places/bulk-delete ─────────── */
export interface PlaceBulkDeleteRequest {
  ids?: number[] | null
  all?: boolean
}

export interface PlaceBulkDeleteResponse {
  requested: number
  deleted: number
  not_found: number
  elapsed_ms: number
}

export interface MessageResponse {
  message: string
}

/* ─────────── /api/v1/verify/live ─────────── */
export type VerifyMode = 'full' | 'fast'

export interface LiveCheckRequest {
  place_ids?: number[] | null
  /**
   * 'full' (기본) — 전화 + 동/로/리 풀 검증, ~40s/200건
   * 'fast'        — 페이지 존재 유무만, ~10s/200건 (트래픽 95% 절감)
   */
  mode?: VerifyMode
  /**
   * 2단계 "재체크" — true 시 current_verdict='PENDING' 인 등록만 검증.
   * 1단계 "등록 체크" 후 일시 차단(429/403)으로 보류된 항목을 풀어주는 용도.
   */
  only_pending?: boolean
}

export interface VerificationDetail {
  alive: boolean
  // fast 모드에서는 검증을 건너뛰므로 null
  phone_match: boolean | null
  dong_match: boolean | null
  name_match: boolean | null
  actual_phone: string | null
  actual_dong: string | null
  actual_name: string | null
  actual_address: string | null
}

export interface VerificationResult {
  place_id_ref: number
  phone: string
  // 등록 직후(미추출) 검증 시 NULL 가능
  place_id: string | null
  registered_dong: string | null
  business_name: string | null
  detail: VerificationDetail
  verdict: ApiVerdict
  response_ms: number
  http_status: number
  error: string | null
  checked_at: string
}

export interface LiveCheckResponse {
  total_ms: number
  avg_ms: number
  throughput: number
  results: VerificationResult[]
  summary: Record<string, number>
}

/* ─────────── /api/v1/verify/job (대용량 검증) ─────────── */
export type VerifyJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface VerifyJobCreateRequest {
  place_ids?: number[] | null
}

export interface VerifyJob {
  id: number
  user_id: number
  status: VerifyJobStatus
  cancel_requested: boolean
  total: number
  processed: number
  ok_count: number
  warning_count: number
  danger_count: number
  chunk_size: number
  chunks_total: number
  chunks_done: number
  started_at: string | null
  finished_at: string | null
  created_at: string
  error: string | null
  progress_pct: number
  eta_seconds: number | null
  elapsed_seconds: number | null
  mismatch_count: number
}

export interface VerifyJobCancelResponse {
  id: number
  status: string
  cancel_requested: boolean
  message: string
}

/* ─────────── /api/v1/auth/* ─────────── */
export interface User {
  id: number
  email: string
  username?: string | null         // 직접가입 사용자만 보유
  name: string
  picture: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  plan: string
  quota_places: number
  is_profile_complete: boolean
  agreed_marketing: boolean
  verify_slot: number              // 0~23 (KST 기준 자동 검증 시각)
  is_superadmin?: boolean
  is_active?: boolean
  created_at: string
}

export interface GoogleLoginRequest {
  id_token: string
}

export interface PasswordLoginRequest {
  email: string
  password: string
}

export interface PasswordLoginResponse {
  access_token: string
  token_type: string
  user: User
}

export interface GoogleLoginResponse {
  access_token: string
  token_type: string
  user: User
  needs_profile: boolean
}

/** PATCH /api/v1/auth/me/verify-slot — 자동 검증 시각 변경 */
export interface VerifySlotUpdateRequest {
  verify_slot: number              // 0~23 (KST)
}

export interface VerifySlotUpdateResponse {
  user: User
  next_run_at: string              // ISO datetime (KST, +09:00)
}

/** PATCH /api/v1/auth/me — 본인 프로필 수정 (이름/이메일/회사명/직함) */
export interface MyProfileUpdateRequest {
  name?: string
  email?: string
  company?: string | null
  job_title?: string | null
}

export interface MyProfileUpdateResponse {
  user: User
}

export interface Agreements {
  privacy: boolean
  terms: boolean
  marketing: boolean
}

export interface ProfileCompleteRequest {
  name: string
  phone: string
  company: string
  job_title?: string | null
  agreements: Agreements
}

export interface MeResponse {
  user: User
}

/* ─────────── 직접 회원가입 (아이디/비밀번호) ─────────── */

export interface SignupRequest {
  username: string
  password: string
  email: string
  name: string
  phone: string
  company: string
  job_title?: string | null
  agreements: Agreements
}

export interface SignupResponse {
  access_token: string
  token_type: string
  user: User
}

/* ─────────── 가입 전 중복 확인 (휴대폰/이메일) ─────────── */

export type CheckDuplicateField = 'phone' | 'email'

export interface CheckDuplicateRequest {
  field: CheckDuplicateField
  value: string
}

export interface CheckDuplicateResponse {
  field: CheckDuplicateField
  value_normalized: string
  available: boolean
  valid_format: boolean
  message: string
}

/* ─────────── 아이디/비밀번호 찾기 ─────────── */

export interface ForgotIdRequest {
  email: string
}

export interface ForgotPasswordRequest {
  username?: string | null
  email?: string | null
}

export interface ResetPasswordRequest {
  token: string
  new_password: string
}

export interface ResetPasswordVerifyResponse {
  valid: boolean
  email_masked?: string | null
}

/* ─────────── /api/v1/events ─────────── */

/** 변경 이벤트 종류 — 백엔드 services/persist.py classify_event() 와 동기화 */
export type ChangeEventType =
  | 'PAGE_DELETED'    // 페이지 삭제 (DEAD)
  | 'EXPOSURE_LOST'   // OK → 비-OK
  | 'REGION_CHANGED'  // 시/도 단위 변경
  | 'DONG_CHANGED'    // 동 변경
  | 'NAME_CHANGED'    // 상호 변경
  | 'RECOVERED'       // 비-OK → OK
  | 'OTHER_CHANGED'

export type ChangeEventSeverity = 'danger' | 'warning' | 'info'

export interface ChangeEventOut {
  id: number
  place_id_ref: number
  phone: string
  business_name: string
  event_type: ChangeEventType
  severity: ChangeEventSeverity
  prev_verdict: string
  new_verdict: string
  summary: string
  detected_at: string             // ISO datetime (UTC)
}

export interface EventListOut {
  items: ChangeEventOut[]
  total: number
}

export interface UnreadCountOut {
  unread: number
  last_read_at: string | null
}

export interface SchedulerStatusOut {
  next_run_at: string | null      // ISO datetime (KST, +09:00)
  verify_slot: number             // 0~23 (KST)
  verify_slot_label: string       // "매일 03:00 (KST)"
  timezone: string                // "Asia/Seoul (KST, UTC+9)"
}

/* ─────────────── /verification-runs ─────────────── */

export interface VerificationRunOut {
  id: number
  trigger: 'scheduler' | 'manual'   // 자동 / 수동
  mode: 'fast' | 'full'
  slot_hour: number                 // 0~23 (자동), -1 (수동)
  total_count: number
  ok_count: number
  dead_count: number
  pending_count: number
  events_count: number              // ChangeEvent 발생 건수
  elapsed_ms: number
  started_at: string                // ISO (KST)
}

export interface VerificationRunListOut {
  items: VerificationRunOut[]
  total: number
}

/* ─────────────── /settings ─────────────── */

export type ChannelKey = 'email_alerts' | 'sheet_sync' | 'kakao_number' | 'slack_webhook'
export type PlanKey = 'free' | 'basic' | 'pro' | 'enterprise'

export interface SettingsOut {
  email_alerts: boolean
  email_address: string
  notify_emails: string[]              // 추가 수신자 (영업관리자/고객 담당자)
  kakao_number: string | null
  slack_webhook: string | null
  sheet_url: string | null
  sheet_sync_enabled: boolean
  verify_slot: number
  verify_slot_label: string
  plan: PlanKey
  available_channels: ChannelKey[]
}

export interface SettingsPatch {
  email_alerts?: boolean
  notify_emails?: string[]
  kakao_number?: string | null
  slack_webhook?: string | null
  sheet_url?: string | null
  sheet_sync_enabled?: boolean
}

