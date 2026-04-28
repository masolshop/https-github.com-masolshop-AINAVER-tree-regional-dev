/**
 * History — 자동 노출 검증 관리 페이지 (회차별 요약)
 *
 * 변경 (2026.04.28):
 *   기존: 개별 ChangeEvent 1건씩 타임라인 (광주대형렉카 070-XXXX 같은 행이 무수히)
 *   신규: 자동검증 회차 1회 = 1행 카드 (자동/수동 / OK·DEAD·PENDING / 변경건수 / 소요시간)
 *
 * 데이터:
 *   - useVerificationRuns(50): /api/v1/verification-runs (1분 polling)
 *   - useSchedulerStatus(): 다음 자동 검증 시각
 */
import { useMemo, useState } from 'react'
import {
  Clock3,
  RefreshCw,
  CalendarClock,
  Inbox,
  PlayCircle,
  Bot,
  User as UserIcon,
  Bell,
  Timer,
  Activity,
} from 'lucide-react'
import clsx from 'clsx'

import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  useVerificationRuns,
  useSchedulerStatus,
} from '@/hooks/useEvents'
import type { VerificationRunOut } from '@/api/types'

type TriggerFilter = 'all' | 'scheduler' | 'manual'

export default function History() {
  const runsQuery = useVerificationRuns(50)
  const schedulerQuery = useSchedulerStatus()

  const [trigger, setTrigger] = useState<TriggerFilter>('all')

  const runs = runsQuery.data?.items ?? []

  // 통계 (필터 적용 전)
  const stats = useMemo(() => {
    const s = {
      total: runs.length,
      auto: 0,
      manual: 0,
      events: 0,        // 누적 변경 감지 건수
      lastRun: null as VerificationRunOut | null,
    }
    for (const r of runs) {
      if (r.trigger === 'scheduler') s.auto += 1
      else s.manual += 1
      s.events += r.events_count
    }
    s.lastRun = runs[0] ?? null
    return s
  }, [runs])

  // 필터 적용
  const filtered = useMemo(() => {
    if (trigger === 'all') return runs
    return runs.filter((r) => r.trigger === trigger)
  }, [runs, trigger])

  // 날짜별 그룹핑
  const grouped = useMemo(() => groupByDateKST(filtered), [filtered])

  return (
    <div className="space-y-5">
      <TopBar
        title="자동 노출 검증 관리"
        subtitle="자동/수동 검증 회차별 결과 요약을 시간순으로 확인합니다"
      />

      {/* 1) KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="전체 회차" value={stats.total} icon={Inbox} tone="default" />
        <KpiTile label="자동 검증" value={stats.auto} icon={Bot} tone="info" />
        <KpiTile label="수동 검증" value={stats.manual} icon={UserIcon} tone="default" />
        <KpiTile label="감지 변경" value={stats.events} icon={Bell} tone={stats.events > 0 ? 'warning' : 'default'} />
        <NextRunTile
          nextRunAt={schedulerQuery.data?.next_run_at ?? null}
          slotLabel={schedulerQuery.data?.verify_slot_label}
        />
      </div>

      {/* 2) 필터 + 새로고침 */}
      <Card variant="white" className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={trigger === 'all'} onClick={() => setTrigger('all')}>
            전체 {stats.total}
          </FilterPill>
          <FilterPill active={trigger === 'scheduler'} onClick={() => setTrigger('scheduler')}>
            자동 {stats.auto}
          </FilterPill>
          <FilterPill active={trigger === 'manual'} onClick={() => setTrigger('manual')}>
            수동 {stats.manual}
          </FilterPill>

          <div className="flex-1" />

          <button
            onClick={() => runsQuery.refetch()}
            disabled={runsQuery.isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-subtle text-ink-muted text-caption font-medium hover:bg-brand-100 hover:text-brand-700 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={14} className={runsQuery.isFetching ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </Card>

      {/* 3) 회차별 타임라인 */}
      {runsQuery.isLoading ? (
        <Card variant="white" className="p-10 text-center">
          <div className="text-body-sm text-ink-muted">불러오는 중…</div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.date} className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <CalendarClock size={15} className="text-ink-muted" />
                <span className="text-body-sm font-bold text-ink">{group.label}</span>
                <span className="text-caption text-ink-muted">{group.items.length}회</span>
              </div>

              <div className="space-y-2">
                {group.items.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
 * KPI 타일
 * ────────────────────────────────────────────────────────────── */

function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ size?: number; className?: string }>
  tone: 'default' | 'info' | 'warning' | 'danger'
}) {
  return (
    <Card variant="white" className="p-3 sm:p-4">
      <div className="flex items-start justify-between">
        <div className="text-caption text-ink-muted">{label}</div>
        <Icon
          size={16}
          className={clsx(
            tone === 'info' && 'text-brand-500',
            tone === 'warning' && 'text-amber-500',
            tone === 'danger' && 'text-red-500',
            tone === 'default' && 'text-ink-soft',
          )}
        />
      </div>
      <div className="mt-2 text-2xl sm:text-h1 font-extrabold text-ink">{value}</div>
    </Card>
  )
}

function NextRunTile({
  nextRunAt,
  slotLabel,
}: {
  nextRunAt: string | null
  slotLabel?: string
}) {
  const label = useMemo(() => {
    if (!nextRunAt) return '—'
    const d = new Date(nextRunAt)
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [nextRunAt])

  const sub = useMemo(() => {
    if (!nextRunAt) return slotLabel ?? '—'
    const d = new Date(nextRunAt)
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    })
  }, [nextRunAt, slotLabel])

  return (
    <Card variant="dark" className="p-3 sm:p-4 col-span-2 md:col-span-1">
      <div className="flex items-start justify-between">
        <div className="text-caption text-white/70">다음 자동 검증</div>
        <Clock3 size={16} className="text-white/70" />
      </div>
      <div className="mt-2 text-2xl sm:text-h1 font-extrabold">{label}</div>
      <div className="mt-1 text-[11px] text-white/60 truncate">{sub}</div>
    </Card>
  )
}

/* ──────────────────────────────────────────────────────────────
 * 회차 1행 (메인)
 * ────────────────────────────────────────────────────────────── */

function RunRow({ run }: { run: VerificationRunOut }) {
  const isAuto = run.trigger === 'scheduler'
  const time = useMemo(() => {
    const d = new Date(run.started_at)
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }, [run.started_at])

  const okRate =
    run.total_count > 0 ? Math.round((run.ok_count / run.total_count) * 100) : 0

  // 결과 톤: 변경 발생 / DEAD 多 → warning, 모두 OK → success
  const hasIssue = run.events_count > 0 || run.dead_count > 0
  const tone = hasIssue ? 'warning' : 'success'

  return (
    <div
      className={clsx(
        'rounded-card border p-3 sm:p-4 transition-colors',
        tone === 'success' && 'bg-emerald-50/50 border-emerald-100 hover:bg-emerald-50',
        tone === 'warning' && 'bg-amber-50/50 border-amber-100 hover:bg-amber-50',
      )}
    >
      <div className="flex items-start gap-3">
        {/* 좌측 아이콘 */}
        <div
          className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            tone === 'success' && 'bg-emerald-100 text-emerald-600',
            tone === 'warning' && 'bg-amber-100 text-amber-600',
          )}
        >
          {isAuto ? <Bot size={20} /> : <PlayCircle size={20} />}
        </div>

        {/* 본문 */}
        <div className="min-w-0 flex-1">
          {/* 1행: 트리거 + 시각 + 모드 */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span
              className={clsx(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                isAuto ? 'bg-brand-100 text-brand-700' : 'bg-bg-subtle text-ink-muted',
              )}
            >
              {isAuto ? '자동' : '수동'}
            </span>
            {isAuto && run.slot_hour >= 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-bg-subtle text-ink-muted">
                슬롯 {String(run.slot_hour).padStart(2, '0')}시
              </span>
            )}
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-bg-subtle text-ink-muted uppercase">
              {run.mode}
            </span>
            <span className="text-caption text-ink-muted">· {time}</span>
          </div>

          {/* 2행: 핵심 통계 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5 text-body-sm">
            <Stat label="검증" value={run.total_count} bold />
            <Stat label="정상" value={run.ok_count} tone="success" />
            <Stat label="이상" value={run.dead_count} tone={run.dead_count > 0 ? 'danger' : 'muted'} />
            <Stat label="대기" value={run.pending_count} tone={run.pending_count > 0 ? 'warning' : 'muted'} />
            {run.events_count > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                <Bell size={12} /> 변경 {run.events_count}건
              </span>
            )}
          </div>

          {/* 3행: 진행 바 + 메타 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
              <div
                className={clsx(
                  'h-full transition-all',
                  okRate >= 95 ? 'bg-emerald-500' : okRate >= 80 ? 'bg-amber-500' : 'bg-red-500',
                )}
                style={{ width: `${okRate}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold text-ink-muted shrink-0">
              {okRate}%
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-ink-soft shrink-0">
              <Timer size={11} /> {formatElapsed(run.elapsed_ms)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  bold,
}: {
  label: string
  value: number
  tone?: 'success' | 'warning' | 'danger' | 'muted'
  bold?: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-caption text-ink-muted">{label}</span>
      <span
        className={clsx(
          bold ? 'text-body font-extrabold' : 'font-semibold',
          tone === 'success' && 'text-emerald-700',
          tone === 'warning' && 'text-amber-700',
          tone === 'danger' && 'text-red-700',
          tone === 'muted' && 'text-ink-muted',
          !tone && 'text-ink',
        )}
      >
        {value.toLocaleString()}
      </span>
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────
 * 보조 컴포넌트
 * ────────────────────────────────────────────────────────────── */

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 rounded-full text-caption font-semibold transition-colors',
        active
          ? 'bg-brand-800 text-white'
          : 'bg-bg-subtle text-ink-muted hover:bg-brand-100 hover:text-brand-700',
      )}
    >
      {children}
    </button>
  )
}

