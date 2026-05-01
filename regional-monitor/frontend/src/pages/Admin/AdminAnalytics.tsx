/**
 * Admin Analytics — 방문자 분석 (GA4 Data API)
 *
 * 슈퍼어드민 전용. 6개 위젯:
 *  · 요약 KPI 카드 (활성 사용자/신규/세션/PV/이탈률/평균 세션 시간)
 *  · 시계열 영역 차트 (활성 사용자, 세션, PV)
 *  · 상위 페이지 표
 *  · 국가별 표 + 막대
 *  · 디바이스 분포
 *  · 유입 채널/소스
 *  · 실시간 (지난 30분)
 *
 * GA4 미설정(서비스 계정 키/Property ID 미주입) 시 안내 화면을 표시.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Globe2,
  MonitorSmartphone,
  RefreshCw,
  TrendingUp,
  Users,
  ExternalLink,
  Settings,
  ArrowUpRight,
} from 'lucide-react'

import {
  AdminAnalyticsApi,
  GaRange,
  GaTimeseriesRow,
} from '@/api/adminAnalytics'

// ──────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '-'
  return new Intl.NumberFormat('ko-KR').format(Math.round(n))
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0초'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m > 0) return `${m}분 ${s}초`
  return `${s}초`
}

function formatPercent(v: number): string {
  if (!v && v !== 0) return '-'
  return `${(v * 100).toFixed(1)}%`
}

const RANGE_OPTIONS: { value: GaRange; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: '7daysAgo', label: '최근 7일' },
  { value: '14daysAgo', label: '최근 14일' },
  { value: '28daysAgo', label: '최근 28일' },
  { value: '90daysAgo', label: '최근 90일' },
]

// ──────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────────────────────

export function AdminAnalytics() {
  const [range, setRange] = useState<GaRange>('7daysAgo')
  const [tsRange, setTsRange] = useState<GaRange>('28daysAgo')

  // GA4 설정 상태
  const healthQ = useQuery({
    queryKey: ['adminAnalyticsHealth'],
    queryFn: () => AdminAnalyticsApi.health(),
    staleTime: 60_000,
  })

  // 미설정이면 모든 위젯을 비활성화
  const isConfigured = !!healthQ.data?.configured

  const summaryQ = useQuery({
    queryKey: ['adminAnalyticsSummary', range],
    queryFn: () => AdminAnalyticsApi.summary(range),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  const timeseriesQ = useQuery({
    queryKey: ['adminAnalyticsTimeseries', tsRange],
    queryFn: () => AdminAnalyticsApi.timeseries(tsRange),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  const pagesQ = useQuery({
    queryKey: ['adminAnalyticsPages', range],
    queryFn: () => AdminAnalyticsApi.pages(range, 15),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  const countriesQ = useQuery({
    queryKey: ['adminAnalyticsCountries', range],
    queryFn: () => AdminAnalyticsApi.countries(range, 12),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  const devicesQ = useQuery({
    queryKey: ['adminAnalyticsDevices', range],
    queryFn: () => AdminAnalyticsApi.devices(range),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  const sourcesQ = useQuery({
    queryKey: ['adminAnalyticsSources', range],
    queryFn: () => AdminAnalyticsApi.sources(range, 12),
    enabled: isConfigured,
    staleTime: 30_000,
  })

  // 실시간(30초마다 자동 갱신)
  const realtimeQ = useQuery({
    queryKey: ['adminAnalyticsRealtime'],
    queryFn: () => AdminAnalyticsApi.realtime(),
    enabled: isConfigured,
    refetchInterval: 30_000,
  })

  const isAnyLoading =
    summaryQ.isFetching ||
    timeseriesQ.isFetching ||
    pagesQ.isFetching ||
    countriesQ.isFetching ||
    devicesQ.isFetching ||
    sourcesQ.isFetching

  const refetchAll = () => {
    summaryQ.refetch()
    timeseriesQ.refetch()
    pagesQ.refetch()
    countriesQ.refetch()
    devicesQ.refetch()
    sourcesQ.refetch()
    realtimeQ.refetch()
  }

  // 미설정 안내 화면
  if (healthQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> GA4 설정 확인 중…
      </div>
    )
  }

  if (!isConfigured) {
    return <NotConfiguredCard />
  }

  return (
    <div className="space-y-6">
      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-muted">기간:</span>
          <div className="flex gap-1 rounded-card bg-bg-subtle p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  range === opt.value
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">
            GA4 Property: <code className="font-mono">{healthQ.data?.property_id || '-'}</code>
          </span>
          <button
            onClick={refetchAll}
            disabled={isAnyLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-sm hover:bg-bg-subtle disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isAnyLoading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      {/* 1. 요약 KPI */}
      <SummaryKpis summary={summaryQ.data} loading={summaryQ.isLoading} />

      {/* 2. 시계열 + 실시간 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <TimeseriesChart
            rows={timeseriesQ.data || []}
            loading={timeseriesQ.isLoading}
            range={tsRange}
            onRangeChange={setTsRange}
          />
        </div>
        <RealtimeCard data={realtimeQ.data} />
      </div>

      {/* 3. 상위 페이지 + 국가별 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopPagesCard rows={pagesQ.data || []} loading={pagesQ.isLoading} />
        <CountriesCard rows={countriesQ.data || []} loading={countriesQ.isLoading} />
      </div>

      {/* 4. 디바이스 + 유입 채널 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DevicesCard rows={devicesQ.data || []} loading={devicesQ.isLoading} />
        <SourcesCard rows={sourcesQ.data || []} loading={sourcesQ.isLoading} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 미설정 안내 카드
// ──────────────────────────────────────────────────────────────

function NotConfiguredCard() {
  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-lg font-bold text-amber-900 mb-1">
            GA4 데이터 API가 아직 설정되지 않았습니다
          </h3>
          <p className="text-sm text-amber-800 mb-4">
            방문자 분석 대시보드를 사용하려면 다음 환경변수를 백엔드에 주입해야 합니다.
          </p>
          <div className="bg-white rounded-md border border-amber-200 p-4 space-y-2 font-mono text-xs">
            <div>
              <span className="text-amber-700 font-bold">GA4_PROPERTY_ID</span>=
              <span className="text-ink">486271234</span>{' '}
              <span className="text-ink-muted">— GA4 속성 ID(숫자)</span>
            </div>
            <div>
              <span className="text-amber-700 font-bold">GA4_CREDENTIALS_FILE</span>=
              <span className="text-ink">/etc/regionwatch/ga4-sa.json</span>{' '}
              <span className="text-ink-muted">— 서비스 계정 JSON 키 경로</span>
            </div>
            <div className="text-ink-muted">또는</div>
            <div>
              <span className="text-amber-700 font-bold">GA4_CREDENTIALS_JSON</span>=
              <span className="text-ink">{`{"type":"service_account",...}`}</span>{' '}
              <span className="text-ink-muted">— JSON 본문 자체</span>
            </div>
            <div className="pt-2 border-t border-amber-100">
              <span className="text-amber-700 font-bold">VITE_GA_MEASUREMENT_ID</span>=
              <span className="text-ink">G-XXXXXXXXXX</span>{' '}
              <span className="text-ink-muted">— 프론트엔드 gtag 측정 ID(빌드 시)</span>
            </div>
          </div>
          <div className="mt-4 space-y-1.5 text-sm text-amber-900">
            <p className="flex items-start gap-2">
              <Settings className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Google Cloud Console에서 <strong>서비스 계정</strong>을 생성한 뒤,
                GA4 <strong>관리자 → 속성 → 속성 액세스 관리</strong>에서 해당 계정 이메일에
                "뷰어" 권한을 부여하세요.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ExternalLink className="h-4 w-4 mt-0.5 shrink-0" />
              <a
                href="https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-client-libraries"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-amber-700"
              >
                GA4 Data API Quickstart 문서
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 요약 KPI 카드
// ──────────────────────────────────────────────────────────────

interface SummaryKpisProps {
  summary?: {
    active_users: number
    new_users: number
    sessions: number
    page_views: number
    bounce_rate: number
    avg_session_seconds: number
  }
  loading: boolean
}

function SummaryKpis({ summary, loading }: SummaryKpisProps) {
  const cards = [
    { label: '활성 사용자', value: formatNumber(summary?.active_users), icon: <Users className="h-5 w-5" />, accent: 'from-brand-400 to-brand-600' },
    { label: '신규 사용자', value: formatNumber(summary?.new_users), icon: <ArrowUpRight className="h-5 w-5" />, accent: 'from-emerald-400 to-emerald-600' },
    { label: '세션 수', value: formatNumber(summary?.sessions), icon: <Activity className="h-5 w-5" />, accent: 'from-cyan-400 to-cyan-600' },
    { label: '페이지뷰', value: formatNumber(summary?.page_views), icon: <BarChart3 className="h-5 w-5" />, accent: 'from-violet-400 to-violet-600' },
    { label: '이탈률', value: summary ? formatPercent(summary.bounce_rate) : '-', icon: <TrendingUp className="h-5 w-5" />, accent: 'from-amber-400 to-amber-600' },
    { label: '평균 세션 시간', value: summary ? formatDuration(summary.avg_session_seconds) : '-', icon: <Activity className="h-5 w-5" />, accent: 'from-rose-400 to-rose-600' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-card bg-white p-4 shadow-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-ink-muted">{c.label}</span>
            <span className={`p-1.5 rounded-md text-white bg-gradient-to-br ${c.accent}`}>
              {c.icon}
            </span>
          </div>
          <div className="text-2xl font-bold text-ink leading-tight">
            {loading ? '…' : c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 시계열 차트 (순수 SVG)
// ──────────────────────────────────────────────────────────────

interface TimeseriesProps {
  rows: GaTimeseriesRow[]
  loading: boolean
  range: GaRange
  onRangeChange: (r: GaRange) => void
}

function TimeseriesChart({ rows, loading, range, onRangeChange }: TimeseriesProps) {
  const [metric, setMetric] = useState<'active_users' | 'sessions' | 'page_views'>('active_users')

  const points = useMemo(() => {
    if (!rows.length) return []
    return rows.map((r) => ({
      date: r.date,
      value: r[metric],
    }))
  }, [rows, metric])

  const max = Math.max(1, ...points.map((p) => p.value))
  const W = 800
  const H = 240
  const PAD = { top: 16, right: 16, bottom: 28, left: 44 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const xFor = (i: number) =>
    points.length > 1
      ? PAD.left + (innerW * i) / (points.length - 1)
      : PAD.left + innerW / 2
  const yFor = (v: number) => PAD.top + innerH - (innerH * v) / max

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.value)}`)
    .join(' ')
  const areaPath = points.length
    ? `${linePath} L ${xFor(points.length - 1)} ${PAD.top + innerH} L ${xFor(0)} ${PAD.top + innerH} Z`
    : ''

  // x축 라벨 — 6개 정도로 샘플링
  const xLabelIdx = useMemo(() => {
    if (points.length <= 1) return [0]
    const n = Math.min(6, points.length)
    return Array.from({ length: n }, (_, i) =>
      Math.round((i * (points.length - 1)) / (n - 1)),
    )
  }, [points])

  const metricColor = {
    active_users: { stroke: '#3b82f6', fill: '#bfdbfe' },
    sessions: { stroke: '#10b981', fill: '#a7f3d0' },
    page_views: { stroke: '#8b5cf6', fill: '#ddd6fe' },
  }[metric]

  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-ink">방문자 시계열</h3>
          <p className="text-xs text-ink-muted">일자별 사용자 활동 추이</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md bg-bg-subtle p-0.5">
            {([
              { k: 'active_users', label: '활성 사용자' },
              { k: 'sessions', label: '세션' },
              { k: 'page_views', label: 'PV' },
            ] as const).map((opt) => (
              <button
                key={opt.k}
                onClick={() => setMetric(opt.k)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  metric === opt.k ? 'bg-white shadow-sm text-ink' : 'text-ink-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select
            value={range}
            onChange={(e) => onRangeChange(e.target.value as GaRange)}
            className="text-xs border border-line rounded-md px-2 py-1 bg-white"
          >
            {RANGE_OPTIONS.filter((o) => o.value !== 'today' && o.value !== 'yesterday').map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="h-[240px] flex items-center justify-center text-ink-muted text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> 데이터 로딩 중…
          </div>
        ) : !points.length ? (
          <div className="h-[240px] flex items-center justify-center text-ink-muted text-sm">
            데이터가 없습니다.
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
            {/* y축 그리드 */}
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
              const y = PAD.top + innerH * (1 - p)
              return (
                <g key={i}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={PAD.left + innerW}
                    y2={y}
                    stroke="#e5e7eb"
                    strokeDasharray="3 3"
                  />
                  <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#6b7280">
                    {formatNumber(max * p)}
                  </text>
                </g>
              )
            })}
            {/* x축 라벨 */}
            {xLabelIdx.map((i) => (
              <text
                key={i}
                x={xFor(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                fill="#6b7280"
              >
                {points[i]?.date.slice(5)}
              </text>
            ))}
            {/* 영역 */}
            <path d={areaPath} fill={metricColor.fill} opacity={0.5} />
            {/* 라인 */}
            <path d={linePath} fill="none" stroke={metricColor.stroke} strokeWidth={2} />
            {/* 점 */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={xFor(i)}
                cy={yFor(p.value)}
                r={2.5}
                fill={metricColor.stroke}
              >
                <title>{`${p.date}: ${formatNumber(p.value)}`}</title>
              </circle>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 실시간 카드
// ──────────────────────────────────────────────────────────────

function RealtimeCard({ data }: { data?: { active_users_30min: number; by_country: { country: string; active_users: number }[] } }) {
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (data) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 1000)
      return () => clearTimeout(t)
    }
  }, [data?.active_users_30min])

  return (
    <div className="rounded-card bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-card-dark">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-white/70">실시간</div>
          <div className="text-sm font-medium">지난 30분</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full bg-emerald-400 ${pulse ? 'animate-ping' : ''}`} />
          <span className="text-xs">LIVE</span>
        </div>
      </div>
      <div className="text-5xl font-bold leading-none mb-1">
        {formatNumber(data?.active_users_30min ?? 0)}
      </div>
      <div className="text-xs text-white/70 mb-4">활성 사용자</div>

      <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
        {(data?.by_country || []).slice(0, 6).map((c, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="truncate">{c.country || '(unknown)'}</span>
            <span className="font-bold">{formatNumber(c.active_users)}</span>
          </div>
        ))}
        {!data?.by_country?.length && (
          <div className="text-xs text-white/50">활동 사용자가 없습니다.</div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 상위 페이지
// ──────────────────────────────────────────────────────────────

function TopPagesCard({
  rows,
  loading,
}: {
  rows: { path: string; title: string; page_views: number; active_users: number; avg_session_seconds: number }[]
  loading: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.page_views))
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <h3 className="text-base font-bold text-ink mb-3">상위 페이지</h3>
      {loading ? (
        <div className="text-sm text-ink-muted">로딩 중…</div>
      ) : !rows.length ? (
        <div className="text-sm text-ink-muted">데이터가 없습니다.</div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink truncate">{r.title || '(제목 없음)'}</div>
                  <div className="font-mono text-ink-muted truncate">{r.path}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-ink">{formatNumber(r.page_views)}</div>
                  <div className="text-ink-muted">PV</div>
                </div>
              </div>
              <div className="h-1.5 bg-bg-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full"
                  style={{ width: `${(r.page_views / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 국가별
// ──────────────────────────────────────────────────────────────

function CountriesCard({
  rows,
  loading,
}: {
  rows: { country: string; active_users: number; sessions: number }[]
  loading: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.active_users))
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <h3 className="text-base font-bold text-ink mb-3 flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-brand-500" />
        국가별 사용자
      </h3>
      {loading ? (
        <div className="text-sm text-ink-muted">로딩 중…</div>
      ) : !rows.length ? (
        <div className="text-sm text-ink-muted">데이터가 없습니다.</div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-ink truncate">{r.country || '(unknown)'}</span>
                <span className="font-bold">{formatNumber(r.active_users)}</span>
              </div>
              <div className="h-2 bg-bg-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                  style={{ width: `${(r.active_users / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 디바이스
// ──────────────────────────────────────────────────────────────

function DevicesCard({
  rows,
  loading,
}: {
  rows: { device: string; active_users: number; sessions: number }[]
  loading: boolean
}) {
  const total = rows.reduce((s, r) => s + r.active_users, 0)
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <h3 className="text-base font-bold text-ink mb-3 flex items-center gap-2">
        <MonitorSmartphone className="h-4 w-4 text-brand-500" />
        디바이스 분포
      </h3>
      {loading ? (
        <div className="text-sm text-ink-muted">로딩 중…</div>
      ) : !rows.length || !total ? (
        <div className="text-sm text-ink-muted">데이터가 없습니다.</div>
      ) : (
        <>
          {/* 막대 (스택형) */}
          <div className="flex h-4 rounded-full overflow-hidden mb-3">
            {rows.map((r, i) => (
              <div
                key={r.device}
                className="h-full"
                style={{
                  width: `${(r.active_users / total) * 100}%`,
                  background: colors[i % colors.length],
                }}
                title={`${r.device}: ${r.active_users}`}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={r.device} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: colors[i % colors.length] }}
                  />
                  <span className="font-semibold text-ink">{r.device}</span>
                </div>
                <div className="flex gap-3 text-ink-muted">
                  <span>{formatNumber(r.active_users)}명</span>
                  <span className="font-bold text-ink">
                    {((r.active_users / total) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// 유입 채널/소스
// ──────────────────────────────────────────────────────────────

function SourcesCard({
  rows,
  loading,
}: {
  rows: { channel: string; source: string; active_users: number; sessions: number }[]
  loading: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.active_users))
  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <h3 className="text-base font-bold text-ink mb-3">유입 채널 / 소스</h3>
      {loading ? (
        <div className="text-sm text-ink-muted">로딩 중…</div>
      ) : !rows.length ? (
        <div className="text-sm text-ink-muted">데이터가 없습니다.</div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{r.channel}</span>
                  <span className="ml-1.5 text-ink-muted truncate">/ {r.source}</span>
                </div>
                <span className="font-bold ml-2 shrink-0">{formatNumber(r.active_users)}</span>
              </div>
              <div className="h-1.5 bg-bg-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-400 to-violet-600"
                  style={{ width: `${(r.active_users / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
