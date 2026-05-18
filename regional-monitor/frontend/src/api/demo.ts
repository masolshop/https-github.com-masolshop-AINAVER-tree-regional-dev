/**
 * 외부 공개 데모 전용 API 클라이언트.
 *
 * 백엔드 /api/v1/demo/* — 미리 캡처된 실제 네이버 응답을 그대로 반환.
 * 응답 스키마는 실제 API 와 100% 동일 (단, captured_at 필드만 추가).
 */
import { api } from './client'
import type { DnaResult, GraphResult, RecommendResult } from './keywordDna'
import type { DiscoverByRegionResponse } from './keyword'
import type { PreciseJobStatus } from './competition'

export interface DemoInfo {
  keyword: string
  sido: string
  sigungu: string
  dong: string
  endpoints: {
    keyword_dna: string
    keyword_discover: string
    competition: string
  }
  note: string
}

export interface DemoKeywordDnaResponse {
  captured_at: string
  keyword: string
  analyze: DnaResult
  graph: GraphResult
  recommend: RecommendResult
}

export interface DemoKeywordDiscoverResponse extends DiscoverByRegionResponse {
  captured_at: string
}

export interface DemoCompetitionResponse extends PreciseJobStatus {
  captured_at: string
}

export const demoApi = {
  info: () => api.get<DemoInfo>('/api/v1/demo/info'),
  keywordDna: () => api.get<DemoKeywordDnaResponse>('/api/v1/demo/keyword-dna'),
  keywordDiscover: () =>
    api.get<DemoKeywordDiscoverResponse>('/api/v1/demo/keyword-discover'),
  competition: () => api.get<DemoCompetitionResponse>('/api/v1/demo/competition'),
}
