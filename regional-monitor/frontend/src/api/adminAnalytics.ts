/**
 * Admin Analytics API — /api/v1/admin/analytics/*
 * (require_superadmin 백엔드 가드, GA4 Data API 연동)
 */
import { api } from './client'

export type GaRange =
  | 'today'
  | 'yesterday'
  | '7daysAgo'
  | '14daysAgo'
  | '28daysAgo'
  | '30daysAgo'
  | '60daysAgo'
  | '90daysAgo'

export interface GaHealth {
  configured: boolean
  property_id: string | null
  credentials_source: 'json_env' | 'file' | 'oauth_user' | null
  oauth_configured: boolean
  oauth_connected: boolean
  /**
   * OAuth refresh_token 이 실제로 사용 가능한 상태인지.
   *  - true  : GA4 Data API 호출 가능
   *  - false : 토큰 파일은 있으나 만료/revoke 됨 → 재인증 필요
   *  - null  : OAuth 를 사용하지 않음(서비스 계정 자격증명 사용 중)
   */
  oauth_token_valid: boolean | null
  oauth_account_email: string | null
}

export interface GaOAuthStart {
  authorization_url: string
  state: string
}

export interface GaSummary {
  configured: boolean
  active_users: number
  new_users: number
  sessions: number
  page_views: number
  bounce_rate: number
  avg_session_seconds: number
}

export interface GaTimeseriesRow {
  date: string
  active_users: number
  sessions: number
  page_views: number
  new_users: number
}

export interface GaPageRow {
  path: string
  title: string
  page_views: number
  active_users: number
  avg_session_seconds: number
}

export interface GaCountryRow {
  country: string
  active_users: number
  sessions: number
}

export interface GaDeviceRow {
  device: string
  active_users: number
  sessions: number
}

export interface GaSourceRow {
  channel: string
  source: string
  active_users: number
  sessions: number
}

export interface GaRealtime {
  configured: boolean
  active_users_30min: number
  by_country: { country: string; active_users: number }[]
}

export const AdminAnalyticsApi = {
  health: () => api.get<GaHealth>('/api/v1/admin/analytics/health'),
  summary: (range: GaRange = '7daysAgo') =>
    api.get<GaSummary>(`/api/v1/admin/analytics/summary?range=${range}`),
  timeseries: (range: GaRange = '28daysAgo') =>
    api.get<GaTimeseriesRow[]>(`/api/v1/admin/analytics/timeseries?range=${range}`),
  pages: (range: GaRange = '7daysAgo', limit = 20) =>
    api.get<GaPageRow[]>(`/api/v1/admin/analytics/pages?range=${range}&limit=${limit}`),
  countries: (range: GaRange = '7daysAgo', limit = 15) =>
    api.get<GaCountryRow[]>(`/api/v1/admin/analytics/countries?range=${range}&limit=${limit}`),
  devices: (range: GaRange = '7daysAgo') =>
    api.get<GaDeviceRow[]>(`/api/v1/admin/analytics/devices?range=${range}`),
  sources: (range: GaRange = '7daysAgo', limit = 15) =>
    api.get<GaSourceRow[]>(`/api/v1/admin/analytics/sources?range=${range}&limit=${limit}`),
  realtime: () => api.get<GaRealtime>('/api/v1/admin/analytics/realtime'),
  oauthStart: () => api.get<GaOAuthStart>('/api/v1/admin/analytics/oauth/start'),
  oauthDisconnect: () => api.post<{ disconnected: boolean }>('/api/v1/admin/analytics/oauth/disconnect'),
}
