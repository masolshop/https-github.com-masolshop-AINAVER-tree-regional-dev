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
  place_id: string
  registered_dong: string
  business_name: string
  full_address: string | null
  category: string | null
  current_verdict: ApiVerdict
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface PlaceSummary {
  total: number
  ok: number
  warning: number
  danger: number
  pending: number
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
  rows: PlaceBulkRow[]                 // 1~100건
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
  rows: BulkRowStatus[]
}

export interface MessageResponse {
  message: string
}

/* ─────────── /api/v1/verify/live ─────────── */
export interface LiveCheckRequest {
  place_ids?: number[] | null
}

export interface VerificationDetail {
  alive: boolean
  phone_match: boolean
  dong_match: boolean
  name_match: boolean
  actual_phone: string | null
  actual_dong: string | null
  actual_name: string | null
  actual_address: string | null
}

export interface VerificationResult {
  place_id_ref: number
  phone: string
  place_id: string
  registered_dong: string
  business_name: string
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

/* ─────────── /api/v1/auth/* ─────────── */
export interface User {
  id: number
  email: string
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
  created_at: string
}

export interface GoogleLoginRequest {
  id_token: string
}

export interface GoogleLoginResponse {
  access_token: string
  token_type: string
  user: User
  needs_profile: boolean
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

/* ─────────────── /settings ─────────────── */

export type ChannelKey = 'email_alerts' | 'sheet_sync' | 'kakao_number' | 'slack_webhook'
export type PlanKey = 'free' | 'basic' | 'pro' | 'enterprise'

export interface SettingsOut {
  email_alerts: boolean
  email_address: string
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
  kakao_number?: string | null
  slack_webhook?: string | null
  sheet_url?: string | null
  sheet_sync_enabled?: boolean
}
