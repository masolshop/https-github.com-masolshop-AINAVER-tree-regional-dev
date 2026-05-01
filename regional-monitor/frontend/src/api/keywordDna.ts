/**
 * 타지역키워드 DNA 파싱 솔루션 API 클라이언트.
 *
 * 백엔드:
 *   GET  /api/v1/keyword-dna/health
 *   GET  /api/v1/keyword-dna/dictionary/stats
 *   GET  /api/v1/keyword-dna/recommended
 *   POST /api/v1/keyword-dna/analyze
 *   POST /api/v1/keyword-dna/analyze/batch
 */
import { api } from './client'

export type DnaCategory = 'main' | 'action' | 'material' | 'place' | 'brand' | 'tag'

export interface DnaToken {
  token: string
  df: number
  weight: number
  share: number
}

export interface DnaGoldenCombo {
  combo: string
  main: string
  modifier: string
  modifier_category: DnaCategory
  weight: number
}

export interface DnaExample {
  name: string
  weight: number
  tokens: string[]
}

export interface DnaStats {
  matched: number
  total: number
  weight_matched: number
  total_weight: number
  elapsed_ms: number
}

export interface DnaResult {
  keyword: string
  normalized: string
  stats: DnaStats
  dna: Record<DnaCategory, DnaToken[]>
  golden: DnaGoldenCombo[]
  examples: DnaExample[]
  error?: string
}

export interface RecommendedItem {
  token: string
  category: DnaCategory
  df: number
  weight: number
}

export interface DictionaryStats {
  categories: DnaCategory[]
  stats: {
    business_count: number
    category_count: number
    total_weight: number
    token_count: number
    by_category: Record<DnaCategory, number>
  }
}

export const KeywordDnaApi = {
  health: () =>
    api.get<{ status: string; service: string; dictionary: any }>(
      '/api/v1/keyword-dna/health',
    ),
  dictionaryStats: () =>
    api.get<DictionaryStats>('/api/v1/keyword-dna/dictionary/stats'),
  recommended: (top = 50) =>
    api.get<{ count: number; items: RecommendedItem[] }>(
      `/api/v1/keyword-dna/recommended?top=${top}`,
    ),
  analyze: (
    keyword: string,
    opts: { top_per_category?: number; min_df?: number; examples?: number } = {},
  ) =>
    api.post<DnaResult>('/api/v1/keyword-dna/analyze', {
      keyword,
      top_per_category: opts.top_per_category ?? 15,
      min_df: opts.min_df ?? 2,
      examples: opts.examples ?? 30,
    }),
  analyzeBatch: (
    keywords: string[],
    opts: { top_per_category?: number; min_df?: number; examples?: number } = {},
  ) =>
    api.post<{ count: number; results: DnaResult[] }>(
      '/api/v1/keyword-dna/analyze/batch',
      {
        keywords,
        top_per_category: opts.top_per_category ?? 10,
        min_df: opts.min_df ?? 2,
        examples: opts.examples ?? 15,
      },
    ),
}
