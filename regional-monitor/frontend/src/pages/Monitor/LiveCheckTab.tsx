/**
 * Monitor — Tab 2: 실시간 노출 확인 (실 API 연동)
 *  ├─ 상단: 즉시 검증 실행 버튼 + 진행 상태(요청 inflight)
 *  ├─ 4중 검증 결과 요약 (정상/주의/심각 + 평균응답/처리량)
 *  └─ 상세 결과 테이블 (등록값 vs 실제값 비교)
 *
 * 백엔드 호출:
 *   POST /api/v1/verify/live    body { place_ids: number[] | null }
 *   place_ids === null  → 전체 등록 검증
 */
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import { useLiveCheck } from '@/hooks/useLiveCheck'
import { usePlacesList } from '@/hooks/usePlaces'
import { ApiError } from '@/api/client'
import type { VerificationResult } from '@/api/types'
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
  AlertTriangle,
} from 'lucide-react'

export default function LiveCheckTab() {
  const { data: placesData } = usePlacesList()
  const liveCheck = useLiveCheck()

  const totalRegistered = placesData?.summary.total ?? 0
  const running = liveCheck.isPending
  const apiResp = liveCheck.data
  const results: VerificationResult[] = apiResp?.results ?? []
  const error = liveCheck.error

  const summary = apiResp?.summary ?? { ok: 0, warning: 0, danger: 0 }

  const startCheck = () => {
    if (totalRegistered === 0) {
      alert('등록된 070 번호가 없습니다. 먼저 "등록 관리" 탭에서 등록해 주세요.')
      return
    }
    // 전체 검증 (place_ids 미지정 → 백엔드가 모든 등록 검증)
    liveCheck.mutate({})
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
              등록된 <span className="font-bold text-white">{totalRegistered}</span>개의 070
              번호에 대해 플레이스 ID 기반 4중 검증을 수행합니다.
              <br />
              평균 0.4~0.7초/건 (백엔드 동시 8요청 병렬).
            </p>
          </div>
          <button
            type="button"
            onClick={startCheck}
            disabled={running || totalRegistered === 0}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-pill bg-white text-brand-700 font-bold text-body shadow-card hover:shadow-card-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
          >
            {running ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                검증 진행 중…
              </>
            ) : (
              <>
                <Play size={16} /> 지금 검증 시작
              </>
            )}
          </button>
        </div>

        {/* 진행 인디케이터 (백엔드는 일괄 응답이라 부정형 진행률 대신 펄스 바) */}
        {running && (
          <div className="mt-5">
            <div className="h-2 bg-white/15 rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-gradient-to-r from-brand-300 to-white rounded-full animate-pulse" />
            </div>
            <p className="text-caption text-white/60 mt-2">
              {totalRegistered}건 검증 중… 백엔드가 병렬로 처리합니다.
            </p>
          </div>
        )}
      </Card>

      {/* ───── 에러 표시 ───── */}
      {error && (
        <div className="px-4 py-3 rounded-card bg-red-50 border border-red-200 text-status-danger flex items-center gap-2">
          <AlertTriangle size={14} />
          검증 실패: {formatApiError(error)}
        </div>
      )}

      {/* ───── 결과 요약 (검증 완료 시) ───── */}
      {results.length > 0 && apiResp && (
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
          <SummaryStat
            icon={<Clock size={16} />}
            label="평균 응답"
            value={`${apiResp.avg_ms}`}
            unit="ms"
            tone="info"
          />
          <SummaryStat
            icon={<Zap size={16} />}
            label="처리량"
            value={`${apiResp.throughput.toFixed(1)}`}
            unit="req/s"
            tone="info"
          />
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
          {apiResp && (
            <div className="text-caption text-ink-muted tabular-nums">
              총 {apiResp.total_ms}ms 소요
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
                    key={r.place_id_ref}
                    className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors align-top"
                  >
                    <td className="px-card-sm py-3">
                      <div className="text-ink font-semibold tabular-nums">
                        {r.phone}
                      </div>
                      <div className="text-caption text-ink-muted font-mono mt-0.5">
                        {r.place_id}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-caption">
                      <ComparisonRow
                        icon={<MapPin size={11} />}
                        expected={r.registered_dong}
                        actual={r.detail.actual_dong ?? '—'}
                        match={r.detail.dong_match}
                      />
                      <ComparisonRow
                        icon={<Building2 size={11} />}
                        expected={r.business_name}
                        actual={r.detail.actual_name ?? '—'}
                        match={r.detail.name_match}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.alive} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.phone_match} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.dong_match} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.name_match} />
                    </td>
                    <td className="px-3 py-3">
                      <VerdictBadge verdict={r.verdict} />
                    </td>
                    <td className="px-card-sm py-3 text-right text-caption text-ink-muted tabular-nums">
                      {r.response_ms}ms
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
      <span className="text-ink-muted truncate max-w-[140px]" title={expected}>
        {expected}
      </span>
      <span className="text-ink-soft">→</span>
      <span
        className={
          match
            ? 'text-status-success font-medium truncate max-w-[140px]'
            : 'text-status-danger font-medium truncate max-w-[140px]'
        }
        title={actual}
      >
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
        <div
          className={`w-8 h-8 rounded-xl ${toneClass} flex items-center justify-center`}
        >
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

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `네트워크 오류 (백엔드 연결 확인): ${e.message}`
    return `API ${e.status}: ${e.message}`
  }
  return (e as Error).message ?? '알 수 없는 오류'
}
