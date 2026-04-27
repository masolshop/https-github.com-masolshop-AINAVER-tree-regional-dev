/**
 * 대용량 검증 진행률 모달
 *
 * - 백엔드 POST /verify/job 으로 작업을 시작한 뒤,
 *   2초 간격으로 GET /verify/job/{id} 폴링하며 진행률을 표시한다.
 * - 사용자는 "취소" 버튼으로 cancel_requested=true 요청 가능
 *   (다음 청크 시작 전에 멈춤).
 * - 작업이 completed/cancelled 가 되면, "불일치 .xlsx 다운로드" 버튼이 활성화.
 *   defaultAutoDownload=true 면 완료 시 자동 다운로드.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, X, Download, AlertTriangle, CheckCircle2, StopCircle } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import {
  cancelVerifyJob,
  createVerifyJob,
  getVerifyJob,
  verifyJobMismatchesUrl,
} from '../../api/places'
import { API_BASE } from '../../api/client'
import type { VerifyJob } from '../../api/types'
import { useAuthStore } from '../../store/auth'

interface VerifyJobModalProps {
  open: boolean
  placeIds?: number[]               // 선택된 ID 들 (없으면 전체)
  onClose: () => void
  autoDownload?: boolean
}

export function VerifyJobModal({
  open,
  placeIds,
  onClose,
  autoDownload = true,
}: VerifyJobModalProps) {
  const [job, setJob] = useState<VerifyJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const pollRef = useRef<number | null>(null)
  const token = useAuthStore((s) => s.accessToken)

  // 시작
  useEffect(() => {
    if (!open) return
    setJob(null)
    setError(null)
    setDownloaded(false)
    setStarting(true)
    createVerifyJob({ place_ids: placeIds && placeIds.length ? placeIds : undefined })
      .then((j) => {
        setJob(j)
        setStarting(false)
      })
      .catch((e: unknown) => {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : '검증 작업 시작 실패'
        setError(msg)
        setStarting(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 폴링
  useEffect(() => {
    if (!job || !open) return
    if (
      job.status === 'completed' ||
      job.status === 'cancelled' ||
      job.status === 'failed'
    ) {
      // 자동 다운로드
      if (autoDownload && !downloaded && job.status !== 'failed' && job.mismatch_count > 0) {
        downloadMismatches(job.id, token).catch(() => {})
        setDownloaded(true)
      }
      return
    }
    pollRef.current = window.setTimeout(async () => {
      try {
        const fresh = await getVerifyJob(job.id)
        setJob(fresh)
      } catch (e) {
        console.warn('poll failed', e)
      }
    }, 2000)
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current)
        pollRef.current = null
      }
    }
  }, [job, open, autoDownload, downloaded, token])

  if (!open) return null

  const handleCancel = async () => {
    if (!job) return
    setCancelling(true)
    try {
      await cancelVerifyJob(job.id)
    } finally {
      setCancelling(false)
    }
  }

  const handleDownload = () => {
    if (!job) return
    downloadMismatches(job.id, token).catch((e) => alert(String(e?.message || e)))
  }

  const isFinal =
    job &&
    (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">대량 검증 진행</h3>
            <p className="text-xs text-slate-500 mt-1">
              500건씩 청크로 나누어 동시 10건 검증합니다. 창을 닫아도 백그라운드에서 계속 진행됩니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {starting && (
          <div className="flex items-center gap-2 text-slate-600 text-sm py-4">
            <Loader2 size={16} className="animate-spin" /> 검증 작업을 생성 중...
          </div>
        )}

        {job && (
          <div className="space-y-4">
            {/* 진행률 바 */}
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-slate-700">
                  {job.processed.toLocaleString()} / {job.total.toLocaleString()} 건
                </span>
                <span className="text-slate-500">{job.progress_pct.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    job.status === 'failed'
                      ? 'bg-rose-500'
                      : job.status === 'cancelled'
                      ? 'bg-amber-500'
                      : job.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, job.progress_pct)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
                <span>
                  청크 {job.chunks_done} / {job.chunks_total}
                </span>
                <span>
                  {job.status === 'running' && job.eta_seconds !== null
                    ? `남은 시간 약 ${formatSec(job.eta_seconds)}`
                    : job.elapsed_seconds !== null
                    ? `경과 ${formatSec(job.elapsed_seconds)}`
                    : ''}
                </span>
              </div>
            </div>

            {/* 카운트 */}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <CountBox label="정상" value={job.ok_count} tone="success" />
              <CountBox label="주의" value={job.warning_count} tone="warning" />
              <CountBox label="심각" value={job.danger_count} tone="danger" />
            </div>

            {/* 상태 라인 */}
            <div className="text-sm">
              <StatusLine job={job} />
            </div>

            {/* 액션 버튼 */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              {!isFinal && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling || job.cancel_requested}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  <StopCircle size={14} />
                  {job.cancel_requested ? '취소 요청됨' : '취소'}
                </button>
              )}
              {isFinal && (
                <button
                  onClick={handleDownload}
                  disabled={job.mismatch_count === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300"
                >
                  <Download size={14} />
                  불일치 .xlsx 다운로드 ({job.mismatch_count.toLocaleString()}건)
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-sm bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function CountBox({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'warning' | 'danger'
}) {
  const colors = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
  } as const
  return (
    <div className={`rounded-md border p-2 text-center ${colors[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-bold">{value.toLocaleString()}</div>
    </div>
  )
}

function StatusLine({ job }: { job: VerifyJob }) {
  if (job.status === 'queued')
    return <span className="text-slate-500">대기 중...</span>
  if (job.status === 'running')
    return (
      <span className="text-blue-600 flex items-center gap-1.5">
        <Loader2 size={14} className="animate-spin" />
        검증 진행 중
      </span>
    )
  if (job.status === 'completed')
    return (
      <span className="text-emerald-600 flex items-center gap-1.5">
        <CheckCircle2 size={14} /> 완료
      </span>
    )
  if (job.status === 'cancelled')
    return (
      <span className="text-amber-600 flex items-center gap-1.5">
        <StopCircle size={14} /> 취소됨
      </span>
    )
  if (job.status === 'failed')
    return (
      <span className="text-rose-600 flex items-center gap-1.5">
        <AlertTriangle size={14} />
        실패: {job.error || '알 수 없는 오류'}
      </span>
    )
  return null
}

function formatSec(s: number): string {
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return `${m}분 ${r}초`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}시간 ${rm}분`
}

/* ─────────── 공통 다운로드 헬퍼 (auth 헤더 포함) ─────────── */
async function downloadMismatches(jobId: number, token: string | null) {
  const url = API_BASE + verifyJobMismatchesUrl(jobId)
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!resp.ok) {
    throw new Error(`다운로드 실패 (HTTP ${resp.status})`)
  }
  const blob = await resp.blob()
  // 파일명 추출 (Content-Disposition: attachment; filename*=UTF-8''xxx)
  const cd = resp.headers.get('content-disposition') || ''
  let filename = `타지역서비스_불일치명단_job${jobId}.xlsx`
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
  if (m) {
    try {
      filename = decodeURIComponent(m[1])
    } catch {
      /* keep default */
    }
  }
  const a = document.createElement('a')
  const objectUrl = URL.createObjectURL(blob)
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
