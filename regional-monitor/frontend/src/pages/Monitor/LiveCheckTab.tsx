/**
 * Monitor — Tab 2: 실시간 노출 확인 (실 API 연동, 청크 분할 호출)
 *  ├─ 상단: 즉시 검증 실행 버튼 + 청크 진행률 + 청크 크기 선택
 *  ├─ 4중 검증 결과 요약 (정상/주의/심각 + 평균응답/처리량)
 *  └─ 상세 결과 테이블 (등록값 vs 실제값 비교)
 *
 * 백엔드 호출:
 *   POST /api/v1/verify/live    body { place_ids: number[] }
 *   - 1500건 한번에 호출 시 ~3분 소요 → 프론트 axios 타임아웃 위험
 *   - 그래서 클라이언트가 200건씩 청크로 나눠 순차 호출
 *   - 청크별 결과는 누적해서 한번에 보여줌
 */
import { useState, useMemo, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import { usePlacesList } from '@/hooks/usePlaces'
import { useQueryClient } from '@tanstack/react-query'
import { runLiveCheck } from '@/api/places'
import { ApiError } from '@/api/client'
import type { VerificationResult, VerifyMode } from '@/api/types'
import { placeKeys } from '@/hooks/usePlaces'
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
  StopCircle,
} from 'lucide-react'

const DEFAULT_CHUNK_SIZE = 200      // 청크당 200건 (~30초/청크)
const CHUNK_DELAY_MS = 200          // 청크 사이 휴식 (네이버 부하 분산)

