/**
 * 키워드 발굴 API — 네이버 1페이지 메인/타지역 자동 분류.
 *
 * 백엔드: /api/v1/keyword/discover, /api/v1/keyword/discover/batch
 */
import { api } from './client'

export type KeywordClassification =
  | 'third_party'
  | 'third_party_suspect'
  | 'main'
  | 'unknown'

export interface KeywordPlaceItem {
  rank: number
  place_id: string
  name: string
  phone: string | null
  category: string | null
  address: string | null
  road_address: string | null
  business_status: string | null
  naver_booking: boolean
  visitor_review_count: number | null
  blog_review_count: number | null
  distance: string | null
  x: string | null
  y: string | null
  classification: KeywordClassification
}

export interface KeywordSummary {
  total: number
  main_count: number
  third_party_count: number
  third_party_suspect_count: number
  unknown_count: number
  third_party_ratio: number
  is_third_party_keyword: boolean
}

export interface KeywordDiscoverResult {
  keyword: string
  source: 'html_apollo' | 'none'
  fetched_at?: string
  elapsed_ms?: number
  summary: KeywordSummary
  items: KeywordPlaceItem[]
  error: string | null
  from_cache: boolean
}

export interface KeywordBatchResponse {
  count: number
  results: KeywordDiscoverResult[]
}

export interface KeywordDiscoverRequest {
  keyword: string
  display?: number
  use_cache?: boolean
}

export interface KeywordBatchRequest {
  keywords: string[]
  display?: number
  pace_ms?: number
  use_cache?: boolean
}

// ── 지역(4,819 동/리) 트리 ─────────────────────────────────
export interface RegionsResponse {
  summary: {
    sido_count: number
    sigungu_count: number
    dong_count: number
  }
  // sido -> sigungu -> [dong/ri ...]
  // 세종특별자치시는 sigungu 키가 빈 문자열("")
  tree: Record<string, Record<string, string[]>>
}

// ── 지역+키워드 검색 (단건) ─────────────────────────────────
export type RegionMode = 'sigungu' | 'dong' | 'both'

export interface DiscoverByRegionRequest {
  sido: string
  sigungu?: string
  dong?: string
  mode: RegionMode
  keywords: string[]
  display?: number
  use_cache?: boolean
}

export interface RegionDiscoverItem {
  scope: 'region'
  mode: RegionMode
  sido?: string
  sigungu: string
  dong: string
  keyword: string
  query: string
  label: string
  source: 'html_apollo' | 'none'
  fetched_at?: string
  elapsed_ms?: number
  summary: KeywordSummary
  items: KeywordPlaceItem[]
  exposed: boolean
  message: string | null
  error: string | null
  from_cache: boolean
}

export interface DiscoverByRegionResponse {
  sido: string
  sigungu: string
  dong: string
  mode: RegionMode
  count: number
  // mode='both' 인 경우 sigungu_result+dong_result 동시 포함, 그 외엔 result
  results: Array<{
    keyword: string
    result?: RegionDiscoverItem
    sigungu_result?: RegionDiscoverItem
    dong_result?: RegionDiscoverItem
    error?: string
  }>
}

// ── 지역 일괄 검색 (job) ──────────────────────────────────
export interface DiscoverBulkRegionRequest {
  scope: 'nationwide' | 'sido'
  sido?: string
  keywords: string[]
  mode?: 'sigungu'
  display?: number
  pace_ms?: number
  concurrency?: number
  use_cache?: boolean
}

export interface BulkJobStartResponse {
  job_id: string
  status: 'running'
  total: number
  scope: 'nationwide' | 'sido'
  sido: string
  keywords: string[]
  mode: 'sigungu'
  estimated_seconds: number
}

export interface BulkJobStatus {
  job_id: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  total: number
  done: number
  progress: number
  created_at: string
  finished_at: string | null
  error: string | null
  summary: {
    pair_count: number
    exposed_pair_count: number
    total_items: number
    third_party_count: number
    third_party_suspect_count: number
    main_count: number
  }
  results?: RegionDiscoverItem[]
}

export const keywordApi = {
  discover: (req: KeywordDiscoverRequest) =>
    api.post<KeywordDiscoverResult>('/api/v1/keyword/discover', req),

  discoverBatch: (req: KeywordBatchRequest) =>
    api.post<KeywordBatchResponse>('/api/v1/keyword/discover/batch', req),

  // 지역
  regions: () => api.get<RegionsResponse>('/api/v1/keyword/regions'),

  discoverByRegion: (req: DiscoverByRegionRequest) =>
    api.post<DiscoverByRegionResponse>('/api/v1/keyword/discover-by-region', req),

  discoverBulkRegion: (req: DiscoverBulkRegionRequest) =>
    api.post<BulkJobStartResponse>('/api/v1/keyword/discover-bulk-region', req),

  jobStatus: (jobId: string, includeResults = true) =>
    api.get<BulkJobStatus>(
      `/api/v1/keyword/jobs/${encodeURIComponent(jobId)}?include_results=${includeResults}`
    ),
}
