/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5) — 풀 구현 페이지.
 *
 * 구성:
 *  1) Excel 업로드 카드 (드래그&드롭 + 파일선택 + 템플릿 다운로드)
 *  2) 매칭 결과 요약 + 매칭 재실행 버튼
 *  3) 매칭 결과 테이블 (자동매칭/검토필요/미발견 그룹)
 *  4) REVIEW_NEEDED 행의 후보 선택 모달
 *  5) 순위 추이 차트 (선택한 행 — 30일, 키워드별 SVG 라인차트, Y축 반전)
 *  6) Excel 다운로드 (요약 시트 + 상세 시트)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TrendingUp,
  Upload,
  Download,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  LineChart as LineChartIcon,
  Search,
} from 'lucide-react'
import clsx from 'clsx'

import { Card } from '@/components/ui/Card'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import {
  uploadRankRows,
  listRankPlaces,
  runMatch,
  confirmCandidate,
  getRankHistory,
  type RankUploadRow,
  type RankPlaceOut,
  type RankPlaceListOut,
  type RankPlaceCandidate,
  type RankHistoryResponse,
  type MatchStatus,
} from '@/api/rankTracker'

/* ────────────────────────────────────────────────────────────
 * 유틸: 파일명 / 날짜
 * ──────────────────────────────────────────────────────────── */
function todayKst(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/* ────────────────────────────────────────────────────────────
 * 매칭 상태 메타
 * ──────────────────────────────────────────────────────────── */
const STATUS_META: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  AUTO_MATCHED:  { label: '자동매칭',   color: 'emerald', icon: CheckCircle2 },
  CONFIRMED:     { label: '확정',       color: 'blue',    icon: CheckCircle2 },
  REVIEW_NEEDED: { label: '검토필요',   color: 'amber',   icon: AlertTriangle },
  NOT_FOUND:     { label: '미발견',     color: 'rose',    icon: XCircle },
  PENDING_MATCH: { label: '매칭대기',   color: 'slate',   icon: Loader2 },
}

function statusMeta(s: MatchStatus): { label: string; color: string; icon: typeof CheckCircle2 } {
  if (!s) return STATUS_META.PENDING_MATCH
  return STATUS_META[s] ?? STATUS_META.PENDING_MATCH
}

/* ────────────────────────────────────────────────────────────
 * 페이지 본체
 * ──────────────────────────────────────────────────────────── */
