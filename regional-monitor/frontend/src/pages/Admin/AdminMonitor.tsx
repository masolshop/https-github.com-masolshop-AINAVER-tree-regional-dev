/**
 * Admin → 회원 모니터링 (/admin/monitor 또는 /admin?tab=monitor)
 *
 * 슈퍼어드민이 전 회원의 등록건수 + 검증상태 분포를 한눈에 보는 페이지.
 *
 * 표 컬럼:
 *   회원명 / 업체명 / 회원등급 / 등록갯수 / 정상노출 / 네이버 미노출 / 변경 노출
 *   (참고용으로 검증대기 컬럼도 함께 표시)
 *
 * 백엔드: GET /api/v1/admin/users/monitor
 *   - 쿼리 파라미터로 검색(q) / 플랜 / 정렬 / 등록≥1 필터 지원
 *   - 응답: { summary, items[] }
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search,
  Users as UsersIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Building2,
  RefreshCw,
} from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { adminApi, type AdminMonitorRow, type AdminPlanKey } from '@/api/admin'

type SortKey = 'places' | 'dead' | 'mismatch' | 'pending' | 'recent'

const PLAN_LABEL: Record<AdminPlanKey, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const PLAN_TONE: Record<AdminPlanKey, string> = {
  free: 'bg-bg-subtle text-ink-muted',
  basic: 'bg-blue-50 text-blue-700',
  pro: 'bg-amber-50 text-amber-700',
  enterprise: 'bg-purple-50 text-purple-700',
}

export function AdminMonitor() {
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState<AdminPlanKey | ''>('')
  const [onlyWithPlaces, setOnlyWithPlaces] = useState(true)
  const [sort, setSort] = useState<SortKey>('places')

  // q 입력은 디바운스(300ms) — 너무 빈번한 호출 방지
  const [debouncedQ, setDebouncedQ] = useState('')
  useMemo(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'users', 'monitor', debouncedQ, plan, onlyWithPlaces, sort],
    queryFn: () =>
      adminApi.usersMonitor({
        q: debouncedQ || undefined,
        plan: plan || undefined,
        only_with_places: onlyWithPlaces || undefined,
        sort,
        limit: 1000,
      }),
    staleTime: 30_000,
  })

  const summary = data?.summary
  const items = data?.items ?? []

  return (
    <div className="space-y-5">
      {/* ─── 합계 카드 ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          icon={<UsersIcon className="h-4 w-4" />}
          tone="info"
          label="전체 회원"
          value={summary?.users_total ?? 0}
          sub={`등록 보유 ${summary?.users_with_places ?? 0}명`}
        />
        <SummaryCard
          icon={<Building2 className="h-4 w-4" />}
          tone="info"
          label="총 등록건수"
          value={summary?.places_total ?? 0}
          sub="전체 070 합계"
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          label="정상 노출"
          value={summary?.ok_total ?? 0}
        />
        <SummaryCard
          icon={<XCircle className="h-4 w-4" />}
          tone="danger"
          label="네이버 미노출"
          value={summary?.dead_total ?? 0}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="info"
          label="변경 노출"
          value={summary?.mismatch_total ?? 0}
          sub={`검증대기 ${summary?.pending_total ?? 0}`}
        />
      </div>

      {/* ─── 필터 / 정렬 / 검색 ─── */}
      <Card variant="white" className="!p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이메일 / 회원명 / 업체명 검색"
              className="w-full pl-9 pr-3 py-2 rounded-card border border-line bg-white text-body-sm focus:outline-none focus:border-brand-500"
            />
          </div>

          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as AdminPlanKey | '')}
            className="px-3 py-2 rounded-card border border-line bg-white text-body-sm"
            aria-label="회원등급 필터"
          >
            <option value="">전체 등급</option>
            <option value="free">Free</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-2 rounded-card border border-line bg-white text-body-sm"
            aria-label="정렬"
          >
            <option value="places">등록갯수 많은 순</option>
            <option value="dead">네이버 미노출 많은 순</option>
            <option value="mismatch">변경 노출 많은 순</option>
            <option value="pending">검증대기 많은 순</option>
            <option value="recent">최근 가입 순</option>
          </select>

          <label className="flex items-center gap-2 text-body-sm text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithPlaces}
              onChange={(e) => setOnlyWithPlaces(e.target.checked)}
              className="rounded"
            />
            등록 ≥ 1 만
          </label>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-card border border-line text-body-sm text-ink hover:bg-bg-subtle disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </Card>

      {/* ─── 회원 목록 표 ─── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">회원별 검증상태</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              {isLoading
                ? '불러오는 중…'
                : `총 ${items.length.toLocaleString()}명 표시`}
            </p>
          </div>
        </div>

        {error ? (
          <div className="p-8 text-center text-status-danger">
            데이터를 불러오지 못했습니다. 다시 시도해 주세요.
          </div>
        ) : isLoading ? (
          <div className="p-12 text-center text-ink-muted">로딩 중…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-ink-muted">
            조건에 맞는 회원이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                  <th className="px-card-sm py-3 font-semibold">#</th>
                  <th className="px-3 py-3 font-semibold">회원명</th>
                  <th className="px-3 py-3 font-semibold">업체명</th>
                  <th className="px-3 py-3 font-semibold">회원등급</th>
                  <th className="px-3 py-3 font-semibold text-right">등록갯수</th>
                  <th className="px-3 py-3 font-semibold text-right">정상 노출</th>
                  <th className="px-3 py-3 font-semibold text-right">네이버 미노출</th>
                  <th className="px-3 py-3 font-semibold text-right">변경 노출</th>
                  <th className="px-3 py-3 font-semibold text-right">검증 대기</th>
                  <th className="px-3 py-3 font-semibold text-center">최근 모드</th>
                  <th className="px-card-sm py-3 font-semibold text-right">정상률</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <MonitorRow key={row.user_id} row={row} idx={idx + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ───────────── 서브 컴포넌트 ───────────── */

function MonitorRow({ row, idx }: { row: AdminMonitorRow; idx: number }) {
  const okRate =
    row.place_count > 0
      ? Math.round((row.ok_count / row.place_count) * 1000) / 10
      : 0

  const planLabel = PLAN_LABEL[row.plan as AdminPlanKey] ?? row.plan
  const planTone = PLAN_TONE[row.plan as AdminPlanKey] ?? 'bg-bg-subtle text-ink-muted'

  return (
    <tr className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors">
      <td className="px-card-sm py-3 text-ink-muted tabular-nums">{idx}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-ink font-semibold">{row.name || '—'}</span>
          {row.is_superadmin && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700">
              ADMIN
            </span>
          )}
          {!row.is_active && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-700">
              차단
            </span>
          )}
        </div>
        <div className="text-caption text-ink-muted truncate max-w-[200px]">
          {row.email}
        </div>
      </td>
      <td className="px-3 py-3 text-ink">{row.company || '—'}</td>
      <td className="px-3 py-3">
        <span
          className={`inline-flex px-2 py-0.5 rounded-pill text-caption font-bold ${planTone}`}
        >
          {planLabel}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-semibold text-ink">
        {row.place_count.toLocaleString()}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-status-success font-semibold">
        {row.ok_count.toLocaleString()}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <span
          className={
            row.dead_count > 0
              ? 'text-status-danger font-semibold'
              : 'text-ink-soft'
          }
        >
          {row.dead_count.toLocaleString()}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <span
          className={
            row.mismatch_count > 0
              ? 'text-status-info font-semibold'
              : 'text-ink-soft'
          }
        >
          {row.mismatch_count.toLocaleString()}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <span
          className={
            row.pending_count > 0 ? 'text-ink-muted' : 'text-ink-soft'
          }
        >
          {row.pending_count.toLocaleString()}
        </span>
      </td>
      <td className="px-3 py-3 text-center">
        <ModeBadge
          mode={row.last_run_mode}
          trigger={row.last_run_trigger}
          at={row.last_run_at}
        />
      </td>
      <td className="px-card-sm py-3 text-right tabular-nums font-semibold">
        {row.place_count > 0 ? (
          <span
            className={
              okRate >= 95
                ? 'text-status-success'
                : okRate >= 80
                ? 'text-status-warning'
                : 'text-status-danger'
            }
          >
            {okRate.toFixed(1)}%
          </span>
        ) : (
          <span className="text-ink-soft">—</span>
        )}
      </td>
    </tr>
  )
}