export default function LiveCheckTab() {
  const qc = useQueryClient()
  const { data: placesData } = usePlacesList()

  // 청크 처리 상태
  const [running, setRunning] = useState(false)
  const [chunkSize, setChunkSize] = useState<number>(DEFAULT_CHUNK_SIZE)
  const [progress, setProgress] = useState({ chunk: 0, totalChunks: 0, done: 0, total: 0 })
  const [results, setResults] = useState<VerificationResult[]>([])
  const [totalMs, setTotalMs] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 검증 모드: 'fast' (페이지 존재 유무만, ~10s/200건) / 'full' (전화·동 풀 검증, ~40s/200건)
  const [mode, setMode] = useState<VerifyMode>('fast')
  const cancelRef = useRef(false)

  const totalRegistered = placesData?.summary.total ?? 0
  const allPlaceIds = useMemo(
    () => (placesData?.items ?? []).map((p) => p.id),
    [placesData?.items],
  )

  // 누적 요약
  const summary = useMemo(() => {
    const s = { ok: 0, warning: 0, danger: 0 }
    for (const r of results) {
      if (r.verdict === 'OK') s.ok++
      else if (
        r.verdict === 'PHONE_MISMATCH' ||
        r.verdict === 'DONG_MISMATCH' ||
        r.verdict === 'NAME_MISMATCH'
      )
        s.warning++
      else if (r.verdict === 'REGION_MISMATCH' || r.verdict === 'DEAD') s.danger++
    }
    return s
  }, [results])

  const avgMs = useMemo(() => {
    if (results.length === 0) return 0
    const sum = results.reduce((a, r) => a + (r.response_ms || 0), 0)
    return Math.round(sum / results.length)
  }, [results])

  const throughput = useMemo(() => {
    if (totalMs === 0 || results.length === 0) return 0
    return Number(((results.length / totalMs) * 1000).toFixed(1))
  }, [results.length, totalMs])

  const startCheck = async () => {
    if (totalRegistered === 0) {
      alert('등록된 070 번호가 없습니다. 먼저 "등록 관리" 탭에서 등록해 주세요.')
      return
    }
    if (running) return

    // 초기화
    setRunning(true)
    setErrorMsg(null)
    setResults([])
    setTotalMs(0)
    cancelRef.current = false

    const ids = [...allPlaceIds]
    const chunks: number[][] = []
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize))
    }

    setProgress({
      chunk: 0,
      totalChunks: chunks.length,
      done: 0,
      total: ids.length,
    })

    console.log(
      `[LiveCheck] 시작: ${ids.length}건을 ${chunks.length}개 청크로 분할 (청크 크기: ${chunkSize})`,
    )

    let accResults: VerificationResult[] = []
    let accMs = 0
    const t0 = performance.now()

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelRef.current) {
          console.log(`[LiveCheck] 사용자 취소 (청크 ${i + 1}/${chunks.length})`)
          break
        }
        const chunk = chunks[i]
        console.log(`[LiveCheck] 청크 ${i + 1}/${chunks.length} 전송 중 (${chunk.length}건)…`)
        setProgress((p) => ({ ...p, chunk: i + 1 }))

        const ts = performance.now()
        const resp = await runLiveCheck({ place_ids: chunk, mode })
        const elapsed = Math.round(performance.now() - ts)

        accMs += resp.total_ms || elapsed
        accResults = accResults.concat(resp.results || [])
        setResults([...accResults])
        setTotalMs(accMs)
        setProgress((p) => ({ ...p, done: accResults.length }))

        console.log(
          `[LiveCheck] 청크 ${i + 1}/${chunks.length} 완료 (${elapsed}ms): ` +
            `누적 ${accResults.length}/${ids.length}, ` +
            `ok=${resp.summary?.ok ?? 0} warn=${resp.summary?.warning ?? 0} dgr=${resp.summary?.danger ?? 0}`,
        )

        // 마지막 청크가 아니면 잠시 휴식 (네이버 부하 분산)
        if (i < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
        }
      }

      const total = Math.round(performance.now() - t0)
      console.log(
        `[LiveCheck] 완료: ${accResults.length}/${ids.length}건 (총 ${total}ms)`,
      )
      // Places 캐시 무효화 — verdict 갱신 반영
      qc.invalidateQueries({ queryKey: placeKeys.all })
    } catch (e: unknown) {
      const msg = formatApiError(e)
      console.error('[LiveCheck] 실패:', msg, e)
      setErrorMsg(msg)
    } finally {
      setRunning(false)
    }
  }

  const cancel = () => {
    cancelRef.current = true
  }

  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-6">
      {/* ───── 즉시 검증 실행 패널 ───── */}
      <Card variant="dark" className="min-h-[180px]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/15 text-white/90 text-caption font-bold uppercase tracking-wider mb-3">
              <ShieldCheck size={12} /> live verification
            </span>
            <h3 className="text-h2 text-white mb-2">
              {mode === 'fast' ? '⚡ 빠른 검증 (페이지 존재 유무)' : '🔍 정밀 검증 (전화·동 일치)'}
            </h3>
            <p className="text-body-sm text-white/75">
              등록된 <span className="font-bold text-white">{totalRegistered}</span>개의 070
              번호에 대해{' '}
              {mode === 'fast'
                ? '플레이스 ID 페이지가 살아있는지만 빠르게 확인합니다.'
                : '플레이스 ID + 전화번호 + 동/로/리 일치 여부까지 정밀 검증합니다.'}
              <br />
              <span className="text-caption text-white/60">
                {chunkSize}건씩 청크로 나눠 순차 호출 · 청크당 약{' '}
                {mode === 'fast'
                  ? `${Math.ceil(chunkSize * 0.06)}~${Math.ceil(chunkSize * 0.1)}초`
                  : `${Math.ceil(chunkSize * 0.13)}~${Math.ceil(chunkSize * 0.2)}초`}{' '}
                · 청크 사이 {CHUNK_DELAY_MS}ms 휴식
              </span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* 검증 모드 토글 (running이 아닐 때만) */}
            {!running && (
              <div
                className="inline-flex p-0.5 rounded-pill bg-white/10 border border-white/20"
                role="tablist"
                aria-label="검증 모드"
              >
                <button
                  type="button"
                  onClick={() => setMode('fast')}
                  className={`px-3 py-1.5 rounded-pill text-caption font-semibold transition-all ${
                    mode === 'fast'
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-white/80 hover:text-white'
                  }`}
                  title="플레이스 ID 페이지 존재 유무만 확인 — 가장 빠름, 트래픽 95% 절감"
                >
                  ⚡ 빠른 검증
                </button>
                <button
                  type="button"
                  onClick={() => setMode('full')}
                  className={`px-3 py-1.5 rounded-pill text-caption font-semibold transition-all ${
                    mode === 'full'
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-white/80 hover:text-white'
                  }`}
                  title="전화번호 + 동/로/리 일치 여부까지 검증 — 정확도 우선"
                >
                  🔍 정밀 검증
                </button>
              </div>
            )}

            {/* 청크 크기 선택 (running이 아닐 때만) */}
            {!running && (
              <label className="text-caption text-white/70 flex items-center gap-2">
                청크 크기
                <select
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  className="px-2 py-1 rounded bg-white/10 text-white text-caption border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  <option value={50} className="text-ink">50건</option>
                  <option value={100} className="text-ink">100건</option>
                  <option value={200} className="text-ink">200건 (권장)</option>
                  <option value={500} className="text-ink">500건</option>
                </select>
              </label>
            )}

            <div className="flex gap-2">
              {running && (
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-pill bg-red-500/90 hover:bg-red-500 text-white font-semibold text-body-sm transition-all"
                >
                  <StopCircle size={16} /> 취소
                </button>
              )}
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
          </div>
        </div>

        {/* 청크별 진행률 막대 */}
        {running && progress.totalChunks > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-caption text-white/80 mb-2 tabular-nums">
              <span>
                청크 {progress.chunk}/{progress.totalChunks} · {progress.done}/{progress.total}건
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-300 to-white rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* ───── 에러 표시 ───── */}
      {errorMsg && (
        <div className="px-4 py-3 rounded-card bg-red-50 border border-red-200 text-status-danger flex items-center gap-2">
          <AlertTriangle size={14} />
          검증 실패: {errorMsg}
        </div>
      )}

      {/* ───── 결과 요약 (1건 이상 결과 누적 시) ───── */}
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
          <SummaryStat
            icon={<Clock size={16} />}
            label="평균 응답"
            value={`${avgMs}`}
            unit="ms"
            tone="info"
          />
          <SummaryStat
            icon={<Zap size={16} />}
            label="처리량"
            value={`${throughput.toFixed(1)}`}
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
                : mode === 'fast'
                  ? `빠른 검증: ✓ 페이지 존재 유무만 확인 (총 ${results.length}건)`
                  : `정밀 검증: ✓ 페이지 생존 / ✓ 전화 / ✓ 동·로·리 (총 ${results.length}건)`}
            </p>
          </div>
          {totalMs > 0 && (
            <div className="text-caption text-ink-muted tabular-nums">
              총 {totalMs}ms 누적
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
                        {r.place_id ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-caption">
                      <ComparisonRow
                        icon={<MapPin size={11} />}
                        expected={r.registered_dong ?? '—'}
                        actual={r.detail.actual_dong ?? '—'}
                        match={r.detail.dong_match}
                      />
                      <ComparisonRow
                        icon={<Building2 size={11} />}
                        expected={r.business_name ?? '—'}
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

function CheckIcon({ ok }: { ok: boolean | null | undefined }) {
  // fast 모드에서는 검증을 건너뛰므로 null — "—" 표시
  if (ok === null || ok === undefined) {
    return <span className="text-ink-soft text-caption font-mono" title="빠른 검증 — 비교 생략">—</span>
  }
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
  match: boolean | null | undefined
}

function ComparisonRow({ icon, expected, actual, match }: ComparisonRowProps) {
  // fast 모드: match===null → 비교 자체가 없었음 → 회색 처리 + "—"
  const isSkipped = match === null || match === undefined
  return (
    <div className="flex items-center gap-1.5 mb-1 last:mb-0">
      <span className="text-ink-muted">{icon}</span>
      <span className="text-ink-muted truncate max-w-[140px]" title={expected}>
        {expected}
      </span>
      <span className="text-ink-soft">→</span>
      <span
        className={
          isSkipped
            ? 'text-ink-soft italic truncate max-w-[140px]'
            : match
            ? 'text-status-success font-medium truncate max-w-[140px]'
            : 'text-status-danger font-medium truncate max-w-[140px]'
        }
        title={isSkipped ? '빠른 검증 — 비교 생략' : actual}
      >
        {isSkipped ? '—' : actual}
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
