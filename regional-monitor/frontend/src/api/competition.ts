/**
 * 지역별 경쟁도 분석 API 클라이언트.
 * 네이버 지도 섹션(m.map.naver.com) 기반.
 */
import { api } from './client'

export type CompetitionGrade = 'none' | 'clean' | 'compete' | 'heated' | 'saturated'

export interface CompetitionPlace {
  place_id: string
  name: string
  category: string
  phone: string
  virtual_phone: string
  address: string
  road_address: string
  latitude: number | null
  longitude: number | null
  is_other_region: boolean
  sido: string
  sigungu: string
  dong: string
}

export interface CompetitionRow {
  key: string
  sido: string
  sigungu: string
  dong: string
  total: number
  other: number
  main: number
  grade: CompetitionGrade
  grade_label: string
  items: CompetitionPlace[]
}

export interface CompetitionTotals {
  dong_count: number
  other_count: number
  main_count: number
  place_count: number
}

export interface CompetitionDist {
  none: number
  clean: number
  compete: number
  heated: number
  saturated: number
}

export interface CompetitionScanError {
  query: string
  error: string
}

export interface FastScanRequest {
  keyword: string
  scope: 'nationwide' | 'sido' | 'sigungu'
  sido?: string
  sigungu?: string
  pace_ms?: number
  concurrency?: number
}

export interface FastScanResponse {
  scope: 'nationwide' | 'sido' | 'sigungu'
  sido: string
  sigungu: string
  keyword: string
  query_count: number
  queries: string[]
  elapsed_ms: number
  naver_total_max: number
  raw_item_count: number
  errors: CompetitionScanError[]
  rows: CompetitionRow[]
  dist: CompetitionDist
  dist_label: Record<string, string>
  totals: CompetitionTotals
}

export interface PreciseScanRequest {
  keyword: string
  scope: 'sigungu' | 'sido'
  sido: string
  sigungu?: string
  pace_ms?: number
  concurrency?: number
}

export interface PreciseStartResponse {
  job_id: string
  status: 'running'
  total: number
  keyword: string
  scope: 'sigungu' | 'sido'
  sido: string
  sigungu: string
  estimated_seconds: number
}

export interface PreciseJobStatus {
  job_id: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  total: number
  done: number
  progress: number
  created_at: string
  finished_at: string | null
  error: string | null
  keyword: string
  scope: 'sigungu' | 'sido'
  sido: string
  sigungu: string
  raw_item_count: number
  errors: CompetitionScanError[]
  rows: CompetitionRow[]
  dist: CompetitionDist
  dist_label: Record<string, string>
  totals: CompetitionTotals
}

export const competitionApi = {
  health: () => api.get<{ status: string; regions: { sido_count: number; sigungu_count: number; dong_count: number } }>(
    '/api/v1/competition/health',
  ),
  scanFast: (req: FastScanRequest) =>
    api.post<FastScanResponse>('/api/v1/competition/scan-fast', req),
  scanPrecise: (req: PreciseScanRequest) =>
    api.post<PreciseStartResponse>('/api/v1/competition/scan-precise', req),
  jobStatus: (jobId: string, includeResults = true) =>
    api.get<PreciseJobStatus>(
      `/api/v1/competition/jobs/${encodeURIComponent(jobId)}?include_results=${includeResults}`,
    ),
}
