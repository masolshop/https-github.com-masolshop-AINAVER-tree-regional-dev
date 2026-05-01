/**
 * Admin → 주간 리포트 메일 (/admin?tab=weekly-report)
 *
 * 슈퍼어드민이 매주 월 09:00 KST 자동 잡 + 수동 발송 이력을 모니터링한다.
 *
 * 구성:
 *  · KPI 카드 — 최근 회차의 sent / skipped / errors / 총 후보
 *  · 액션 — "지금 발송" / "드라이런(SMTP 호출 없음)" 버튼
 *  · 회차 목록 — 최근 20회차 (시각, trigger, 결과 카운트, dry_run 뱃지)
 *  · 회차 상세 — 선택 회차의 회원 단위 발송 이력 + status 필터 (sent/skipped/failed)
 *
 * 백엔드:
 *   POST /api/v1/admin/weekly-report/run?dry_run={true|false}
 *   GET  /api/v1/admin/weekly-report/runs?limit=20
 *   GET  /api/v1/admin/weekly-report/runs/{run_id}?status_filter=...
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mail,
  Send,
  TestTube,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  Eye,
  XCircle,
  PauseCircle,
} from 'lucide-react'

import { Card } from '@/components/ui/Card'
import {
  adminApi,
  WeeklyReportRunRow,
  WeeklyReportRowStatus,
  WeeklyReportUserRow,
} from '@/api/admin'

type StatusFilter = '' | WeeklyReportRowStatus

const STATUS_LABEL: Record<WeeklyReportRowStatus, string> = {
  sent: '발송 성공',
  sent_fallback: '콘솔 폴백',
  skipped_no_activity: '활동 없음',
  skipped_disabled: '알림 OFF',
  failed: '실패',
  run_summary: '회차 요약',
}

const STATUS_COLOR: Record<WeeklyReportRowStatus, string> = {
  sent: 'bg-emerald-100 text-emerald-700',
  sent_fallback: 'bg-blue-100 text-blue-700',
  skipped_no_activity: 'bg-gray-100 text-gray-600',
  skipped_disabled: 'bg-amber-100 text-amber-700',
  failed: 'bg-rose-100 text-rose-700',
  run_summary: 'bg-slate-200 text-slate-700',
}

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: '월 09:00 자동',
  manual: '수동 발송',
  manual_dry_run: '드라이런(수동)',
}

function formatKST(iso: string | null): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
  } catch {
    return iso
  }
}

function formatElapsed(ms: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`
}

function StatusBadge({ status }: { status: WeeklyReportRowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function KPI({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}) {
  const toneCls = {
    default: 'text-ink',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
    info: 'text-blue-600',
  }[tone]
  return (
    <Card className="!p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className={toneCls}>{icon}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
    </Card>
  )
}

export function AdminWeeklyReport() {
  const qc = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [confirmRun, setConfirmRun] = useState(false)

  // 회차 목록
  const runsQ = useQuery({
    queryKey: ['admin', 'weekly-report', 'runs'],
    queryFn: () => adminApi.weeklyReportRuns(20),
    refetchInterval: 30_000,
  })

  // 회차 상세
  const detailQ = useQuery({
    queryKey: ['admin', 'weekly-report', 'detail', selectedRunId, statusFilter],
    queryFn: () =>
      adminApi.weeklyReportRunDetail(
        selectedRunId!,
        statusFilter || undefined,
      ),
    enabled: !!selectedRunId,
  })

  // 수동 발송
  const runMut = useMutation({
    mutationFn: (dryRun: boolean) => adminApi.weeklyReportRun(dryRun),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'weekly-report', 'runs'] })
      setSelectedRunId(res.run_id)
      setStatusFilter('')
    },
  })

  const runs = runsQ.data?.items ?? []
  const latest: WeeklyReportRunRow | null = runs[0] ?? null

  // 선택된 회차 — 명시 선택이 없으면 최신 회차 자동 선택
  const effectiveRunId = selectedRunId ?? latest?.run_id ?? null
  const isRunSelected = effectiveRunId !== null

  const detail = detailQ.data
  const items: WeeklyReportUserRow[] = detail?.items ?? []

  // 상세 화면용 status별 카운트
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const it of items) {
      c[it.status] = (c[it.status] || 0) + 1
    }
    return c
  }, [items])

  return (
    <div className="space-y-6">
      {/* 헤더 + 액션 */}
      <Card className="!p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-ink">
              <Mail className="h-5 w-5 text-blue-600" />
              주간 리포트 메일 모니터링
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              매주 월요일 09:00 KST 자동 발송 · 7일 활동(신규/미포함/변경/미노출/고객요청 변경)
              집계 후 가입 이메일(To) + 추가 수신자(Cc)에게 송부
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runMut.mutate(true)}
              disabled={runMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-gray-50 disabled:opacity-50"
              title="SMTP 호출 없이 콘솔 폴백 — 발송은 안 되지만 로그·이력에는 기록됩니다"
            >
              <TestTube className="h-4 w-4" />
              드라이런 실행
            </button>
            <button
              onClick={() => setConfirmRun(true)}
              disabled={runMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              지금 발송
            </button>
            <button
              onClick={() => runsQ.refetch()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:bg-gray-50"
              title="새로고침"
            >
              <RefreshCw className={`h-4 w-4 ${runsQ.isRefetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {runMut.isPending && (
          <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            발송 중... (회원 수에 따라 수십 초 소요)
          </div>
        )}
        {runMut.isError && (
          <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            발송 실패: {(runMut.error as Error)?.message || '알 수 없는 오류'}
          </div>
        )}
        {runMut.isSuccess && (
          <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            완료 · run_id: <code className="font-mono">{runMut.data.run_id}</code> · 발송 {runMut.data.sent} /
            활동없음 {runMut.data.skipped_no_activity} / 알림OFF {runMut.data.skipped_disabled} / 실패 {runMut.data.errors}
            {runMut.data.dry_run && (
              <span className="ml-2 rounded bg-blue-200 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                DRY RUN
              </span>
            )}
          </div>
        )}
      </Card>

      {/* 최근 회차 KPI */}
      {latest && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KPI
            label="최근 회차 발송"
            value={latest.sent_users}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="success"
          />
          <KPI
            label="활동 없음 스킵"
            value={latest.skipped_no_activity}
            icon={<PauseCircle className="h-5 w-5" />}
          />
          <KPI
            label="알림 OFF 스킵"
            value={latest.skipped_disabled}
            icon={<XCircle className="h-5 w-5" />}
            tone="warning"
          />
          <KPI
            label="실패"
            value={latest.errors}
            icon={<AlertCircle className="h-5 w-5" />}
            tone={latest.errors > 0 ? 'danger' : 'default'}
          />
          <KPI
            label="총 후보 / 소요"
            value={`${latest.total_candidates} · ${formatElapsed(latest.elapsed_ms)}`}
            icon={<Clock className="h-5 w-5" />}
            tone="info"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
        {/* 회차 목록 */}
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold text-ink">최근 회차 (최대 20)</div>
            <span className="text-xs text-ink-muted">{runs.length}회차</span>
          </div>
          {runsQ.isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-ink-muted">불러오는 중...</div>
          ) : runs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-muted">
              아직 발송 이력이 없습니다.
              <br />
              "지금 발송" 또는 "드라이런 실행"으로 시작하세요.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {runs.map((r) => {
                const active = r.run_id === effectiveRunId
                return (
                  <li
                    key={r.id}
                    onClick={() => {
                      setSelectedRunId(r.run_id)
                      setStatusFilter('')
                    }}
                    className={`cursor-pointer px-4 py-3 transition-colors ${
                      active
                        ? 'bg-blue-50 border-l-4 border-blue-500'
                        : 'hover:bg-gray-50 border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-ink-muted truncate">
                          {r.run_id}
                          {r.dry_run && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                              DRY
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-muted">
                          {formatKST(r.started_at)} · {TRIGGER_LABEL[r.trigger] || r.trigger}
                        </div>
                      </div>
                      <Eye
                        className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-500' : 'text-gray-300'}`}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                        OK {r.sent_users}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                        활동 X {r.skipped_no_activity}
                      </span>
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                        OFF {r.skipped_disabled}
                      </span>
                      {r.errors > 0 && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
                          실패 {r.errors}
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        {formatElapsed(r.elapsed_ms)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* 회차 상세 */}
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Filter className="h-4 w-4" />
              회차 상세 — 회원별 발송 이력
            </div>
            {detail && (
              <span className="font-mono text-[11px] text-ink-muted">
                {detail.summary.run_id}
              </span>
            )}
          </div>

          {!isRunSelected ? (
            <div className="px-4 py-12 text-center text-sm text-ink-muted">
              왼쪽에서 회차를 선택하세요.
            </div>
          ) : detailQ.isLoading ? (
            <div className="px-4 py-12 text-center text-sm text-ink-muted">불러오는 중...</div>
          ) : !detail ? (
            <div className="px-4 py-12 text-center text-sm text-ink-muted">
              상세 데이터를 가져올 수 없습니다.
            </div>
          ) : (
            <>
              {/* 필터 칩 */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-gray-50 px-4 py-2">
                <button
                  onClick={() => setStatusFilter('')}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === ''
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-ink-muted hover:bg-gray-100 border border-line'
                  }`}
                >
                  전체 {items.length}
                </button>
                {(['sent', 'sent_fallback', 'skipped_no_activity', 'skipped_disabled', 'failed'] as WeeklyReportRowStatus[]).map((s) => {
                  const c = statusFilter === s ? items.length : statusCounts[s] || 0
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                        statusFilter === s
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-ink-muted hover:bg-gray-100 border border-line'
                      }`}
                    >
                      {STATUS_LABEL[s]} {c}
                    </button>
                  )
                })}
              </div>

              {/* 표 */}
              {items.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-ink-muted">
                  {statusFilter
                    ? `${STATUS_LABEL[statusFilter as WeeklyReportRowStatus]} 항목이 없습니다.`
                    : '회원별 이력이 없습니다.'}
                </div>
              ) : (
                <div className="max-h-[600px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-xs text-ink-muted">
                      <tr className="border-b border-line">
                        <th className="px-3 py-2 text-left">상태</th>
                        <th className="px-3 py-2 text-left">이메일</th>
                        <th className="px-3 py-2 text-right">신규</th>
                        <th className="px-3 py-2 text-right">미포함</th>
                        <th className="px-3 py-2 text-right">변경</th>
                        <th className="px-3 py-2 text-right">미노출</th>
                        <th className="px-3 py-2 text-right">고객요청</th>
                        <th className="px-3 py-2 text-right">합계</th>
                        <th className="px-3 py-2 text-left">발송시각</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-line/60 hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <StatusBadge status={it.status} />
                            {it.dry_run && (
                              <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                DRY
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink">
                              {it.user_name_now || it.email || '-'}
                            </div>
                            <div className="text-[11px] text-ink-muted">
                              {it.email}
                              {it.cc_emails && (
                                <span className="ml-1 text-amber-600">+ Cc {it.cc_emails.split(',').length}</span>
                              )}
                            </div>
                            {it.error && (
                              <div className="mt-0.5 text-[11px] text-rose-600">{it.error}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.new_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.excluded_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-600 font-semibold">
                            {it.changed_exposure}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-rose-600 font-semibold">
                            {it.dead_exposure}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.user_override}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold">
                            {it.activity_total}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-ink-muted">
                            {formatKST(it.sent_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* 확인 모달 */}
      {confirmRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <Card className="!p-6 max-w-md w-full">
            <div className="flex items-center gap-2 text-lg font-bold text-ink">
              <Send className="h-5 w-5 text-blue-600" />
              주간 리포트 즉시 발송
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              모든 활성 회원 중 7일 활동이 있는 회원에게 메일이 발송됩니다.
              <br />
              <strong className="text-rose-600">실제 SMTP 호출이 일어납니다.</strong>
              <br />
              계속하시겠습니까?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRun(false)}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setConfirmRun(false)
                  runMut.mutate(false)
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                발송
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
