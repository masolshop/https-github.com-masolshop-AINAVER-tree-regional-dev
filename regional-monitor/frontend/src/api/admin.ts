/**
 * Admin API — /api/v1/admin/*
 * (require_superadmin 백엔드 가드)
 */
import { api } from './client'

export type AdminPlanKey = 'free' | 'basic' | 'pro' | 'enterprise'
export type AdminPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled'
export type AdminPaymentMethod =
  | 'card' | 'kakao_pay' | 'naver_pay' | 'bank' | 'admin_grant'

export interface AdminStatsOut {
  users_total: number
  users_active: number
  users_blocked: number
  users_by_plan: Record<string, number>
  places_total: number
  events_total: number
  events_unread: number
  payments_total: number
  revenue_paid_krw: number
  last_24h_checks: number
}

export interface AdminUserOut {
  id: number
  email: string
  name: string
  phone: string | null
  company: string | null
  plan: AdminPlanKey
  quota_places: number
  is_profile_complete: boolean
  is_superadmin: boolean
  is_active: boolean
  blocked_reason: string | null
  verify_slot: number
  place_count: number
  last_login_at: string | null
  created_at: string
}

export interface AdminUserListOut {
  total: number
  items: AdminUserOut[]
}

export interface AdminUserPatch {
  plan?: AdminPlanKey
  quota_places?: number
  is_active?: boolean
  blocked_reason?: string | null
  is_superadmin?: boolean
  name?: string
}

export interface AdminPaymentOut {
  id: number
  user_id: number
  user_email: string | null
  user_name: string | null
  plan: AdminPlanKey
  amount_krw: number
  currency: string
  status: AdminPaymentStatus
  method: AdminPaymentMethod | null
  gateway: string | null
  gateway_tx_id: string | null
  memo: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  paid_at: string | null
  refunded_at: string | null
}

export interface AdminPaymentListOut {
  total: number
  items: AdminPaymentOut[]
}

export interface AdminPaymentCreate {
  user_id: number
  plan: AdminPlanKey
  amount_krw?: number
  method?: AdminPaymentMethod
  gateway?: string | null
  gateway_tx_id?: string | null
  memo?: string | null
  period_days?: number
  mark_paid?: boolean
  apply_plan_to_user?: boolean
}

export interface AdminPaymentPatch {
  status?: AdminPaymentStatus
  memo?: string | null
}

export interface UserListQuery {
  q?: string
  plan?: AdminPlanKey | ''
  is_active?: boolean
  is_superadmin?: boolean
  limit?: number
  offset?: number
  sort?: 'recent' | 'oldest' | 'email' | 'places'
}

export interface PaymentListQuery {
  user_id?: number
  status?: AdminPaymentStatus | ''
  plan?: AdminPlanKey | ''
  limit?: number
  offset?: number
}

// ─────────────────────────────────────────────────────────────
// 회원 모니터링 (전 회원 검증상태 요약 — 슈퍼어드민 전용)
// ─────────────────────────────────────────────────────────────

export interface AdminMonitorRow {
  user_id: number
  email: string
  name: string
  company: string | null
  plan: AdminPlanKey
  is_active: boolean
  is_superadmin: boolean
  place_count: number
  ok_count: number
  dead_count: number
  mismatch_count: number
  pending_count: number
  last_login_at: string | null
  created_at: string
}

export interface AdminMonitorSummary {
  users_total: number
  users_with_places: number
  places_total: number
  ok_total: number
  dead_total: number
  mismatch_total: number
  pending_total: number
}

export interface AdminMonitorOut {
  summary: AdminMonitorSummary
  items: AdminMonitorRow[]
}

export interface AdminMonitorQuery {
  q?: string
  plan?: AdminPlanKey | ''
  only_with_places?: boolean
  sort?: 'places' | 'dead' | 'mismatch' | 'pending' | 'recent'
  limit?: number
}

function qs(params: object): string {
  const usp = new URLSearchParams()
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    usp.set(k, String(v))
  })
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export const adminApi = {
  stats: () => api.get<AdminStatsOut>('/api/v1/admin/stats'),

  listUsers: (q: UserListQuery = {}) =>
    api.get<AdminUserListOut>(`/api/v1/admin/users${qs(q as Record<string, unknown>)}`),

  getUser: (id: number) => api.get<AdminUserOut>(`/api/v1/admin/users/${id}`),

  patchUser: (id: number, body: AdminUserPatch) =>
    api.patch<AdminUserOut>(`/api/v1/admin/users/${id}`, body),

  deleteUser: (id: number) =>
    api.del<{ message: string }>(`/api/v1/admin/users/${id}`),

  listPayments: (q: PaymentListQuery = {}) =>
    api.get<AdminPaymentListOut>(`/api/v1/admin/payments${qs(q as Record<string, unknown>)}`),

  createPayment: (body: AdminPaymentCreate) =>
    api.post<AdminPaymentOut>('/api/v1/admin/payments', body),

  patchPayment: (id: number, body: AdminPaymentPatch) =>
    api.patch<AdminPaymentOut>(`/api/v1/admin/payments/${id}`, body),

  // 회원 모니터링 — 전 회원의 등록건수 + 검증상태 분포 한 번에
  usersMonitor: (q: AdminMonitorQuery = {}) =>
    api.get<AdminMonitorOut>(`/api/v1/admin/users/monitor${qs(q as Record<string, unknown>)}`),
}