/**
 * 최근 검증 1회의 모드(full/fast) + 트리거(scheduler/manual) + 시각을 뱃지로 표시.
 * full = 정밀(전화/동/상호) — 녹색, fast = 페이지 존재 — 회색.
 */
function ModeBadge({
  mode,
  trigger,
  at,
}: {
  mode: 'full' | 'fast' | string | null
  trigger: 'scheduler' | 'manual' | string | null
  at: string | null
}) {
  if (!mode) {
    return <span className="text-caption text-ink-soft">—</span>
  }
  const isFull = mode === 'full'
  const tone = isFull
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    : 'bg-bg-subtle text-ink-muted ring-1 ring-line'
  const label = isFull ? '정밀' : 'fast'
  const triggerLabel =
    trigger === 'scheduler' ? '자동' : trigger === 'manual' ? '수동' : ''

  let timeLabel = ''
  if (at) {
    try {
      const d = new Date(at)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      timeLabel = `${mm}/${dd} ${hh}:${mi}`
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex px-2 py-0.5 rounded-pill text-caption font-bold ${tone}`}
        title={`mode=${mode}${trigger ? ` · trigger=${trigger}` : ''}${at ? ` · ${at}` : ''}`}
      >
        {label}
        {triggerLabel ? ` · ${triggerLabel}` : ''}
      </span>
      {timeLabel && (
        <span className="text-[10px] text-ink-soft tabular-nums">{timeLabel}</span>
      )}
    </div>
  )
}

interface SummaryCardProps {
  icon: React.ReactNode
  label: string
  value: number
  sub?: string
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function SummaryCard({ icon, label, value, sub, tone }: SummaryCardProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  return (
    <Card variant="white" className="!p-4">
      <div className="flex items-center justify-between mb-2">
        <div
          className={`w-8 h-8 rounded-xl ${toneClass} flex items-center justify-center`}
        >
          {icon}
        </div>
        {sub && (
          <span className="text-caption text-ink-muted truncate max-w-[120px]">
            {sub}
          </span>
        )}
      </div>
      <div className="text-caption text-ink-muted mb-0.5">{label}</div>
      <div className="text-h2 text-ink tabular-nums leading-none">
        {value.toLocaleString()}
      </div>
    </Card>
  )
}

// ─── Clock 아이콘은 사용하지 않지만 import 유지(향후 확장용) ───
void Clock
