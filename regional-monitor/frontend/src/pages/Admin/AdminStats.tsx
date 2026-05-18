/**
 * 어드민 대시보드 — 시스템 전체 통계.
 */
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, BadgeDollarSign, MapPin, Users, Zap } from 'lucide-react'

import { adminApi } from '@/api/admin'
import { Card } from '@/components/ui/Card'

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-slate-100 text-slate-700',
  basic: 'bg-sky-100 text-sky-700',
  pro: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-800',
}

function formatKRW(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원'
}

export function AdminStats() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: adminApi.stats,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-28 animate-pulse bg-slate-50">
            <span className="sr-only">로딩 중</span>
          </Card>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="border-rose-200 bg-rose-50 p-6 text-rose-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" /> 통계 로드 실패
        </div>
        <div className="mt-1 text-sm">{(error as Error)?.message ?? '알 수 없는 오류'}</div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI 행 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPI
          icon={<Users className="h-5 w-5 text-brand-500" />}
          label="전체 회원"
          value={data.users_total.toLocaleString()}
          sub={`활성 ${data.users_active.toLocaleString()} · 차단 ${data.users_blocked.toLocaleString()}`}
        />
        <KPI
          icon={<MapPin className="h-5 w-5 text-emerald-500" />}
          label="등록 070"
          value={data.places_total.toLocaleString()}
        />
        <KPI
          icon={<Zap className="h-5 w-5 text-amber-500" />}
          label="최근 24h 검증"
          value={data.last_24h_checks.toLocaleString()}
          sub={`이벤트 ${data.events_unread} (24h) / 누적 ${data.events_total}`}
        />
        <KPI
          icon={<BadgeDollarSign className="h-5 w-5 text-violet-500" />}
          label="누적 매출"
          value={formatKRW(data.revenue_paid_krw)}
          sub={`결제 ${data.payments_total}건`}
        />
      </div>

      {/* 플랜별 분포 */}
      <Card className="p-6">
        <h3 className="text-base font-bold text-ink">플랜 분포</h3>
        <p className="mt-1 text-sm text-ink-muted">현재 가입 회원의 플랜별 분포</p>

        <div className="mt-5 space-y-3">
          {Object.entries(PLAN_LABEL).map(([key, label]) => {
            const count = data.users_by_plan[key] ?? 0
            const pct = data.users_total
              ? Math.round((count / data.users_total) * 100)
              : 0
            return (
              <div key={key} className="flex items-center gap-3">
                <span
                  className={`inline-flex h-6 min-w-[88px] items-center justify-center rounded-full px-3 text-xs font-bold ${PLAN_COLOR[key]}`}
                >
                  {label}
                </span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-brand-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-20 text-right text-sm font-semibold text-ink">
                  {count.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-ink-muted">({pct}%)</span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 시스템 활동 요약 */}
      <Card className="p-6">
        <h3 className="text-base font-bold text-ink">시스템 활동</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat icon={<Activity />} label="전체 변경 이벤트" value={data.events_total.toLocaleString()} />
          <Stat icon={<Activity />} label="최근 24h 신규 이벤트" value={data.events_unread.toLocaleString()} />
          <Stat icon={<Activity />} label="결제 트랜잭션" value={data.payments_total.toLocaleString()} />
        </div>
      </Card>
    </div>
  )
}


function KPI({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <span className="rounded-lg bg-slate-50 p-2">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-extrabold text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
    </Card>
  )
}


function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-brand-500">
        {icon}
      </span>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-base font-bold text-ink">{value}</div>
      </div>
    </div>
  )
}
