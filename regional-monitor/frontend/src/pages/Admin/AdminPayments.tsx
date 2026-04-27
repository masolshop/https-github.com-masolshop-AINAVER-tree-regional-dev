/**
 * 어드민 결제 관리 — 결제 이력 조회 + 수동 부여 + 환불 처리.
 *
 *  · 필터: status / plan
 *  · 수동 부여: 사용자 선택 → 플랜 / 금액 / 결제수단 → 즉시 paid 처리 + (옵션) user.plan 동기화
 *  · 환불: 상태 변경 (paid → refunded), refunded_at 자동 기록 (백엔드)
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatKSTDate, formatKSTDateTime } from '@/utils/datetime'
import {
  CreditCard,
  Plus,
  RefreshCcw,
  Search,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'

import {
  adminApi,
  type AdminPaymentMethod,
  type AdminPaymentOut,
  type AdminPaymentStatus,
  type AdminPlanKey,
  type AdminUserOut,
  type PaymentListQuery,
} from '@/api/admin'
import { Card } from '@/components/ui/Card'

const PLAN_OPTIONS: AdminPlanKey[] = ['free', 'basic', 'pro', 'enterprise']
const PLAN_BADGE: Record<AdminPlanKey, string> = {
  free: 'bg-slate-100 text-slate-700',
  basic: 'bg-sky-100 text-sky-700',
  pro: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-800',
}

const STATUS_OPTIONS: AdminPaymentStatus[] = ['pending', 'paid', 'failed', 'refunded', 'canceled']
const STATUS_BADGE: Record<AdminPaymentStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  refunded: 'bg-slate-100 text-slate-700 border-slate-300',
  canceled: 'bg-slate-50 text-slate-500 border-slate-200',
}
const STATUS_LABEL: Record<AdminPaymentStatus, string> = {
  pending: '대기',
  paid: '결제완료',
  failed: '실패',
  refunded: '환불',
  canceled: '취소',
}

const METHOD_OPTIONS: AdminPaymentMethod[] = ['card', 'kakao_pay', 'naver_pay', 'bank', 'admin_grant']
const METHOD_LABEL: Record<AdminPaymentMethod, string> = {
  card: '카드',
  kakao_pay: '카카오페이',
  naver_pay: '네이버페이',
  bank: '계좌이체',
  admin_grant: '어드민 수동',
}

const PLAN_DEFAULT_PRICE: Record<AdminPlanKey, number> = {
  free: 0,
  basic: 9900,
  pro: 49000,
  enterprise: 99000,
}

function formatKRW(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원'
}

function formatDate(s: string | null): string {
  return formatKSTDateTime(s, '—')
}

export function AdminPayments() {
  const [statusFilter, setStatusFilter] = useState<AdminPaymentStatus | ''>('')
  const [planFilter, setPlanFilter] = useState<AdminPlanKey | ''>('')
  const [openCreate, setOpenCreate] = useState(false)
  const [refundTarget, setRefundTarget] = useState<AdminPaymentOut | null>(null)

  const query: PaymentListQuery = {
    status: statusFilter || undefined,
    plan: planFilter || undefined,
    limit: 100,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'payments', query],
    queryFn: () => adminApi.listPayments(query),
    refetchInterval: 60_000,
  })

  const totalAmount = data?.items
    .filter((p) => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount_krw, 0) ?? 0

  return (
    <div className="space-y-4">
      {/* 상단 — 필터 + 액션 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AdminPaymentStatus | '')}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">상태 전체</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>

          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value as AdminPlanKey | '')}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">플랜 전체</option>
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-sm text-ink-muted">
              {data ? (
                <>
                  총 <strong className="text-ink">{data.total.toLocaleString()}</strong>건 · 결제완료
                  합계 <strong className="text-ink">{formatKRW(totalAmount)}</strong>
                </>
              ) : (
                '...'
              )}
            </div>
            <button
              onClick={() => setOpenCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-bold text-white hover:bg-brand-600"
            >
              <Plus className="h-4 w-4" /> 수동 부여
            </button>
          </div>
        </div>
      </Card>

      {/* 표 */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-line bg-slate-50 text-left">
              <tr className="text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">사용자</th>
                <th className="px-4 py-3 font-semibold">플랜</th>
                <th className="px-4 py-3 font-semibold text-right">금액</th>
                <th className="px-4 py-3 font-semibold">결제수단</th>
                <th className="px-4 py-3 font-semibold">상태</th>
                <th className="px-4 py-3 font-semibold">기간</th>
                <th className="px-4 py-3 font-semibold">생성</th>
                <th className="px-4 py-3 font-semibold text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-ink-muted">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-ink-muted">
                    조건에 맞는 결제 이력이 없습니다.
                  </td>
                </tr>
              )}
              {data?.items.map((p) => (
                <tr key={p.id} className="border-b border-line/60 last:border-0 hover:bg-slate-50/40">
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">#{p.id}</td>
                  <td className="px-4 py-3">
                    <div className="leading-tight">
                      <div className="font-semibold text-ink">{p.user_name ?? '—'}</div>
                      <div className="text-xs text-ink-muted">{p.user_email ?? `user#${p.user_id}`}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLAN_BADGE[p.plan]}`}
                    >
                      {p.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatKRW(p.amount_krw)}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {p.method ? METHOD_LABEL[p.method] : '—'}
                    {p.gateway && (
                      <div className="text-[10px] text-ink-muted/70">{p.gateway}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[p.status]}`}
                    >
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {formatKSTDate(p.period_start, '—')}
                    {p.period_end && (
                      <>
                        {' ~ '}
                        {formatKSTDate(p.period_end, '—')}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'paid' ? (
                      <button
                        onClick={() => setRefundTarget(p)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                        title="환불"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" /> 환불
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted/60">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {openCreate && <CreatePaymentModal onClose={() => setOpenCreate(false)} />}
      {refundTarget && (
        <RefundModal payment={refundTarget} onClose={() => setRefundTarget(null)} />
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// 수동 결제 부여 모달
// ──────────────────────────────────────────────────────────────

function CreatePaymentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()

  const [searchQ, setSearchQ] = useState('')
  const [picked, setPicked] = useState<AdminUserOut | null>(null)
  const [plan, setPlan] = useState<AdminPlanKey>('pro')
  const [amount, setAmount] = useState<number>(PLAN_DEFAULT_PRICE['pro'])
  const [method, setMethod] = useState<AdminPaymentMethod>('admin_grant')
  const [memo, setMemo] = useState('')
  const [periodDays, setPeriodDays] = useState<number>(30)
  const [markPaid, setMarkPaid] = useState(true)
  const [applyPlan, setApplyPlan] = useState(true)

  // 사용자 검색 (디바운스 없이 — 어드민 화면이라 충분)
  const { data: users } = useQuery({
    queryKey: ['admin', 'users', 'search', searchQ],
    queryFn: () => adminApi.listUsers({ q: searchQ.trim() || undefined, limit: 8 }),
    enabled: searchQ.trim().length > 0,
    staleTime: 5_000,
  })

  const mutation = useMutation({
    mutationFn: () => {
      if (!picked) throw new Error('사용자를 선택하세요.')
      return adminApi.createPayment({
        user_id: picked.id,
        plan,
        amount_krw: amount,
        method,
        memo: memo.trim() || null,
        period_days: periodDays,
        mark_paid: markPaid,
        apply_plan_to_user: applyPlan,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
      onClose()
    },
  })

  return (
    <Modal onClose={onClose} title="결제 수동 부여" icon={<CreditCard className="h-5 w-5 text-brand-500" />}>
      <div className="space-y-4">
        {/* 사용자 검색 */}
        <FieldGroup label="사용자 *">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value)
                if (picked) setPicked(null)
              }}
              placeholder="이메일 / 이름 / 회사 검색"
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm placeholder:text-ink-muted focus:border-brand-400 focus:outline-none"
            />
          </div>
          {searchQ && !picked && users && users.items.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line bg-white shadow-sm">
              {users.items.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setPicked(u)
                    setSearchQ(`${u.name} (${u.email})`)
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="leading-tight">
                    <div className="text-sm font-semibold text-ink">{u.name}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase ${PLAN_BADGE[u.plan]} rounded-full px-2 py-0.5`}>
                    {u.plan}
                  </span>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <div>
                <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
                <strong>{picked.name}</strong>{' '}
                <span className="text-ink-muted">({picked.email})</span> · 현재 {picked.plan}
              </div>
            </div>
          )}
        </FieldGroup>

        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="플랜">
            <select
              value={plan}
              onChange={(e) => {
                const p = e.target.value as AdminPlanKey
                setPlan(p)
                setAmount(PLAN_DEFAULT_PRICE[p])
              }}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FieldGroup>

          <FieldGroup label="금액 (원)">
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm"
            />
          </FieldGroup>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="결제수단">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as AdminPaymentMethod)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </FieldGroup>

          <FieldGroup label="이용 기간 (일)">
            <input
              type="number"
              min={1}
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </FieldGroup>
        </div>

        <FieldGroup label="메모">
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 캠페인 수동 부여 / 환불처리 / 기념 지급"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
        </FieldGroup>

        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <CheckRow
            checked={markPaid}
            onChange={setMarkPaid}
            label="즉시 paid 처리"
            desc="OFF 면 pending 상태로 생성"
          />
          <CheckRow
            checked={applyPlan}
            onChange={setApplyPlan}
            label="사용자 플랜에도 즉시 반영"
            desc="user.plan / quota_places 도 함께 변경"
          />
        </div>

        {mutation.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mr-1 inline h-4 w-4" />
            {(mutation.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!picked || mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? '저장 중…' : '결제 생성'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ──────────────────────────────────────────────────────────────
// 환불 확인 모달
// ──────────────────────────────────────────────────────────────

function RefundModal({
  payment,
  onClose,
}: {
  payment: AdminPaymentOut
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => adminApi.patchPayment(payment.id, { status: 'refunded' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
      onClose()
    },
  })

  return (
    <Modal
      onClose={onClose}
      title="결제 환불 처리"
      icon={<RefreshCcw className="h-5 w-5 text-rose-500" />}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-bold">⚠️ 환불 처리</div>
          <div className="mt-1 text-rose-700">
            결제 #{payment.id} ({formatKRW(payment.amount_krw)}, {payment.plan}) 의 상태를{' '}
            <strong>refunded</strong> 로 변경합니다. 매출 누적에서 차감됩니다.
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <span className="text-ink-muted">사용자: </span>
            <strong>{payment.user_name}</strong> ({payment.user_email})
          </div>
          <div>
            <span className="text-ink-muted">결제일: </span>
            {formatDate(payment.paid_at)}
          </div>
        </div>

        {mutation.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {mutation.isPending ? '처리 중…' : '환불 처리'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ──────────────────────────────────────────────────────────────
// 공통 UI
// ──────────────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
  title,
  icon,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
  icon?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
            {icon}
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-slate-100 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-ink-muted">{label}</div>
      {children}
    </label>
  )
}

function CheckRow({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean
  onChange: (b: boolean) => void
  label: string
  desc: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-2 border-ink-muted text-brand-500 focus:ring-brand-300"
      />
      <div className="flex-1 leading-tight">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-ink-muted">{desc}</div>
      </div>
    </label>
  )
}
