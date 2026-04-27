/**
 * Monitor — Tab 2: 실시간 노출 확인
 *  ├─ 상단: 즉시 검증 실행 버튼 + 진행률 표시
 *  ├─ 4중 검증 결과 (생존 / 전화 / 동 / 상호)
 *  └─ 상세 결과 테이블 (등록값 vs 실제값 비교)
 */
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import { MOCK_PLACES } from './mockData'
import type { RegisteredPlace, Verdict, VerdictDetail } from './types'
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  MapPin,
  Building2,
  Activity,
  Clock,
  Zap,
} from 'lucide-react'

interface CheckResult extends RegisteredPlace {
  detail: VerdictDetail
  responseMs: number
}

export default function LiveCheckTab() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<CheckResult[]>([])
  const [stats, setStats] = useState<{ avgMs: number; total: number; throughput: number } | null>(null)

  const startCheck = async () => {
    setRunning(true)
    setProgress(0)
    setResults([])
    setStats(null)

    const targets = MOCK_PLACES
    const startedAt = Date.now()
    const collected: CheckResult[] = []

    // 병렬 처리 시뮬레이션 (mock)
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      // 실제 백엔드: place_id_checker_v3 호출 (Step B/D)
      await new Promise((r) => setTimeout(r, 220 + Math.random() * 100))

      const detail = mockVerdictDetail(p.currentVerdict, p)
      collected.push({
        ...p,
        detail,
        responseMs: 200 + Math.floor(Math.random() * 80),
      })
      setProgress(Math.round(((i + 1) / targets.length) * 100))
      setResults([...collected])
    }

    const totalMs = Date.now() - startedAt
    const avgMs = Math.round(
      collected.reduce((sum, r) => sum + r.responseMs, 0) / collected.length,
    )
    setStats({
      total: totalMs,
      avgMs,
      throughput: Math.round((collected.length / totalMs) * 1000 * 10) / 10,
    })
    setRunning(false)
  }

  const summary = {
    ok: results.filter((r) => r.currentVerdict === 'OK').length,
    warning: results.filter((r) =>
      ['DONG_MISMATCH', 'PHONE_MISMATCH', 'NAME_MISMATCH'].includes(r.currentVerdict),
    ).length,
    danger: results.filter((r) =>
      ['REGION_MISMATCH', 'DEAD'].includes(r.currentVerdict),
    ).length,
  }

  return (
    <div className="space-y-6">
      {/* ───── 즉시 검증 실행 패널 ───── */}
      <Card variant="dark" className="min-h-[180px]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/15 text-white/90 text-caption font-bold uppercase tracking-wider mb-3">
              <ShieldCheck size={12} /> live verification
            </span>
            <h3 className="text-h2 text-white mb-2">즉시 4중 검증 실행</h3>
            <p className="text-body-sm text-white/75">
              등록된 {MOCK_PLACES.length}개의 070 번호에 대해 플레이스 ID 기반
              실시간 검증을 수행합니다. 평균 0.2~0.3초/건.
            </p>
          </div>
          <button
            type="button"
            onClick={startCheck}
            disabled={running}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-pill bg-white text-brand-700 font-bold text-body shadow-card hover:shadow-card-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
          >
            {running ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                검증 진행 중… {progress}%
              </>
            ) : (
              <>
                <Play size={16} /> 지금 검증 시작
              </>
            )}
          </button>
        </div>

        {/* 진행률 바 */}
        {running && (
          <div className="mt-5">
            <div className="h-2 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-300 to-white rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* ───── 결과 요약 (검증 완료 시) ───── */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryStat
            icon={<CheckCircle2 size={16} />}
            label="정상 노출"
            value={summary.ok}
            tone="success"
          />
          <SummaryStat
            icon={<XCircle size={16} />}
            label="주의 (불일치)"
            value={summary.warning}
            tone="warning"
          />
          <SummaryStat
            icon={<XCircle size={16} />}
            label="심각 (지역/삭제)"
            value={summary.danger}
            tone="danger"
          />
          {stats && (
            <>
              <SummaryStat
                icon={<Clock size={16} />}
                label="평균 응답"
                value={`${stats.avgMs}`}
                unit="ms"
                tone="info"
              />
              <SummaryStat
                icon={<Zap size={16} />}
                label="처리량"
                value={`${stats.throughput}`}
                unit="req/s"
                tone="info"
              />
            </>
          )}
        </div>
      )}

      {/* ───── 상세 결과 테이블 ───── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">상세 검증 결과</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              {results.length === 0
                ? '"지금 검증 시작" 버튼을 눌러 실시간 검증을 수행하세요.'
                : `4중 검증: ✓ 페이지 생존 / ✓ 전화 일치 / ✓ 동 일치 / ✓ 상호 일치`}
            </p>
          </div>
          {stats && (
            <div className="text-caption text-ink-muted tabular-nums">
              총 {stats.total}ms 소요
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                  <th className="px-card-sm py-3 font-semibold">070 / Place ID</th>
                  <th className="px-3 py-3 font-semibold">등록값 → 실제값</th>
                  <th className="px-3 py-3 font-semibold">생존</th>
                  <th className="px-3 py-3 font-semibold">전화</th>
                  <th className="px-3 py-3 font-semibold">동</th>
                  <th className="px-3 py-3 font-semibold">상호</th>
                  <th className="px-3 py-3 font-semibold">판정</th>
                  <th className="px-card-sm py-3 font-semibold text-right">응답</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors align-top"
                  >
                    <td className="px-card-sm py-3">
                      <div className="text-ink font-semibold tabular-nums">{r.phone}</div>
                      <div className="text-caption text-ink-muted font-mono mt-0.5">
                        {r.placeId}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-caption">
                      <ComparisonRow
                        icon={<MapPin size={11} />}
                        expected={r.registeredDong}
                        actual={r.detail.actualDong ?? '—'}
                        match={r.detail.dongMatch}
                      />
                      <ComparisonRow
                        icon={<Building2 size={11} />}
                        expected={r.businessName}
                        actual={r.detail.actualName ?? '—'}
                        match={r.detail.nameMatch}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.alive} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.phoneMatch} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.dongMatch} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.nameMatch} />
                    </td>
                    <td className="px-3 py-3">
                      <VerdictBadge verdict={r.currentVerdict} />
                    </td>
                    <td className="px-card-sm py-3 text-right text-caption text-ink-muted tabular-nums">
                      {r.responseMs}ms
                    </td>
                  </tr>
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

function CheckIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 size={16} className="text-status-success" />
  ) : (
    <XCircle size={16} className="text-status-danger" />
  )
}

interface ComparisonRowProps {
  icon: React.ReactNode
  expected: string
  actual: string
  match: boolean
}

function ComparisonRow({ icon, expected, actual, match }: ComparisonRowProps) {
  return (
    <div className="flex items-center gap-1.5 mb-1 last:mb-0">
      <span className="text-ink-muted">{icon}</span>
      <span className="text-ink-muted">{expected}</span>
      <span className="text-ink-soft">→</span>
      <span className={match ? 'text-status-success font-medium' : 'text-status-danger font-medium'}>
        {actual}
      </span>
    </div>
  )
}

interface SummaryStatProps {
  icon: React.ReactNode
  label: string
  value: number | string
  unit?: string
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function SummaryStat({ icon, label, value, unit, tone }: SummaryStatProps) {
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
      </div>
      <div className="text-caption text-ink-muted mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-h2 text-ink tabular-nums leading-none">{value}</span>
        {unit && <span className="text-caption text-ink-muted">{unit}</span>}
      </div>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <div className="w-16 h-16 mx-auto rounded-card bg-brand-50 text-brand-500 flex items-center justify-center mb-4">
        <Activity size={28} />
      </div>
      <div className="text-body text-ink font-semibold mb-1">
        검증 결과가 아직 없습니다
      </div>
      <div className="text-caption text-ink-muted">
        상단의 "지금 검증 시작" 버튼을 누르면 4중 검증이 실행됩니다.
      </div>
    </div>
  )
}

/* ───────────── Mock helper ───────────── */

function mockVerdictDetail(verdict: Verdict, p: RegisteredPlace): VerdictDetail {
  switch (verdict) {
    case 'OK':
      return {
        alive: true,
        phoneMatch: true,
        dongMatch: true,
        nameMatch: true,
        actualPhone: p.phone,
        actualDong: p.registeredDong,
        actualName: p.businessName,
      }
    case 'DONG_MISMATCH':
      return {
        alive: true,
        phoneMatch: true,
        dongMatch: false,
        nameMatch: true,
        actualPhone: p.phone,
        actualDong: p.registeredDong.replace(/[가-힣]+동$/, '홍지동'),
        actualName: p.businessName,
      }
    case 'REGION_MISMATCH':
      return {
        alive: true,
        phoneMatch: true,
        dongMatch: false,
        nameMatch: true,
        actualPhone: p.phone,
        actualDong: '대구 달서구 두류동',
        actualName: p.businessName,
      }
    case 'NAME_MISMATCH':
      return {
        alive: true,
        phoneMatch: true,
        dongMatch: true,
        nameMatch: false,
        actualPhone: p.phone,
        actualDong: p.registeredDong,
        actualName: '다른상호',
      }
    case 'PHONE_MISMATCH':
      return {
        alive: true,
        phoneMatch: false,
        dongMatch: true,
        nameMatch: true,
        actualPhone: '02-000-0000',
        actualDong: p.registeredDong,
        actualName: p.businessName,
      }
    case 'DEAD':
      return {
        alive: false,
        phoneMatch: false,
        dongMatch: false,
        nameMatch: false,
      }
    default:
      return {
        alive: false,
        phoneMatch: false,
        dongMatch: false,
        nameMatch: false,
      }
  }
}

