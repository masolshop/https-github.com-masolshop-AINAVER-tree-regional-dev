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
  credentials_source: 'json_env' | 'file' | null
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
}
