/**
 * History — 자동 노출 검증 관리 페이지
 *
 * 구성:
 *   1. 상단 KPI: 총 변경 건수 / 위험 / 경고 / 정상복귀 / 다음 자동 검증 시각
 *   2. 필터 바: severity 토글 + 검색어 + 새로고침
 *   3. 변경 이벤트 타임라인 (날짜별 그룹핑)
 *
 * 데이터:
 *   - useEvents(200): /api/v1/events?limit=200 (1분 polling)
 *   - useSchedulerStatus(): /api/v1/scheduler/status (KST 다음 실행 시각)
 *   - useMarkEventsRead(): "모두 읽음 처리"
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  CalendarClock,
  Eye,
  Inbox,
  ArrowRight,
} from 'lucide-react'
import clsx from 'clsx'

import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  useEvents,
  useUnreadCount,
  useMarkEventsRead,
  useSchedulerStatus,
} from '@/hooks/useEvents'
import { EVENT_TYPE_LABEL, formatRelative } from '@/components/layout/TopBar'
import type {
  ChangeEventOut,
  ChangeEventSeverity,
  ChangeEventType,
} from '@/api/types'

type SeverityFilter = 'all' | ChangeEventSeverity

export default function History() {
  const navigate = useNavigate()
  const eventsQuery = useEvents(200)
  const unreadQuery = useUnreadCount()
  const schedulerQuery = useSchedulerStatus()
  const markRead = useMarkEventsRead()

  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [search, setSearch] = useState('')

  const events = eventsQuery.data?.items ?? []

  // 통계 (필터 적용 전)
  const stats = useMemo(() => {
    const stat = { total: events.length, danger: 0, warning: 0, info: 0 }
    for (const e of events) {
      stat[e.severity] += 1
    }
    return stat
  }, [events])

  // 필터 적용
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (severity !== 'all' && e.severity !== severity) return false
      if (!q) return true
      return (
        e.business_name.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        EVENT_TYPE_LABEL[e.event_type]?.toLowerCase().includes(q)
      )
    })
  }, [events, severity, search])

  // 날짜별 그룹핑 (KST 기준)
  const grouped = useMemo(() => groupByDateKST(filtered), [filtered])

  return (
    <div className="space-y-5">
      <TopBar
        title="자동 노출 검증 관리"
        subtitle="자동 검증으로 감지된 노출 변경 이벤트를 시간순으로 확인합니다"
      />

      {/* 1) KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="전체 변경" value={stats.total} tone="default" icon={Inbox} />
        <KpiTile label="위험" value={stats.danger} tone="danger" icon={AlertTriangle} />
        <KpiTile label="경고" value={stats.warning} tone="warning" icon={AlertCircle} />
        <KpiTile label="정보" value={stats.info} tone="info" icon={CheckCircle2} />
        <NextRunTile
          nextRunAt={schedulerQuery.data?.next_run_at ?? null}
          slotLabel={schedulerQuery.data?.verify_slot_label}
        />
      </div>

      {/* 2) 필터 바 */}
      <Card variant="white" className="!py-4">
        <div className="flex flex-wrap items-center gap-3">
          <SeverityToggle current={severity} onChange={setSeverity} stats={stats} />

          <div className="flex-1 min-w-[220px] relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상호 / 070 번호 / 변경 내용 검색"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-bg-subtle border border-bg-subtle text-body-sm focus:bg-white focus:border-brand-400 focus:outline-none transition-colors"
            />
          </div>

          <button
            onClick={() => eventsQuery.refetch()}
            disabled={eventsQuery.isFetching}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-bg-subtle hover:bg-brand-100 text-body-sm font-medium text-ink transition-colors disabled:opacity-60"
          >
            <RefreshCw size={14} className={clsx(eventsQuery.isFetching && 'animate-spin')} />
            새로고침
          </button>

          {(unreadQuery.data?.unread ?? 0) > 0 && (
            <button
              onClick={() => markRead.mutate()}
              disabled={markRead.isPending}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-body-sm font-semibold transition-colors disabled:opacity-60"
            >
              <Eye size={14} /> 모두 읽음 ({unreadQuery.data?.unread})
            </button>
          )}
        </div>
      </Card>

      {/* 3) 타임라인 */}
      <Card variant="white" className="min-h-[300px]">
        {eventsQuery.isLoading ? (
          <div className="text-center py-16 text-ink-muted">불러오는 중…</div>
        ) : eventsQuery.isError ? (
          <div className="text-center py-16">
            <AlertTriangle className="mx-auto text-status-danger mb-2" size={32} />
            <div className="text-body font-semibold text-ink">이력을 불러오지 못했습니다</div>
            <div className="text-caption text-ink-muted mt-1">잠시 후 새로고침을 눌러주세요.</div>
          </div>
        ) : filtered.length === 0 ? (
          events.length === 0 ? (
            <EmptyAllOk onCta={() => navigate('/monitor')} />
          ) : (
            <div className="text-center py-16">
              <Search className="mx-auto text-ink-muted mb-2" size={32} />
              <div className="text-body font-semibold text-ink">
                필터 조건에 맞는 이벤트가 없습니다
              </div>
              <div className="text-caption text-ink-muted mt-1">
                필터를 해제하거나 다른 검색어를 시도해보세요.
              </div>
            </div>
          )
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.date}>
                <div className="flex items-center gap-2 mb-3 sticky top-0 bg-white py-1 z-10">
                  <CalendarClock size={14} className="text-ink-muted" />
                  <span className="text-body-sm font-bold text-ink">{group.label}</span>
                  <span className="text-caption text-ink-muted">{group.items.length}건</span>
                  <div className="flex-1 h-px bg-bg-subtle ml-2" />
                </div>
                <ul className="space-y-2">
                  {group.items.map((e) => (
                    <li key={e.id}>
                      <TimelineRow event={e} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   KPI 타일
 * ═══════════════════════════════════════════════════════════════════ */

type Tone = 'default' | 'danger' | 'warning' | 'info'

const TONE_CLASS: Record<Tone, string> = {
  default: 'bg-white text-ink',
  danger:  'bg-red-50 text-red-700 border-red-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  info:    'bg-emerald-50 text-emerald-700 border-emerald-100',
}

function KpiTile({
  label, value, tone, icon: Icon,
}: {
  label: string
  value: number
  tone: Tone
  icon: React.ComponentType<{ size?: number; className?: string }>
}) {
  return (
    <div className={clsx(
      'rounded-card p-4 shadow-card border border-transparent',
      TONE_CLASS[tone],
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} />
        <div className="text-caption font-medium opacity-80">{label}</div>
      </div>
      <div className="text-h2 font-extrabold tabular-nums">{value.toLocaleString()}</div>
    </div>
  )
}

function NextRunTile({
  nextRunAt, slotLabel,
}: { nextRunAt: string | null; slotLabel?: string }) {
  const time = nextRunAt ? formatKstTime(nextRunAt) : '—'
  const date = nextRunAt ? formatKstDate(nextRunAt) : ''

  return (
    <div className="rounded-card p-4 bg-brand-800 text-white shadow-card-dark">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock size={14} />
        <div className="text-caption font-medium opacity-80">다음 자동 검증</div>
      </div>
      <div className="text-h3 font-extrabold tabular-nums">{time}</div>
      <div className="text-caption opacity-70 mt-0.5 truncate">
        {date} · {slotLabel ?? 'KST'}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Severity 토글
 * ═══════════════════════════════════════════════════════════════════ */

function SeverityToggle({
  current, onChange, stats,
}: {
  current: SeverityFilter
  onChange: (s: SeverityFilter) => void
  stats: { total: number; danger: number; warning: number; info: number }
}) {
  const items: Array<{ key: SeverityFilter; label: string; count: number; cls: string }> = [
    { key: 'all',     label: '전체', count: stats.total,   cls: 'bg-ink text-white' },
    { key: 'danger',  label: '위험', count: stats.danger,  cls: 'bg-red-500 text-white' },
    { key: 'warning', label: '경고', count: stats.warning, cls: 'bg-amber-500 text-white' },
    { key: 'info',    label: '정보', count: stats.info,    cls: 'bg-emerald-500 text-white' },
  ]
  return (
    <div className="flex items-center gap-1.5">
      {items.map((it) => {
        const active = current === it.key
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className={clsx(
              'px-3 py-1.5 rounded-pill text-caption font-semibold transition-all',
              active
                ? `${it.cls} shadow-card`
                : 'bg-bg-subtle text-ink-muted hover:text-ink',
            )}
          >
            {it.label} <span className="opacity-70">{it.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   타임라인 행
 * ═══════════════════════════════════════════════════════════════════ */

function TimelineRow({ event }: { event: ChangeEventOut }) {
  const Icon = severityIcon(event.severity)
  return (
    <div className={clsx(
      'rounded-2xl p-4 border transition-colors',
      event.severity === 'danger' && 'bg-red-50 border-red-100 hover:bg-red-100/60',
      event.severity === 'warning' && 'bg-amber-50 border-amber-100 hover:bg-amber-100/60',
      event.severity === 'info' && 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100/60',
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          event.severity === 'danger' && 'bg-red-500 text-white',
          event.severity === 'warning' && 'bg-amber-500 text-white',
          event.severity === 'info' && 'bg-emerald-500 text-white',
        )}>
          <Icon size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-body font-bold text-ink truncate">
              {event.business_name || '이름 없음'}
            </span>
            <span className="text-caption font-mono text-ink-muted">{event.phone}</span>
            <span className={clsx(
              'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
              event.severity === 'danger' && 'bg-red-200 text-red-800',
              event.severity === 'warning' && 'bg-amber-200 text-amber-800',
              event.severity === 'info' && 'bg-emerald-200 text-emerald-800',
            )}>
              {EVENT_TYPE_LABEL[event.event_type] ?? event.event_type}
            </span>
          </div>

          <p className="text-body-sm text-ink mb-1.5">{event.summary}</p>

          <div className="flex items-center gap-3 text-caption text-ink-muted">
            <span className="flex items-center gap-1">
              <Clock size={11} /> {formatRelative(event.detected_at)}
            </span>
            <span className="flex items-center gap-1">
              <span className="font-mono">{event.prev_verdict}</span>
              <ArrowRight size={11} />
              <span className="font-mono font-semibold text-ink">{event.new_verdict}</span>
            </span>
            <span className="text-ink-soft hidden sm:inline">
              · {formatKstFull(event.detected_at)} KST
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyAllOk({ onCta }: { onCta: () => void }) {
  return (
    <div className="text-center py-12">
      <div className="inline-flex w-16 h-16 rounded-3xl bg-emerald-50 items-center justify-center mb-4">
        <CheckCircle2 className="text-status-success" size={32} />
      </div>
      <div className="text-h3 font-bold text-ink mb-1">변경 이벤트가 없습니다</div>
      <p className="text-body-sm text-ink-muted mb-5">
        등록된 070 번호의 노출이 모두 정상 상태로 유지되고 있어요.
      </p>
      <button
        onClick={onCta}
        className="btn-primary"
      >
        실시간 노출 관리로 이동 <ArrowRight size={16} />
      </button>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   유틸 — KST 포맷 + 그룹핑
 * ═══════════════════════════════════════════════════════════════════ */

function severityIcon(s: ChangeEventSeverity) {
  if (s === 'danger') return AlertTriangle
  if (s === 'warning') return AlertCircle
  return CheckCircle2
}

/** 모든 시각은 KST 기준으로 표기 */
function formatKstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
function formatKstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })
}
function formatKstFull(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** YYYY-MM-DD (KST) 키로 그룹핑 + 사람 친화 라벨 */
function groupByDateKST(events: ChangeEventOut[]) {
  const map = new Map<string, ChangeEventOut[]>()
  const now = new Date()
  const todayKey = kstDateKey(now.toISOString())
  const yesterdayKey = kstDateKey(new Date(now.getTime() - 86400_000).toISOString())

  for (const e of events) {
    const key = kstDateKey(e.detected_at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
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
        (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
      ),
    }))
}

function kstDateKey(iso: string): string {
  // KST 기준 YYYY-MM-DD
  const d = new Date(iso)
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000
  const kst = new Date(utc + 9 * 3600_000)
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const day = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function humanDate(key: string): string {
  // 2026-04-27 → "2026.04.27 (월)"
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const w = ['일','월','화','수','목','금','토'][date.getUTCDay()]
  return `${y}.${String(m).padStart(2,'0')}.${String(d).padStart(2,'0')} (${w})`
}

// type 미사용 import 방지
export type _T = ChangeEventType
