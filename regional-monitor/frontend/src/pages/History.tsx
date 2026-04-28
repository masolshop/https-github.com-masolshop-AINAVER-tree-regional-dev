/**
 * History — 자동 노출 검증 관리 페이지
 *
 * 변경(2026-04-28): 개별 ChangeEvent 타임라인 → 자동검증 "회차별 요약" 카드
 *
 * 구성:
 *   1. 상단 KPI: 검증 횟수 / 마지막 OK·DEAD·PENDING / 다음 자동 검증 시각
 *   2. 필터 바: 자동/수동 토글 + 새로고침
 *   3. 회차 카드 리스트 (날짜별 그룹핑, 최근순)
 *      - 각 카드 = 자동검증 1회차 결과 요약
 *      - 시각, OK/DEAD/PENDING 분포, 변경 이벤트 수, 소요 시간
 *
 * 데이터:
 *   - useVerificationRuns(100): /api/v1/verification-runs
 *   - useSchedulerStatus(): 다음 자동 검증 시각
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  CalendarClock,
  Inbox,
  Activity,
  Bot,
  Hand,
  Bell,
  Timer,
} from 'lucide-react'
import clsx from 'clsx'

import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  useVerificationRuns,
  useSchedulerStatus,
} from '@/hooks/useEvents'
import type { VerificationRunOut } from '@/api/types'
import { formatKSTRelative } from '@/utils/datetime'

type TriggerFilter = 'all' | 'scheduler' | 'manual'

export default function History() {
  const runsQuery = useVerificationRuns(100)
  const schedulerQuery = useSchedulerStatus()

  const [trigger, setTrigger] = useState<TriggerFilter>('all')

  const allRuns = runsQuery.data?.items ?? []

  // 통계 (전체 기간)
  const stats = useMemo(() => {
    const stat = {
      total: allRuns.length,
      auto: 0,
      manual: 0,
      latest: allRuns[0] as VerificationRunOut | undefined,
    }
    for (const r of allRuns) {
      if (r.trigger === 'scheduler') stat.auto += 1
      else stat.manual += 1
    }
    return stat
  }, [allRuns])

  // 필터 적용
  const filtered = useMemo(() => {
    if (trigger === 'all') return allRuns
    return allRuns.filter((r) => r.trigger === trigger)
  }, [allRuns, trigger])

  // 날짜별 그룹핑 (KST 기준)
  const grouped = useMemo(() => groupByDateKST(filtered), [filtered])

  return (
    <div className="space-y-5">
      <TopBar
        title="자동 노출 검증 관리"
        subtitle="자동검증 회차별 요약을 시간순으로 확인합니다"
      />

      {/* 1) KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="총 검증 횟수" value={stats.total} tone="default" icon={Inbox} />
        <KpiTile label="자동" value={stats.auto} tone="info" icon={Bot} />
        <KpiTile label="수동" value={stats.manual} tone="default" icon={Hand} />
        <KpiTile
          label="최근 OK"
          value={stats.latest?.ok_count ?? 0}
          tone="success"
          icon={CheckCircle2}
        />
        <NextRunTile
          nextRunAt={schedulerQuery.data?.next_run_at ?? null}
          slotLabel={schedulerQuery.data?.verify_slot_label ?? ''}
        />
      </div>

      {/* 2) 필터 바 */}
      <Card variant="white" className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label={`전체 ${allRuns.length}`}
            active={trigger === 'all'}
            onClick={() => setTrigger('all')}
          />
          <FilterChip
            label={`자동 ${stats.auto}`}
            active={trigger === 'scheduler'}
            tone="info"
            onClick={() => setTrigger('scheduler')}
          />
          <FilterChip
            label={`수동 ${stats.manual}`}
            active={trigger === 'manual'}
            onClick={() => setTrigger('manual')}
          />

          <div className="ml-auto">
            <button
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isFetching}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-subtle hover:bg-brand-100 text-caption font-medium text-ink transition-colors disabled:opacity-60"
            >
              <RefreshCw size={14} className={clsx(runsQuery.isFetching && 'animate-spin')} />
              새로고침
            </button>
          </div>
        </div>
      </Card>

      {/* 3) 회차 목록 (날짜별 그룹) */}
      <div className="space-y-4">
        {runsQuery.isLoading ? (
          <Card variant="white" className="py-16 text-center">
            <RefreshCw className="mx-auto text-ink-muted animate-spin mb-3" size={28} />
            <div className="text-body text-ink-muted">불러오는 중…</div>
          </Card>
        ) : grouped.length === 0 ? (
          <EmptyState />
        ) : (
          grouped.map(({ date, runs }) => (
            <Card key={date} variant="white" className="p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-bg-subtle">
                <CalendarClock size={16} className="text-brand-500" />
                <span className="text-body-sm font-bold text-ink">{date}</span>
                <span className="text-caption text-ink-muted">{runs.length}회</span>
              </div>
              <div className="space-y-2.5">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

/* ─────────────── KPI 타일 ─────────────── */

function KpiTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: number
  tone: 'default' | 'danger' | 'warning' | 'info' | 'success'
  icon: React.ComponentType<{ size?: number; className?: string }>
}) {
  const palette: Record<typeof tone, string> = {
    default: 'bg-white text-ink',
    danger: 'bg-red-50 text-red-700',
    warning: 'bg-amber-50 text-amber-700',
    info: 'bg-emerald-50 text-emerald-700',
    success: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <div className={clsx('rounded-card-lg p-3 sm:p-4 shadow-card transition-colors', palette[tone])}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={14} className="opacity-70" />
        <span className="text-caption opacity-80">{label}</span>
      </div>
      <div className="text-2xl sm:text-3xl font-extrabold leading-none">{value}</div>
    </div>
  )
}

function NextRunTile({
  nextRunAt,
  slotLabel,
}: {
  nextRunAt: string | null
  slotLabel: string
}) {
  const time = nextRunAt ? formatKSTHour(nextRunAt) : '—'
  const date = nextRunAt ? formatKSTDate(nextRunAt) : ''

  return (
    <div className="rounded-card-lg p-3 sm:p-4 shadow-card-dark bg-brand-800 text-white">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Activity size={14} className="opacity-80" />
        <span className="text-caption opacity-80">다음 자동 검증</span>
      </div>
      <div className="text-2xl sm:text-3xl font-extrabold leading-none">{time}</div>
      <div className="text-[10px] sm:text-caption opacity-70 mt-1.5 truncate">
        {date} · {slotLabel || '슬롯 미배정'}
      </div>
    </div>
  )
}

/* ─────────────── 필터 칩 ─────────────── */

function FilterChip({
  label,
  active,
  onClick,
  tone = 'default',
}: {
  label: string
  active: boolean
  onClick: () => void
  tone?: 'default' | 'info'
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 rounded-pill text-caption font-semibold transition-colors',
        active
          ? tone === 'info'
            ? 'bg-emerald-600 text-white'
            : 'bg-brand-800 text-white'
          : 'bg-bg-subtle text-ink-muted hover:bg-brand-100 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

/* ─────────────── 회차 카드 ─────────────── */

function RunRow({ run }: { run: VerificationRunOut }) {
  const isAuto = run.trigger === 'scheduler'
  const time = formatKSTTime(run.started_at)
  const relative = formatKSTRelative(run.started_at, run.started_at)
  const elapsedSec = (run.elapsed_ms / 1000).toFixed(1)

  // 결과 톤 결정 (DEAD 가 있으면 danger, PENDING 만 있으면 warning, OK 만이면 success)
  const tone: 'success' | 'warning' | 'danger' = (() => {
    if (run.dead_count > 0) return 'danger'
    if (run.pending_count > 0) return 'warning'
    return 'success'
  })()

  const tonePalette = {
    success: 'bg-emerald-50 border-emerald-200',
    warning: 'bg-amber-50 border-amber-200',
    danger: 'bg-red-50 border-red-200',
  }
  const toneIcon = {
    success: <CheckCircle2 className="text-emerald-600" size={20} />,
    warning: <Clock className="text-amber-600" size={20} />,
    danger: <AlertTriangle className="text-red-600" size={20} />,
  }

  return (
    <div className={clsx('rounded-card border p-3 sm:p-4 transition-colors', tonePalette[tone])}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center">
          {toneIcon[tone]}
        </div>

        <div className="min-w-0 flex-1">
          {/* 헤더: 시간 + 자동/수동 배지 */}
          <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
            <span className="text-body-sm font-bold text-ink">{time}</span>
            <span
              className={clsx(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                isAuto
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-bg-subtle text-ink-muted',
              )}
            >
              {isAuto ? (
                <span className="inline-flex items-center gap-0.5">
                  <Bot size={10} /> 자동
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <Hand size={10} /> 수동
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-white/60 text-ink-muted">
              {run.mode === 'fast' ? '빠른검증' : '정밀검증'}
            </span>
            {run.events_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-100 text-red-700">
                <Bell size={10} /> 변경 {run.events_count}건
              </span>
            )}
          </div>

          {/* 본문: OK / DEAD / PENDING 분포 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm">
            <ResultPill
              icon={<CheckCircle2 size={12} />}
              label="정상"
              value={run.ok_count}
              tone="success"
            />
            {run.dead_count > 0 && (
              <ResultPill
                icon={<AlertTriangle size={12} />}
                label="비노출"
                value={run.dead_count}
                tone="danger"
              />
            )}
            {run.pending_count > 0 && (
              <ResultPill
                icon={<Clock size={12} />}
                label="대기"
                value={run.pending_count}
                tone="warning"
              />
            )}
            <span className="text-caption text-ink-soft">
              총 {run.total_count}건
            </span>
          </div>

          {/* 메타 정보 */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-ink-soft mt-1.5">
            <span className="inline-flex items-center gap-0.5">
              <Clock size={10} /> {relative}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5">
              <Timer size={10} /> {elapsedSec}초 소요
            </span>
            {isAuto && run.slot_hour >= 0 && (
              <>
                <span>·</span>
                <span>슬롯 {String(run.slot_hour).padStart(2, '0')}:00</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResultPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'success' | 'warning' | 'danger'
}) {
  const palette = {
    success: 'bg-white text-emerald-700',
    warning: 'bg-white text-amber-700',
    danger: 'bg-white text-red-700',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold',
        palette[tone],
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  )
}

function EmptyState() {
  return (
    <Card variant="white" className="py-16 text-center">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-bg-subtle items-center justify-center mb-4">
        <CheckCircle2 className="text-emerald-500" size={28} />
      </div>
      <div className="text-body font-bold text-ink mb-1">
        아직 검증 기록이 없습니다
      </div>
      <div className="text-body-sm text-ink-muted">
        자동 검증은 매일 슬롯 시각에 실행되며, 그 결과가 회차별로 표시됩니다
      </div>
    </Card>
  )
}

/* ─────────────── 유틸 ─────────────── */

function groupByDateKST(
  runs: VerificationRunOut[],
): { date: string; runs: VerificationRunOut[] }[] {
  const map = new Map<string, VerificationRunOut[]>()
  for (const r of runs) {
    const date = formatKSTDate(r.started_at)
    if (!map.has(date)) map.set(date, [])
    map.get(date)!.push(r)
  }
  // Map 은 입력 순서 유지 → 이미 최신순 정렬됨
  return Array.from(map.entries()).map(([date, runs]) => ({ date, runs }))
}

function formatKSTDate(iso: string): string {
  // ISO 문자열을 KST 로 변환해 "2026.04.28 (화)" 형태로
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${yyyy}.${mm}.${dd} (${days[d.getDay()]})`
}

function formatKSTTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mi}`
}

function formatKSTHour(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  return `${hh}:00`
}
