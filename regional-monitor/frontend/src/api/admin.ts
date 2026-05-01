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
  email?: string
  company?: string | null
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
  // 최근 자동/수동 검증 1회의 모드/트리거/시각 — UI 뱃지 표시용
  last_run_mode: 'full' | 'fast' | string | null
  last_run_trigger: 'scheduler' | 'manual' | string | null
  last_run_at: string | null
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

// ─────────────────────────────────────────────────────────────
// 자동 검증 스케줄 v2 (슈퍼어드민 전용)
// ─────────────────────────────────────────────────────────────

export type VerifyFrequency =
  | 'daily' | 'every3d' | 'every5d' | 'weekly' | 'paused'

export interface AdminScheduleUserRow {
  user_id: number
  email: string
  name: string
  company: string | null
  plan: AdminPlanKey
  is_active: boolean
  verify_frequency: VerifyFrequency
  verify_slot_15m: number          // 0~95
  verify_slot_label: string        // 'HH:MM'
  place_count: number
  last_auto_run_at: string | null
  next_due_at: string | null
  is_due_now: boolean
  // 최근 24h 동안 자동 ↔ 수동 충돌로 양보된 횟수
  skipped_manual_24h: number
}

export interface AdminScheduleSummary {
  users_total: number
  users_paused: number
  places_total: number
  slot_max_load: number
  slot_avg_load: number
  slot_over_limit: number
  by_frequency: Record<string, number>
  // 최근 24h verify_schedule_log 집계
  skipped_manual_24h: number
  skipped_manual_users_24h: number
  executed_24h: number
  dry_run_recorded_24h: number
}

export interface AdminScheduleListOut {
  summary: AdminScheduleSummary
  items: AdminScheduleUserRow[]
}

export interface AdminScheduleHeatmapCell {
  slot: number
  label: string
  user_count: number
  place_count: number
}

export interface AdminScheduleHeatmapOut {
  cells: AdminScheduleHeatmapCell[]
  slot_limit: number
  max_load: number
  over_limit_slots: number[]
}

export interface AdminScheduleUserPatch {
  verify_frequency?: VerifyFrequency
  verify_slot_15m?: number
}

export interface AdminScheduleRebalanceIn {
  target_max?: number
  max_passes?: number
  dry_run?: boolean
}

export interface AdminScheduleRebalancePlan {
  user_id: number
  from_slot: number
  to_slot: number
  place_count: number
}

export interface AdminScheduleRebalanceOut {
  before_max: number
  after_max: number
  moved: number
  passes: number
  target_max: number
  dry_run: boolean
  plan: AdminScheduleRebalancePlan[]
}

export interface AdminScheduleListQuery {
  q?: string
  plan?: AdminPlanKey | ''
  frequency?: VerifyFrequency | ''
  only_with_places?: boolean
  sort?: 'slot' | 'places' | 'frequency' | 'last_run'
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

  // 자동 검증 스케줄 v2 ─────────────────────────────────────────
  scheduleUsers: (q: AdminScheduleListQuery = {}) =>
    api.get<AdminScheduleListOut>(`/api/v1/admin/schedule/users${qs(q as Record<string, unknown>)}`),

  scheduleHeatmap: () =>
    api.get<AdminScheduleHeatmapOut>('/api/v1/admin/schedule/heatmap'),

  patchScheduleUser: (id: number, body: AdminScheduleUserPatch) =>
    api.patch<AdminScheduleUserRow>(`/api/v1/admin/schedule/users/${id}`, body),

  rebalanceSchedule: (body: AdminScheduleRebalanceIn = {}) =>
    api.post<AdminScheduleRebalanceOut>('/api/v1/admin/schedule/rebalance', body),

  // 주간 리포트 메일 ───────────────────────────────────────────
  weeklyReportRun: (dryRun: boolean) =>
    api.post<WeeklyReportRunResult>(
      `/api/v1/admin/weekly-report/run?dry_run=${dryRun ? 'true' : 'false'}`,
      {},
    ),
  weeklyReportPreview: (userId: number) =>
    api.get<WeeklyReportPreviewOut>(`/api/v1/admin/weekly-report/preview/${userId}`),
  weeklyReportRuns: (limit = 20) =>
    api.get<WeeklyReportRunsOut>(`/api/v1/admin/weekly-report/runs?limit=${limit}`),
  weeklyReportRunDetail: (runId: string, statusFilter?: string) =>
    api.get<WeeklyReportRunDetailOut>(
      `/api/v1/admin/weekly-report/runs/${encodeURIComponent(runId)}${statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : ''}`,
    ),
  weeklyReportUserHistory: (userId: number, limit = 20) =>
    api.get<WeeklyReportUserHistoryOut>(
      `/api/v1/admin/weekly-report/users/${userId}/history?limit=${limit}`,
    ),
}

// ── 주간 리포트 타입 ──────────────────────────────────────────
export type WeeklyReportTrigger = 'scheduled' | 'manual' | 'manual_dry_run'
export type WeeklyReportRowStatus =
  | 'sent'
  | 'sent_fallback'
  | 'skipped_no_activity'
  | 'skipped_disabled'
  | 'failed'
  | 'run_summary'

export interface WeeklyReportSummary {
  new_count: number
  excluded_count: number
  changed_exposure: number
  dead_exposure: number
  user_override: number
  total: number
  activity_total: number
}

export interface WeeklyReportRunResult {
  run_id: string
  sent: number
  skipped_no_activity: number
  skipped_disabled: number
  errors: number
  total_candidates: number
  elapsed_ms: number
  dry_run: boolean
}

export interface WeeklyReportPreviewOut {
  user_id: number
  email: string
  name: string | null
  is_active: boolean
  email_alerts: boolean
  is_profile_complete: boolean
  would_send: boolean
  to: string
  cc: string[]
  summary: WeeklyReportSummary
}

export interface WeeklyReportRunRow {
  id: number
  run_id: string
  trigger: WeeklyReportTrigger
  started_at: string | null
  sent_at: string | null
  sent_users: number
  skipped_no_activity: number
  skipped_disabled: number
  errors: number
  total_candidates: number
  elapsed_ms: number
  dry_run: boolean
}

export interface WeeklyReportRunsOut {
  total: number
  items: WeeklyReportRunRow[]
}

export interface WeeklyReportUserRow {
  id: number
  user_id: number | null
  email: string | null
  user_email_now?: string | null
  user_name_now?: string | null
  cc_emails: string | null
  status: WeeklyReportRowStatus
  sent_at: string | null
  new_count: number
  excluded_count: number
  changed_exposure: number
  dead_exposure: number
  user_override: number
  activity_total: number
  dry_run: boolean
  error: string | null
}

export interface WeeklyReportRunDetailOut {
  summary: WeeklyReportRunRow
  items: WeeklyReportUserRow[]
}

export interface WeeklyReportUserHistoryItem {
  id: number
  run_id: string
  trigger: WeeklyReportTrigger
  started_at: string | null
  sent_at: string | null
  status: WeeklyReportRowStatus
  new_count: number
  excluded_count: number
  changed_exposure: number
  dead_exposure: number
  user_override: number
  activity_total: number
  dry_run: boolean
  error: string | null
}

export interface WeeklyReportUserHistoryOut {
  user_id: number
  total: number
  items: WeeklyReportUserHistoryItem[]
}
