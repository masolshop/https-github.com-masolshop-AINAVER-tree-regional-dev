/**
 * 어드민 백업 관리 탭 — /admin (탭: 백업)
 *
 * 기능:
 *  · 백업 카테고리별(DB/사용자/코드) 파일 목록
 *  · 다운로드 (Authorization 헤더 포함 fetch)
 *  · 즉시 실행 (systemctl start)
 *  · 디스크 사용량 + 다음 실행 예정 시각
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileArchive,
  Loader2,
  PlayCircle,
  RefreshCw,
  Users as UsersIcon,
} from 'lucide-react'

import {
  backupApi,
  type BackupCategory,
  type BackupFile,
  type BackupStatusResponse,
} from '@/api/backup'
import { Card } from '@/components/ui/Card'
import { formatKSTDateTime } from '@/utils/datetime'

const CATEGORY_META: Record<
  BackupCategory,
  { label: string; icon: React.ReactNode; desc: string }
> = {
  db: {
    label: 'DB 전체',
    icon: <Database className="h-4 w-4" />,
    desc: 'SQLite hot backup (.sqlite.gz)',
  },
  users: {
    label: '사용자별 데이터',
    icon: <UsersIcon className="h-4 w-4" />,
    desc: '계정별 places/events/jobs (.json.gz)',
  },
  code: {
    label: '코드 전체',
    icon: <FileArchive className="h-4 w-4" />,
    desc: '서버 코드 스냅샷 (.tar.gz)',
  },
}


export function AdminBackup() {
  const qc = useQueryClient()

  const listQ = useQuery({
    queryKey: ['admin', 'backup', 'list'],
    queryFn: backupApi.list,
    refetchInterval: 30_000,
  })
  const statusQ = useQuery({
    queryKey: ['admin', 'backup', 'status'],
    queryFn: backupApi.status,
    refetchInterval: 30_000,
  })

  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const runMut = useMutation({
    mutationFn: (category: BackupCategory) => backupApi.run(category),
    onSuccess: (res) => {
      setRunError(null)
      setRunMessage(
        `${CATEGORY_META[res.category].label} 백업이 시작되었습니다 (${res.method}). ` +
          '약 10–30초 후 목록이 갱신됩니다.',
      )
      // 30초 뒤 자동 갱신
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['admin', 'backup', 'list'] })
        qc.invalidateQueries({ queryKey: ['admin', 'backup', 'status'] })
      }, 15_000)
    },
    onError: (err: Error) => {
      setRunMessage(null)
      setRunError(err.message ?? '실행 실패')
    },
  })

  const handleDownload = async (category: BackupCategory, filename: string) => {
    setDownloading(filename)
    setDownloadError(null)
    try {
      await backupApi.download(category, filename)
    } catch (e) {
      setDownloadError((e as Error).message ?? '다운로드 실패')
    } finally {
      setDownloading(null)
    }
  }

  if (listQ.isLoading || statusQ.isLoading) {
    return (
      <Card className="flex items-center gap-2 p-6 text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> 백업 정보 로딩 중...
      </Card>
    )
  }

  if (listQ.error || statusQ.error || !listQ.data || !statusQ.data) {
    return (
      <Card className="border-rose-200 bg-rose-50 p-6 text-rose-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" /> 백업 정보 로드 실패
        </div>
        <div className="mt-1 text-sm">
          {(listQ.error as Error)?.message ?? (statusQ.error as Error)?.message ?? '알 수 없는 오류'}
        </div>
      </Card>
    )
  }

  const list = listQ.data
  const status = statusQ.data

  return (
    <div className="space-y-6">
      {/* 상단: 상태/스케줄 */}
      <SummaryRow status={status} />

      {/* 즉시 실행 알림 */}
      {runMessage && (
        <Card className="flex items-start gap-2 border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-sm">{runMessage}</div>
          <button
            onClick={() => setRunMessage(null)}
            className="ml-auto text-xs text-emerald-700 hover:underline"
          >
            닫기
          </button>
        </Card>
      )}
      {runError && (
        <Card className="flex items-start gap-2 border-rose-200 bg-rose-50 p-4 text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-sm">{runError}</div>
          <button
            onClick={() => setRunError(null)}
            className="ml-auto text-xs text-rose-700 hover:underline"
          >
            닫기
          </button>
        </Card>
      )}
      {downloadError && (
        <Card className="flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-sm">다운로드 실패: {downloadError}</div>
          <button
            onClick={() => setDownloadError(null)}
            className="ml-auto text-xs text-amber-800 hover:underline"
          >
            닫기
          </button>
        </Card>
      )}

      {/* 카테고리별 카드 */}
      {(['db', 'users', 'code'] as BackupCategory[]).map((cat) => {
        const meta = CATEGORY_META[cat]
        const files = list[cat]
        const stat = status.categories[cat]
        return (
          <Card key={cat} className="overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center gap-3 border-b border-line bg-slate-50 px-5 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                {meta.icon}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-ink">{meta.label}</div>
                <div className="text-xs text-ink-muted">{meta.desc}</div>
              </div>
              <div className="hidden text-right text-xs text-ink-muted sm:block">
                <div>예약: <span className="font-mono">{status.schedule[cat]}</span></div>
                <div>{stat.count}개 · {stat.size_human}</div>
              </div>
              <button
                disabled={runMut.isPending}
                onClick={() => runMut.mutate(cat)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {runMut.isPending && runMut.variables === cat ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                지금 실행
              </button>
            </div>

            {/* 파일 목록 */}
            {files.length === 0 ? (
              <div className="flex items-center gap-2 px-5 py-6 text-sm text-ink-muted">
                <Clock className="h-4 w-4" /> 아직 백업 파일이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-ink-muted">
                    <tr>
                      <th className="px-5 py-2.5">파일명</th>
                      <th className="px-5 py-2.5">크기</th>
                      <th className="px-5 py-2.5">생성 시각 (KST)</th>
                      <th className="px-5 py-2.5 text-right">동작</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {files.map((f: BackupFile) => (
                      <tr key={f.filename} className="hover:bg-slate-50">
                        <td className="px-5 py-2.5 font-mono text-xs text-ink">{f.filename}</td>
                        <td className="px-5 py-2.5 tabular-nums text-ink-muted">
                          {f.size_human}
                        </td>
                        <td className="px-5 py-2.5 tabular-nums text-ink-muted">
                          {formatKSTDateTime(f.mtime)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            disabled={downloading === f.filename}
                            onClick={() => handleDownload(cat, f.filename)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
                          >
                            {downloading === f.filename ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            다운로드
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )
      })}

      <div className="flex items-center justify-end gap-2 text-xs text-ink-muted">
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['admin', 'backup'] })
          }}
          className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1 hover:bg-slate-50"
        >
          <RefreshCw className="h-3 w-3" /> 새로고침
        </button>
      </div>
    </div>
  )
}


// ── Subcomponents ─────────────────────────────────

function SummaryRow({ status }: { status: BackupStatusResponse }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <Clock className="h-3.5 w-3.5" /> 보관 정책
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-ink">
          {status.retention_days}일
        </div>
        <div className="text-[11px] text-ink-muted">로컬 + S3 (활성화 시)</div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <FileArchive className="h-3.5 w-3.5" /> 총 사용량
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-ink">
          {status.total_size_human}
        </div>
        <div className="text-[11px] text-ink-muted">
          {Object.values(status.categories).reduce((a, c) => a + c.count, 0)}개 파일
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <Clock className="h-3.5 w-3.5" /> 예약 (KST)
        </div>
        <div className="mt-1 space-y-0.5 text-xs font-mono text-ink">
          <div>DB &nbsp;{status.schedule.db}</div>
          <div>사용자 {status.schedule.users}</div>
          <div>코드 {status.schedule.code}</div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          {status.s3_enabled ? (
            <Cloud className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <CloudOff className="h-3.5 w-3.5" />
          )}
          S3 업로드
        </div>
        <div className="mt-1 text-sm font-bold text-ink">
          {status.s3_enabled ? '활성화' : '비활성화'}
        </div>
        <div className="truncate text-[11px] text-ink-muted">
          {status.s3_enabled ? status.s3_bucket || '(버킷 미설정)' : '키 미설정'}
        </div>
      </Card>
    </div>
  )
}
