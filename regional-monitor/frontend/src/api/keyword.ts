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

export const keywordApi = {
  discover: (req: KeywordDiscoverRequest) =>
    api.post<KeywordDiscoverResult>('/api/v1/keyword/discover', req),

  discoverBatch: (req: KeywordBatchRequest) =>
    api.post<KeywordBatchResponse>('/api/v1/keyword/discover/batch', req),
}
