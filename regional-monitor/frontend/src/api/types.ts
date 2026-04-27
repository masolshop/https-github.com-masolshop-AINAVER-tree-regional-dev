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
