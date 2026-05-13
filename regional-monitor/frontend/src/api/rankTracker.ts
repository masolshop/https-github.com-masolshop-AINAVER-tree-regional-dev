/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5) API 클라이언트.
 *
 * 백엔드:
 *   POST /api/v1/rank-tracker/upload
 *   GET  /api/v1/rank-tracker/places
 *   POST /api/v1/rank-tracker/run-match
 *   POST /api/v1/rank-tracker/places/{pk}/confirm-candidate
 *   GET  /api/v1/rank-tracker/history/{pk}?days=30
 *   POST /api/v1/rank-tracker/run-rank-check  (admin)
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
  | 'CONFIRMED'
  | 'REVIEW_NEEDED'
  | 'NOT_FOUND'
  | 'PENDING_MATCH'
  | null

export interface RankPlaceCandidate {
  place_id: string
  name: string
  category: string
  phone: string
  virtual_phone: string
  address: string
  score: number
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
  match_confidence: number | null
  matched_at: string | null
  candidates: RankPlaceCandidate[]
}

export interface RankPlaceListOut {
  total: number
  auto_matched: number
  review_needed: number
  not_found: number
  pending: number
  confirmed: number
  items: RankPlaceOut[]
}

/* ─────────── 매칭 실행 ─────────── */
export interface RunMatchRequest {
  place_ids?: number[]
}

export interface RunMatchResponse {
  requested: number
  processed: number
  auto_matched: number
  review_needed: number
  not_found: number
  errors: number
}

/* ─────────── 후보 확정 ─────────── */
export interface ConfirmCandidateRequest {
  place_id: string
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

/* ─────────── 일일 배치 트리거 ─────────── */
export interface RunRankCheckResponse {
  started: number
  skipped_unmatched: number
  elapsed_sec: number | null
  message: string | null
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

export const runMatch = (req: RunMatchRequest = {}) =>
  api.post<RunMatchResponse>('/api/v1/rank-tracker/run-match', req)

export const confirmCandidate = (placePk: number, req: ConfirmCandidateRequest) =>
  api.post<{ status: string }>(
    `/api/v1/rank-tracker/places/${placePk}/confirm-candidate`,
    req,
  )

export const getRankHistory = (placePk: number, days = 30) =>
  api.get<RankHistoryResponse>(
    `/api/v1/rank-tracker/history/${placePk}?days=${days}`,
  )

export const triggerRankCheckNow = () =>
  api.post<RunRankCheckResponse>('/api/v1/rank-tracker/run-rank-check', {})
