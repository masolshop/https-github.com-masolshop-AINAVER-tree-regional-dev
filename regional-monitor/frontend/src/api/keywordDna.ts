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

// ─── 비교 매트릭스 ───
export interface CompareRow {
  token: string
  category: DnaCategory
  kw_count: number
  total_weight: number
  weights: Record<string, number>
  dfs: Record<string, number>
  is_shared: boolean
  is_unique: boolean
}

export interface CompareSimilarity {
  kw1: string
  kw2: string
  jaccard: number
  cosine: number
  shared: string[]
  shared_count: number
}

export interface CompareSummary {
  keyword: string
  matched: number
  weight_matched: number
  share: number
  elapsed_ms: number
}

export interface CompareResult {
  keywords: string[]
  summary: CompareSummary[]
  matrix: CompareRow[]
  matrix_total: number
  similarity: CompareSimilarity[]
  shared_count: number
  unique_count: number
  error?: string
}

// ─── 네트워크 그래프 ───
export interface GraphNode {
  id: string
  category: DnaCategory
  weight: number
  df: number
  size: number
  is_center: boolean
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  df: number
}

export interface GraphResult {
  keyword: string
  normalized: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { matched: number; node_count: number; edge_count: number; elapsed_ms: number }
  error?: string
}

// ─── 추천 ───
export type OppStatus = 'uncovered' | 'low_competition' | 'moderate' | 'saturated'

export interface OppCandidate {
  combo: string
  modifier: string
  modifier_category: DnaCategory
  market_weight: number
  market_df: number
  competition_weight: number
  competition_count: number
  opportunity: number
  status: OppStatus
  status_label: string
}

export interface RecommendResult {
  seed: string
  normalized: string
  candidates: OppCandidate[]
  stats: { seed_matched: number; candidate_count: number; elapsed_ms: number }
  error?: string
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
  compare: (
    keywords: string[],
    opts: { top_per_category?: number; min_df?: number } = {},
  ) =>
    api.post<CompareResult>('/api/v1/keyword-dna/compare', {
      keywords,
      top_per_category: opts.top_per_category ?? 12,
      min_df: opts.min_df ?? 2,
    }),
  graph: (
    keyword: string,
    opts: { max_nodes?: number; min_edge_weight?: number } = {},
  ) =>
    api.post<GraphResult>('/api/v1/keyword-dna/graph', {
      keyword,
      max_nodes: opts.max_nodes ?? 40,
      min_edge_weight: opts.min_edge_weight ?? 1.0,
    }),
  recommend: (
    seed: string,
    opts: { top?: number; min_modifier_df?: number } = {},
  ) =>
    api.post<RecommendResult>('/api/v1/keyword-dna/recommend', {
      seed,
      top: opts.top ?? 20,
      min_modifier_df: opts.min_modifier_df ?? 3,
    }),
}