export default function RankTracker() {
  useBodyClass('solution-tool-page')

  // 데이터
  const [list, setList] = useState<RankPlaceListOut | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // UI
  const [reviewTarget, setReviewTarget] = useState<RankPlaceOut | null>(null)
  const [chartTarget, setChartTarget] = useState<RankPlaceOut | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>('REVIEW_NEEDED')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  /* ── 목록 fetch ── */
  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const r = await listRankPlaces()
      setList(r)
    } catch (e) {
      console.error('listRankPlaces failed', e)
      showToast('목록 조회 실패')
    } finally {
      setLoadingList(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 매칭 진행 중에는 5초 폴링
  const hasPending = useMemo(
    () => (list?.pending ?? 0) > 0,
    [list],
  )
  useEffect(() => {
    if (!hasPending) return
    const t = window.setInterval(() => fetchList(), 5000)
    return () => window.clearInterval(t)
  }, [hasPending, fetchList])

  /* ── 업로드 ── */
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const { parseXlsxFile } = await import('@/utils/xlsx')
        const rows = await parseXlsxFile(file)
        const payload: RankUploadRow[] = rows
          .map((row: Record<string, unknown>) => {
            // 한글/영문 헤더 모두 허용
            const phone =
              String(row['070전번'] ?? row['phone'] ?? row['전화번호'] ?? row['070'] ?? '').trim()
            const dong = String(
              row['등록동'] ?? row['dong'] ?? row['동'] ?? '',
            ).trim()
            const biz = String(
              row['상호'] ?? row['business_name'] ?? row['업체명'] ?? '',
            ).trim()
            const kwRaw = String(
              row['추적키워드'] ?? row['keywords'] ?? row['키워드'] ?? '',
            ).trim()
            const keywords = kwRaw
              .split(/[,\u3001|/]+/)
              .map((k) => k.trim())
              .filter(Boolean)
              .slice(0, 5)
            return { phone, registered_dong: dong, business_name: biz, tracking_keywords: keywords }
          })
          .filter((r) => r.phone && r.registered_dong && r.business_name && r.tracking_keywords.length)

        if (payload.length === 0) {
          showToast('업로드 가능한 행이 없습니다. (070전번/등록동/상호/추적키워드 컬럼 확인)')
          return
        }
        const resp = await uploadRankRows(payload)
        showToast(
          `업로드 완료 — 신규 ${resp.created} · 갱신 ${resp.updated} · 오류 ${resp.errors}건. 매칭이 백그라운드에서 진행됩니다.`,
        )
        await fetchList()
      } catch (e) {
        console.error('upload failed', e)
        showToast('업로드 실패: ' + (e as Error).message)
      } finally {
        setUploading(false)
      }
    },
    [fetchList, showToast],
  )

  /* ── 템플릿 다운로드 ── */
  const downloadTemplate = useCallback(async () => {
    const { downloadXlsx } = await import('@/utils/xlsx')
    await downloadXlsx(
      [
        {
          '070전번': '070-1234-5678',
          등록동: '압구정동',
          상호: '예시업체명',
          추적키워드: '강남맛집,압구정맛집',
        },
        {
          '070전번': '070-9876-5432',
          등록동: '역삼동',
          상호: '두번째예시',
          추적키워드: '역삼맛집',
        },
      ],
      `타지역_순위자동체크_업로드템플릿_${todayKst()}.xlsx`,
      '업로드양식',
    )
  }, [])

  /* ── 결과 Excel 다운로드 ── */
  const exportResults = useCallback(async () => {
    if (!list || list.items.length === 0) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()

    const summary = list.items.map((p) => ({
      상호: p.business_name ?? '',
      '070전번': p.phone,
      등록동: p.registered_dong ?? '',
      추적키워드: p.tracking_keywords.join(', '),
      매칭상태: statusMeta(p.match_status).label,
      신뢰도: p.match_confidence ?? '',
      place_id: p.place_id ?? '',
      매칭일시: p.matched_at ?? '',
    }))

    const detail: Record<string, unknown>[] = []
    for (const p of list.items) {
      if (p.candidates.length === 0) continue
      p.candidates.forEach((c, i) => {
        detail.push({
          상호_원본: p.business_name ?? '',
          '070전번': p.phone,
          등록동: p.registered_dong ?? '',
          후보순번: i + 1,
          후보상호: c.name,
          카테고리: c.category,
          후보전화: c.phone,
          가상번호: c.virtual_phone,
          후보주소: c.address,
          점수: c.score,
          매칭근거: c.reasons.join(', '),
          place_id: c.place_id,
        })
      })
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '매칭요약')
    if (detail.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), '후보상세')
    }
    XLSX.writeFile(wb, `타지역_순위자동체크_결과_${todayKst()}.xlsx`)
  }, [list])

  /* ── 매칭 재실행 ── */
  const handleRunMatch = useCallback(async () => {
    setRunning(true)
    try {
      const r = await runMatch({})
      showToast(`${r.requested}건 매칭 백그라운드 실행`)
      await fetchList()
    } catch (e) {
      showToast('매칭 실행 실패: ' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [fetchList, showToast])

  /* ── 후보 확정 ── */
  const handleConfirm = useCallback(
    async (place: RankPlaceOut, candidate: RankPlaceCandidate) => {
      try {
        await confirmCandidate(place.id, { place_id: candidate.place_id })
        showToast(`${candidate.name} 으로 확정되었습니다.`)
        setReviewTarget(null)
        await fetchList()
      } catch (e) {
        showToast('확정 실패: ' + (e as Error).message)
      }
    },
    [fetchList, showToast],
  )

  return (
    <div className="px-4 lg:px-8 py-6 max-w-7xl mx-auto space-y-6" data-page="solution-tool">
      <PageSeo
        title="타지역 순위 자동체크 솔루션"
        description="070전번·등록동·상호 엑셀 업로드 → 네이버 플레이스 자동 매칭 → 매일 동별 노출 순위 자동 추적."
        path="/auto-rank-check"
        keywords={[
          '타지역 순위 자동체크',
          '네이버 플레이스 순위',
          '동별 순위 추적',
          '070 가상번호 순위',
          '네이버 지도 순위',
          '타지역닷컴',
        ]}
      />

      {/* 헤더 */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="text-blue-600" size={24} />
          타지역 순위 자동체크 솔루션
        </h1>
        <p className="text-sm text-ink-2 mt-1">
          <strong>070전번 · 등록동 · 상호 · 추적키워드</strong> 4컬럼 엑셀 한 번 업로드 →
          네이버 플레이스 자동 매칭 + 매일 자동체크로 동별 노출 순위를 시계열 그래프로 추적합니다.
        </p>
      </div>

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* 1) 업로드 카드 */}
      <UploadCard
        uploading={uploading}
        onFile={handleFile}
        onDownloadTemplate={downloadTemplate}
      />

      {/* 2) 요약 + 액션 */}
      {list && (
        <SummaryBar
          list={list}
          loading={loadingList}
          running={running}
          onRefresh={fetchList}
          onRunMatch={handleRunMatch}
          onExport={exportResults}
        />
      )}

      {/* 3) 결과 그룹 테이블 */}
      {list && list.items.length > 0 && (
        <div className="space-y-3">
          <GroupSection
            title="검토필요"
            status="REVIEW_NEEDED"
            items={list.items.filter((p) => p.match_status === 'REVIEW_NEEDED')}
            expanded={expandedGroup === 'REVIEW_NEEDED'}
            onToggle={() =>
              setExpandedGroup(expandedGroup === 'REVIEW_NEEDED' ? null : 'REVIEW_NEEDED')
            }
            onReview={(p) => setReviewTarget(p)}
            onChart={(p) => setChartTarget(p)}
          />
          <GroupSection
            title="자동매칭 · 확정"
            status="AUTO_MATCHED"
            items={list.items.filter(
              (p) => p.match_status === 'AUTO_MATCHED' || p.match_status === 'CONFIRMED',
            )}
            expanded={expandedGroup === 'AUTO_MATCHED'}
            onToggle={() =>
              setExpandedGroup(expandedGroup === 'AUTO_MATCHED' ? null : 'AUTO_MATCHED')
            }
            onReview={(p) => setReviewTarget(p)}
            onChart={(p) => setChartTarget(p)}
          />
          <GroupSection
            title="미발견"
            status="NOT_FOUND"
            items={list.items.filter((p) => p.match_status === 'NOT_FOUND')}
            expanded={expandedGroup === 'NOT_FOUND'}
            onToggle={() =>
              setExpandedGroup(expandedGroup === 'NOT_FOUND' ? null : 'NOT_FOUND')
            }
            onReview={(p) => setReviewTarget(p)}
            onChart={(p) => setChartTarget(p)}
          />
          <GroupSection
            title="매칭 대기"
            status="PENDING_MATCH"
            items={list.items.filter(
              (p) => p.match_status === 'PENDING_MATCH' || p.match_status == null,
            )}
            expanded={expandedGroup === 'PENDING_MATCH'}
            onToggle={() =>
              setExpandedGroup(expandedGroup === 'PENDING_MATCH' ? null : 'PENDING_MATCH')
            }
            onReview={(p) => setReviewTarget(p)}
            onChart={(p) => setChartTarget(p)}
          />
        </div>
      )}

      {/* 4) 후보 선택 모달 */}
      {reviewTarget && (
        <CandidateModal
          place={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onConfirm={handleConfirm}
        />
      )}

      {/* 5) 순위 추이 모달 */}
      {chartTarget && (
        <RankChartModal place={chartTarget} onClose={() => setChartTarget(null)} />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 업로드 카드
 * ──────────────────────────────────────────────────────────── */
function UploadCard(props: {
  uploading: boolean
  onFile: (f: File) => void
  onDownloadTemplate: () => void
}) {
  const { uploading, onFile, onDownloadTemplate } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Upload size={18} className="text-blue-600" />
          1단계 · 엑셀 업로드
        </h2>
        <button
          onClick={onDownloadTemplate}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-ink-1 inline-flex items-center gap-1"
        >
          <FileSpreadsheet size={14} />
          양식 다운로드
        </button>
      </div>
      <div
        onDragEnter={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        className={clsx(
          'rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
          drag ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
          uploading && 'opacity-60 pointer-events-none',
        )}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Loader2 className="animate-spin" size={32} />
            <p className="text-sm font-semibold">업로드 중…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="text-slate-400" size={32} />
            <p className="text-sm font-bold text-ink-1">
              엑셀 파일을 여기로 드래그하거나 클릭하세요
            </p>
            <p className="text-xs text-ink-2">
              컬럼: <code className="px-1 bg-slate-100 rounded">070전번 | 등록동 | 상호 | 추적키워드</code>
              <br />추적키워드는 쉼표(,)로 최대 5개
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 요약 바
 * ──────────────────────────────────────────────────────────── */
function SummaryBar(props: {
  list: RankPlaceListOut
  loading: boolean
  running: boolean
  onRefresh: () => void
  onRunMatch: () => void
  onExport: () => void
}) {
  const { list, loading, running, onRefresh, onRunMatch, onExport } = props

  const Tile = ({
    label,
    value,
    color,
  }: {
    label: string
    value: number
    color: string
  }) => (
    <div className={clsx('flex-1 px-3 py-2 rounded-lg ring-1', `bg-${color}-50 ring-${color}-200`)}>
      <div className="text-[11px] font-semibold text-ink-2">{label}</div>
      <div className={clsx('text-lg font-bold', `text-${color}-700`)}>{value}</div>
    </div>
  )

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-bold flex items-center gap-2 mr-auto">
          <Search size={18} className="text-blue-600" />
          2단계 · 매칭 결과 ({list.total}건)
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
        <button
          onClick={onRunMatch}
          disabled={running}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          매칭 재실행
        </button>
        <button
          onClick={onExport}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"
        >
          <Download size={14} />
          엑셀 다운로드
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Tile label="자동매칭" value={list.auto_matched} color="emerald" />
        <Tile label="확정" value={list.confirmed} color="blue" />
        <Tile label="검토필요" value={list.review_needed} color="amber" />
        <Tile label="미발견" value={list.not_found} color="rose" />
        <Tile label="매칭대기" value={list.pending} color="slate" />
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 그룹 섹션
 * ──────────────────────────────────────────────────────────── */
function GroupSection(props: {
  title: string
  status: string
  items: RankPlaceOut[]
  expanded: boolean
  onToggle: () => void
  onReview: (p: RankPlaceOut) => void
  onChart: (p: RankPlaceOut) => void
}) {
  const { title, status, items, expanded, onToggle, onReview, onChart } = props
  if (items.length === 0) return null
  const m = statusMeta(status as MatchStatus)
  const Icon = m.icon

  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-left"
      >
        <Icon className={`text-${m.color}-600`} size={18} />
        <span className="font-bold text-sm">{title}</span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full', `bg-${m.color}-100 text-${m.color}-700`)}>
          {items.length}건
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr className="text-ink-2">
                <th className="px-3 py-2 text-left font-semibold">상호</th>
                <th className="px-3 py-2 text-left font-semibold">070전번</th>
                <th className="px-3 py-2 text-left font-semibold">등록동</th>
                <th className="px-3 py-2 text-left font-semibold">추적키워드</th>
                <th className="px-3 py-2 text-left font-semibold">신뢰도</th>
                <th className="px-3 py-2 text-left font-semibold">place_id</th>
                <th className="px-3 py-2 text-right font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-blue-50/30">
                  <td className="px-3 py-2 font-semibold">{p.business_name || '-'}</td>
                  <td className="px-3 py-2 font-mono">{p.phone}</td>
                  <td className="px-3 py-2">{p.registered_dong || '-'}</td>
                  <td className="px-3 py-2 text-ink-2">{p.tracking_keywords.join(', ')}</td>
                  <td className="px-3 py-2">
                    {p.match_confidence != null ? `${p.match_confidence}점` : '-'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-2">{p.place_id || '-'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {(status === 'REVIEW_NEEDED' || p.candidates.length > 0) && (
                      <button
                        onClick={() => onReview(p)}
                        className="text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 mr-1"
                      >
                        후보 보기
                      </button>
                    )}
                    {p.place_id && (
                      <button
                        onClick={() => onChart(p)}
                        className="text-xs px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 inline-flex items-center gap-1"
                      >
                        <LineChartIcon size={12} />
                        추이
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 후보 선택 모달
 * ──────────────────────────────────────────────────────────── */
function CandidateModal(props: {
  place: RankPlaceOut
  onClose: () => void
  onConfirm: (p: RankPlaceOut, c: RankPlaceCandidate) => void
}) {
  const { place, onClose, onConfirm } = props
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">{place.business_name}</h3>
            <p className="text-xs text-ink-2">
              {place.phone} · {place.registered_dong} · 후보 {place.candidates.length}건
            </p>
          </div>
          <button onClick={onClose} className="text-ink-2 hover:text-ink-1 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="p-5 space-y-2">
          {place.candidates.length === 0 ? (
            <p className="text-sm text-ink-2 text-center py-8">후보가 없습니다.</p>
          ) : (
            place.candidates.map((c) => (
              <div
                key={c.place_id}
                className={clsx(
                  'p-3 rounded-lg border flex items-start justify-between gap-3',
                  c.place_id === place.place_id
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 hover:border-blue-300',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-sm">{c.name}</span>
                    <span className="text-xs text-ink-2">{c.category}</span>
                    <span className="ml-auto text-xs font-bold text-blue-700">{c.score}점</span>
                  </div>
                  <div className="text-xs text-ink-2 mt-1">
                    {c.phone || c.virtual_phone} · {c.address}
                  </div>
                  {c.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.reasons.map((r) => (
                        <span
                          key={r}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] font-mono text-ink-2 mt-1">place_id: {c.place_id}</div>
                </div>
                <button
                  onClick={() => onConfirm(place, c)}
                  className={clsx(
                    'shrink-0 text-xs font-semibold px-3 py-1.5 rounded',
                    c.place_id === place.place_id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white',
                  )}
                >
                  {c.place_id === place.place_id ? '✓ 확정됨' : '이걸로 확정'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 순위 추이 차트 모달 (SVG 라인차트, Y축 반전)
 * ──────────────────────────────────────────────────────────── */
function RankChartModal(props: { place: RankPlaceOut; onClose: () => void }) {
  const { place, onClose } = props
  const [days, setDays] = useState(30)
  const [data, setData] = useState<RankHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getRankHistory(place.id, days)
      .then((r) => {
        if (alive) setData(r)
      })
      .catch((e) => console.error('history fetch failed', e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [place.id, days])

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <LineChartIcon size={18} className="text-blue-600" />
              {place.business_name} · 순위 추이
            </h3>
            <p className="text-xs text-ink-2">
              {place.registered_dong} · place_id {place.place_id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={clsx(
                  'text-xs font-semibold px-2 py-1 rounded',
                  days === d ? 'bg-blue-600 text-white' : 'bg-slate-100 text-ink-1 hover:bg-slate-200',
                )}
              >
                {d}일
              </button>
            ))}
            <button onClick={onClose} className="text-ink-2 hover:text-ink-1 text-2xl leading-none ml-2">
              ×
            </button>
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-ink-2">
              <Loader2 className="animate-spin mr-2" size={20} />
              불러오는 중…
            </div>
          ) : !data || data.series.length === 0 ? (
            <div className="py-16 text-center text-sm text-ink-2">
              아직 기록된 순위 데이터가 없습니다.
              <br />
              매일 자동체크 이후 데이터가 누적됩니다.
            </div>
          ) : (
            <div className="space-y-6">
              {data.series.map((s) => (
                <KeywordChart key={s.keyword} keyword={s.keyword} points={s.points} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 키워드별 SVG 차트 (Y축 반전 — 1위가 위, 75위가 아래)
 * ──────────────────────────────────────────────────────────── */
function KeywordChart(props: {
  keyword: string
  points: { check_date: string; rank: number | null; out_of_range: boolean }[]
}) {
  const { keyword, points } = props

  const W = 720
  const H = 220
  const PAD_L = 40
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 28

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const ranks = points.map((p) => p.rank).filter((r): r is number => r != null)
  const maxRank = Math.max(75, ...(ranks.length ? ranks : [10]))
  // y: rank=1 → top, rank=maxRank → bottom (반전)
  const x = (i: number) => PAD_L + (points.length <= 1 ? innerW / 2 : (innerW * i) / (points.length - 1))
  const y = (r: number) => PAD_T + (innerH * (r - 1)) / Math.max(1, maxRank - 1)

  // 라인 path (rank null/out_of_range 는 끊김)
  const segments: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p.rank == null || p.out_of_range) {
      if (current.length) {
        segments.push(current.join(' '))
        current = []
      }
    } else {
      const prefix = current.length === 0 ? 'M' : 'L'
      current.push(`${prefix}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`)
    }
  })
  if (current.length) segments.push(current.join(' '))

  // 현재 순위 (마지막 데이터)
  const last = points[points.length - 1]
  const lastRank = last?.rank ?? null

  const yTicks = [1, 5, 10, 25, 50, 75].filter((t) => t <= maxRank)

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2">
        <h4 className="text-sm font-bold">{keyword}</h4>
        {lastRank != null ? (
          <span className="text-xs text-emerald-700 font-semibold">현재 {lastRank}위</span>
        ) : (
          <span className="text-xs text-rose-700 font-semibold">75위 밖</span>
        )}
        <span className="ml-auto text-[11px] text-ink-2">{points.length}일 기록</span>
      </div>
      <div className="bg-slate-50 rounded-lg p-2 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Y axis grid */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(t)}
                y2={y(t)}
                stroke="#e2e8f0"
                strokeDasharray={t === 1 ? '0' : '3 3'}
              />
              <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">
                {t}
              </text>
            </g>
          ))}
          {/* X axis labels (시작/중간/끝) */}
          {points.length > 0 && (
            <>
              <text x={x(0)} y={H - 8} fontSize="9" fill="#64748b" textAnchor="start">
                {points[0].check_date.slice(5)}
              </text>
              {points.length > 2 && (
                <text
                  x={x(Math.floor(points.length / 2))}
                  y={H - 8}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="middle"
                >
                  {points[Math.floor(points.length / 2)].check_date.slice(5)}
                </text>
              )}
              {points.length > 1 && (
                <text x={x(points.length - 1)} y={H - 8} fontSize="9" fill="#64748b" textAnchor="end">
                  {points[points.length - 1].check_date.slice(5)}
                </text>
              )}
            </>
          )}
          {/* Line segments */}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#2563eb" strokeWidth="2" />
          ))}
          {/* Points */}
          {points.map((p, i) => {
            if (p.rank == null || p.out_of_range) {
              return (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={H - PAD_B - 4}
                  r="3"
                  fill="#fecaca"
                  stroke="#dc2626"
                  strokeWidth="1"
                />
              )
            }
            return (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p.rank)}
                r="3"
                fill="#2563eb"
                stroke="white"
                strokeWidth="1"
              />
            )
          })}
        </svg>
      </div>
    </div>
  )
}
