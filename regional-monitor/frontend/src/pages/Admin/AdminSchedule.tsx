/**
 * Admin → 자동 검증 스케줄 (/admin/schedule 또는 /admin?tab=schedule)
 *
 * 슈퍼어드민이 전 회원의 자동 검증 주기/슬롯을 관리한다.
 *
 * 구성:
 *  · KPI 카드 — 활성 회원 / paused / 총 등록 / 슬롯 최대 부하 / 평균 / 초과
 *  · 96 슬롯 히트맵 — 슬롯별 등록 합계 색상 (대각선 형태로 0~95 표시)
 *  · 회원 표 — 검색/플랜/주기 필터 + 슬롯/주기 인라인 편집 + paused 토글
 *  · 리밸런스 버튼 — dry-run 미리보기 → 적용
 *
 * 백엔드:
 *   GET   /api/v1/admin/schedule/users
 *   GET   /api/v1/admin/schedule/heatmap
 *   PATCH /api/v1/admin/schedule/users/{id}
 *   POST  /api/v1/admin/schedule/rebalance
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  RefreshCw,
  Users as UsersIcon,
  Pause,
  Building2,
  Activity,
  AlertTriangle,
  Gauge,
  Shuffle,
  Save,
  CheckCircle2,
} from 'lucide-react'

import { Card } from '@/components/ui/Card'
import {
  adminApi,
  type AdminPlanKey,
  type AdminScheduleUserRow,
  type VerifyFrequency,
} from '@/api/admin'

type SortKey = 'slot' | 'places' | 'frequency' | 'last_run'

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

const FREQ_LABEL: Record<VerifyFrequency, string> = {
  daily: '매일',
  every3d: '3일마다',
  every5d: '5일마다',
  weekly: '매주',
  paused: '일시정지',
}

const FREQ_TONE: Record<VerifyFrequency, string> = {
  daily: 'bg-emerald-50 text-emerald-700',
  every3d: 'bg-blue-50 text-blue-700',
  every5d: 'bg-amber-50 text-amber-700',
  weekly: 'bg-purple-50 text-purple-700',
  paused: 'bg-red-50 text-red-700',
}

function fmtKstShort(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const m = d.getMonth() + 1
    const day = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${m}/${day} ${h}:${mi}`
  } catch {
    return '—'
  }
}

export function AdminSchedule() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState<AdminPlanKey | ''>('')
  const [frequency, setFrequency] = useState<VerifyFrequency | ''>('')
  const [sort, setSort] = useState<SortKey>('slot')
  const [onlyWithPlaces, setOnlyWithPlaces] = useState(false)

  const [debouncedQ, setDebouncedQ] = useState('')
  useMemo(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const list = useQuery({
    queryKey: ['admin', 'schedule', 'users', debouncedQ, plan, frequency, onlyWithPlaces, sort],
    queryFn: () =>
      adminApi.scheduleUsers({
        q: debouncedQ || undefined,
        plan: plan || undefined,
        frequency: frequency || undefined,
        only_with_places: onlyWithPlaces || undefined,
        sort,
        limit: 2000,
      }),
    staleTime: 30_000,
  })

  const heatmap = useQuery({
    queryKey: ['admin', 'schedule', 'heatmap'],
    queryFn: () => adminApi.scheduleHeatmap(),
    staleTime: 30_000,
  })

  const summary = list.data?.summary
  const items = list.data?.items ?? []

  // ── 인라인 편집 mutation ──
  const patchMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number
      body: { verify_frequency?: VerifyFrequency; verify_slot_15m?: number }
    }) => adminApi.patchScheduleUser(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schedule'] })
    },
  })

  // ── 리밸런스 mutation ──
  const [rebalanceResult, setRebalanceResult] = useState<{
    moved: number
    before: number
    after: number
    dry: boolean
  } | null>(null)
  const rebalanceMut = useMutation({
    mutationFn: (dry_run: boolean) =>
      adminApi.rebalanceSchedule({ target_max: 80, max_passes: 5, dry_run }),
    onSuccess: (data) => {
      setRebalanceResult({
        moved: data.moved,
        before: data.before_max,
        after: data.after_max,
        dry: data.dry_run,
      })
      if (!data.dry_run) {
        qc.invalidateQueries({ queryKey: ['admin', 'schedule'] })
      }
    },
  })

  return (
    <div className="space-y-5">
      {/* ─── KPI 카드 ─── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard
          icon={<UsersIcon className="h-4 w-4" />}
          tone="info"
          label="활성 회원"
          value={summary?.users_total ?? 0}
          sub={`paused ${summary?.users_paused ?? 0}`}
        />
        <KpiCard
          icon={<Building2 className="h-4 w-4" />}
          tone="info"
          label="총 등록건수"
          value={summary?.places_total ?? 0}
        />
        <KpiCard
          icon={<Gauge className="h-4 w-4" />}
          tone="warning"
          label="슬롯 최대 부하"
          value={summary?.slot_max_load ?? 0}
          sub="등록건수/슬롯"
        />
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          tone="info"
          label="슬롯 평균 부하"
          value={Math.round(summary?.slot_avg_load ?? 0)}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="danger"
          label="초과 슬롯"
          value={summary?.slot_over_limit ?? 0}
          sub="≥ 80 건"
        />
        <KpiCard
          icon={<Pause className="h-4 w-4" />}
          tone="warning"
          label="paused"
          value={summary?.users_paused ?? 0}
        />
      </div>

      {/* ─── 96 슬롯 히트맵 ─── */}
      <Card variant="white" className="!p-card-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-h3 text-ink">96 슬롯 부하 (15분 단위)</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              슬롯당 등록 합계 — 빨강이 진할수록 검증 부하 높음 ·{' '}
              <span className="font-semibold">상한 {heatmap.data?.slot_limit ?? 80}건</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              list.refetch()
              heatmap.refetch()
            }}
            disabled={list.isFetching || heatmap.isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-line text-body-sm text-ink hover:bg-bg-subtle disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${list.isFetching ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
        <Heatmap
          cells={heatmap.data?.cells ?? []}
          maxLoad={heatmap.data?.max_load ?? 0}
          slotLimit={heatmap.data?.slot_limit ?? 80}
        />
      </Card>

      {/* ─── 리밸런스 패널 ─── */}
      <Card variant="white" className="!p-card-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[280px]">
            <h3 className="text-h3 text-ink flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-brand-600" /> 슬롯 자동 리밸런스
            </h3>
            <p className="text-caption text-ink-muted mt-0.5">
              슬롯당 등록 합계가 80건을 초과하면 인접 슬롯으로 회원 1명씩 이동시켜 평탄화합니다.
              먼저 <span className="font-semibold">시뮬레이션</span> 으로 이동 계획만 확인 후 적용하세요.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => rebalanceMut.mutate(true)}
              disabled={rebalanceMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card border border-line text-body-sm text-ink hover:bg-bg-subtle disabled:opacity-60"
            >
              <Activity className="h-3.5 w-3.5" />
              시뮬레이션
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    '슬롯 리밸런스를 실제로 적용합니다.\n회원의 verify_slot_15m 이 변경됩니다. 계속할까요?',
                  )
                ) {
                  rebalanceMut.mutate(false)
                }
              }}
              disabled={rebalanceMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-brand-600 text-white text-body-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              적용
            </button>
          </div>
        </div>
        {rebalanceResult && (
          <div className="mt-3 px-3 py-2 rounded-card bg-bg-subtle text-body-sm text-ink">
            <CheckCircle2 className="inline h-3.5 w-3.5 text-status-success mr-1.5" />
            {rebalanceResult.dry ? '시뮬레이션 결과' : '적용 완료'} —{' '}
            <span className="font-semibold">{rebalanceResult.moved}</span> 명 이동,
            슬롯 최대 부하{' '}
            <span className="tabular-nums">
              {rebalanceResult.before} → {rebalanceResult.after}
            </span>
          </div>
        )}
      </Card>

      {/* ─── 필터 / 검색 ─── */}
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
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as VerifyFrequency | '')}
            className="px-3 py-2 rounded-card border border-line bg-white text-body-sm"
            aria-label="주기 필터"
          >
            <option value="">전체 주기</option>
            <option value="daily">매일</option>
            <option value="every3d">3일마다</option>
            <option value="every5d">5일마다</option>
            <option value="weekly">매주</option>
            <option value="paused">일시정지</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-2 rounded-card border border-line bg-white text-body-sm"
            aria-label="정렬"
          >
            <option value="slot">슬롯 순</option>
            <option value="places">등록갯수 많은 순</option>
            <option value="frequency">주기별</option>
            <option value="last_run">마지막 실행 오래된 순</option>
          </select>

          <label className="flex items-center gap-2 text-body-sm text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithPlaces}
              onChange={(e) => setOnlyWithPlaces(e.target.checked)}
              className="rounded"
            />
            등록 ≥ 1
          </label>
        </div>
      </Card>

      {/* ─── 회원 표 ─── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">회원별 검증 스케줄</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              {list.isLoading ? '불러오는 중…' : `총 ${items.length.toLocaleString()}명`}
            </p>
          </div>
        </div>

        {list.error ? (
          <div className="p-8 text-center text-status-danger">데이터를 불러오지 못했습니다.</div>
        ) : list.isLoading ? (
          <div className="p-12 text-center text-ink-muted">로딩 중…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-ink-muted">조건에 맞는 회원이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                  <th className="px-card-sm py-3 font-semibold">#</th>
                  <th className="px-3 py-3 font-semibold">회원명</th>
                  <th className="px-3 py-3 font-semibold">업체명</th>
                  <th className="px-3 py-3 font-semibold">등급</th>
                  <th className="px-3 py-3 font-semibold text-right">등록갯수</th>
                  <th className="px-3 py-3 font-semibold">주기</th>
                  <th className="px-3 py-3 font-semibold">슬롯</th>
                  <th className="px-3 py-3 font-semibold">마지막 실행</th>
                  <th className="px-3 py-3 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <ScheduleRow
                    key={row.user_id}
                    row={row}
                    idx={idx + 1}
                    onPatch={(body) => patchMut.mutate({ id: row.user_id, body })}
                    busy={patchMut.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ───────────── 히트맵 ───────────── */

function Heatmap({
  cells,
  maxLoad,
  slotLimit,
}: {
  cells: { slot: number; label: string; user_count: number; place_count: number }[]
  maxLoad: number
  slotLimit: number
}) {
  // 96 슬롯이 없으면 placeholder
  const grid: typeof cells = cells.length === 96
    ? cells
    : Array.from({ length: 96 }, (_, i) => ({
        slot: i,
        label: `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
        user_count: 0,
        place_count: 0,
      }))

  // 24행 × 4열 (시 × 15분 슬롯)
  const rows = Array.from({ length: 24 }, (_, h) =>
    Array.from({ length: 4 }, (_, q) => grid[h * 4 + q]),
  )

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] tabular-nums">
        <thead>
          <tr className="text-ink-muted">
            <th className="pr-2 text-right font-normal">시</th>
            <th className="px-1 font-normal">:00</th>
            <th className="px-1 font-normal">:15</th>
            <th className="px-1 font-normal">:30</th>
            <th className="px-1 font-normal">:45</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, h) => (
            <tr key={h}>
              <td className="pr-2 text-right text-ink-muted font-mono">
                {String(h).padStart(2, '0')}
              </td>
              {row.map((cell) => (
                <td key={cell.slot} className="p-0.5">
                  <HeatCell cell={cell} maxLoad={maxLoad} slotLimit={slotLimit} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeatCell({
  cell,
  maxLoad,
  slotLimit,
}: {
  cell: { slot: number; label: string; user_count: number; place_count: number }
  maxLoad: number
  slotLimit: number
}) {
  const ratio = maxLoad > 0 ? cell.place_count / maxLoad : 0
  const over = cell.place_count > slotLimit
  // 색상: 0 → 회색, ratio↑ → 빨강, over → 진한 빨강 테두리
  let bg = 'bg-bg-subtle'
  if (cell.place_count > 0) {
    if (over) bg = 'bg-red-500 text-white'
    else if (ratio >= 0.75) bg = 'bg-red-300 text-white'
    else if (ratio >= 0.5) bg = 'bg-orange-300'
    else if (ratio >= 0.25) bg = 'bg-amber-200'
    else bg = 'bg-emerald-100'
  }

  return (
    <div
      className={`w-12 h-7 rounded ${bg} flex items-center justify-center font-mono ${
        over ? 'ring-1 ring-red-700' : ''
      }`}
      title={`${cell.label} · 회원 ${cell.user_count}명 · 등록 ${cell.place_count}건${
        over ? ' (초과)' : ''
      }`}
    >
      {cell.place_count > 0 ? cell.place_count : ''}
    </div>
  )
}

/* ───────────── 회원 1행 ───────────── */

function ScheduleRow({
  row,
  idx,
  onPatch,
  busy,
}: {
  row: AdminScheduleUserRow
  idx: number
  onPatch: (body: { verify_frequency?: VerifyFrequency; verify_slot_15m?: number }) => void
  busy: boolean
}) {
  const planLabel = PLAN_LABEL[row.plan as AdminPlanKey] ?? row.plan
  const planTone = PLAN_TONE[row.plan as AdminPlanKey] ?? 'bg-bg-subtle text-ink-muted'

  return (
    <tr className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors">
      <td className="px-card-sm py-2 text-ink-muted tabular-nums">{idx}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-ink font-semibold">{row.name || '—'}</span>
          {!row.is_active && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-700">
              차단
            </span>
          )}
        </div>
        <div className="text-caption text-ink-muted truncate max-w-[200px]">{row.email}</div>
      </td>
      <td className="px-3 py-2 text-ink">{row.company || '—'}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex px-2 py-0.5 rounded-pill text-caption font-bold ${planTone}`}
        >
          {planLabel}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
        {row.place_count.toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <select
          value={row.verify_frequency}
          disabled={busy}
          onChange={(e) =>
            onPatch({ verify_frequency: e.target.value as VerifyFrequency })
          }
          className={`px-2 py-1 rounded text-caption font-semibold border border-line ${
            FREQ_TONE[row.verify_frequency]
          }`}
        >
          <option value="daily">매일</option>
          <option value="every3d">3일마다</option>
          <option value="every5d">5일마다</option>
          <option value="weekly">매주</option>
          <option value="paused">일시정지</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          max={95}
          defaultValue={row.verify_slot_15m}
          disabled={busy}
          onBlur={(e) => {
            const v = Math.max(0, Math.min(95, parseInt(e.target.value || '0', 10)))
            if (v !== row.verify_slot_15m) onPatch({ verify_slot_15m: v })
          }}
          className="w-16 px-2 py-1 rounded border border-line text-center tabular-nums font-mono text-body-sm"
          title={`${row.verify_slot_label} (0~95)`}
        />
        <span className="ml-1.5 text-caption text-ink-muted font-mono">
          {row.verify_slot_label}
        </span>
      </td>
      <td className="px-3 py-2 text-ink-muted text-caption">
        {fmtKstShort(row.last_auto_run_at)}
        {row.next_due_at && (
          <div className="text-[10px] text-ink-muted">→ {fmtKstShort(row.next_due_at)}</div>
        )}
      </td>
      <td className="px-3 py-2">
        {row.verify_frequency === 'paused' ? (
          <span className="px-2 py-0.5 rounded-pill text-caption bg-red-50 text-red-700 font-semibold">
            일시정지
          </span>
        ) : row.is_due_now ? (
          <span className="px-2 py-0.5 rounded-pill text-caption bg-amber-50 text-amber-700 font-semibold">
            실행 대기
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-pill text-caption bg-emerald-50 text-emerald-700 font-semibold">
            대기 중
          </span>
        )}
      </td>
    </tr>
  )
}

/* ───────────── KPI 카드 ───────────── */

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  sub?: string
  tone: 'success' | 'warning' | 'danger' | 'info'
}) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  return (
    <Card variant="white" className="!p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-xl ${toneClass} flex items-center justify-center`}>
          {icon}
        </div>
        {sub && (
          <span className="text-caption text-ink-muted truncate max-w-[120px]">{sub}</span>
        )}
      </div>
      <div className="text-caption text-ink-muted mb-0.5">{label}</div>
      <div className="text-h2 text-ink tabular-nums leading-none">
        {value.toLocaleString()}
      </div>
    </Card>
  )
}