function EmptyState() {
  return (
    <Card variant="white" className="p-10 text-center">
      <div className="inline-flex w-14 h-14 rounded-2xl bg-bg-subtle items-center justify-center mb-3">
        <Activity className="text-ink-muted" size={26} />
      </div>
      <div className="text-body font-semibold text-ink mb-1">
        검증 회차가 없습니다
      </div>
      <div className="text-caption text-ink-muted">
        자동 검증은 매시 정각, 슬롯 시간에 자동 실행됩니다.<br />
        실시간 노출 관리 페이지에서 “지금 검증” 으로 즉시 실행할 수도 있습니다.
      </div>
    </Card>
  )
}

/* ──────────────────────────────────────────────────────────────
 * 헬퍼
 * ────────────────────────────────────────────────────────────── */

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${min}m ${s}s`
}

/** YYYY-MM-DD (KST) 키로 그룹핑 + 사람 친화 라벨 */
function groupByDateKST(runs: VerificationRunOut[]) {
  const map = new Map<string, VerificationRunOut[]>()
  const now = new Date()
  const todayKey = kstDateKey(now.toISOString())
  const yesterdayKey = kstDateKey(new Date(now.getTime() - 86400_000).toISOString())

  for (const r of runs) {
    const key = kstDateKey(r.started_at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))      // 최신 날짜부터
    .map(([key, items]) => ({
      date: key,
      label:
        key === todayKey
          ? `오늘 (${humanDate(key)})`
          : key === yesterdayKey
            ? `어제 (${humanDate(key)})`
            : humanDate(key),
      items: items.sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      ),
    }))
}

function kstDateKey(iso: string): string {
  const d = new Date(iso)
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000
  const kst = new Date(utc + 9 * 3600_000)
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const day = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function humanDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const w = ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} (${w})`
}
