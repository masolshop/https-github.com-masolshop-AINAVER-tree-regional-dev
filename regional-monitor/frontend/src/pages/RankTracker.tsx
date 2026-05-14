/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5) — 풀 구현 페이지.
 *
 * 정책 (070+동 단일 매칭, 자동 확정):
 *  · 070 가상번호 = 본인 번호이므로 시스템이 자동으로 place_id 확정.
 *  · 사용자 개입은 "070 일치하지만 등록동≠실제 노출동(변경 노출)" 케이스만.
 *  · UI = 변경 노출 배너 + 등록동×키워드 매트릭스 1개 + 키워드별 30일 추이 그래프 N개.
 *
 * 구성:
 *  1) Excel 업로드 카드 (드래그&드롭 + 파일선택 + 템플릿 다운로드)
 *  2) 변경 노출 배너 (등록동≠실제 노출동인 케이스 N건 알림)
 *  3) 매칭 결과 요약 + 매칭 재실행 + 엑셀 다운로드
 *  4) 등록동 × 키워드 매트릭스 (현재 순위 한눈에)
 *  5) 키워드별 30일 순위 추이 SVG 라인차트 (Y축 반전)
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
  Loader2,
  ChevronDown,
  ChevronUp,
  LineChart as LineChartIcon,
  Search,
  MapPin,
} from 'lucide-react'
import clsx from 'clsx'

import { Card } from '@/components/ui/Card'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import {
  uploadRankRows,
  listRankPlaces,
  listDongChanged,
  runMatch,
  getRankHistory,
  type RankUploadRow,
  type RankPlaceOut,
  type RankPlaceListOut,
  type DongChangedListOut,
} from '@/api/rankTracker'

/* ────────────────────────────────────────────────────────────
 * 유틸: 날짜
 * ──────────────────────────────────────────────────────────── */
function todayKst(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/* ────────────────────────────────────────────────────────────
 * 페이지 본체
 * ──────────────────────────────────────────────────────────── */
export default function RankTracker() {
  useBodyClass('solution-tool-page')

  // 데이터
  const [list, setList] = useState<RankPlaceListOut | null>(null)
  const [dongChanged, setDongChanged] = useState<DongChangedListOut | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  /* ── 목록 fetch ── */
  const fetchAll = useCallback(async () => {
    setLoadingList(true)
    try {
      const [r1, r2] = await Promise.all([listRankPlaces(), listDongChanged()])
      setList(r1)
      setDongChanged(r2)
    } catch (e) {
      console.error('fetch failed', e)
      showToast('목록 조회 실패')
    } finally {
      setLoadingList(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 매칭 진행 중에는 5초 폴링
  const hasPending = useMemo(() => (list?.pending ?? 0) > 0, [list])
  useEffect(() => {
    if (!hasPending) return
    const t = window.setInterval(() => fetchAll(), 5000)
    return () => window.clearInterval(t)
  }, [hasPending, fetchAll])

  /* ── 업로드 ── */
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const { parseXlsxFile } = await import('@/utils/xlsx')
        const rows = await parseXlsxFile(file)
        const payload: RankUploadRow[] = rows
          .map((row: Record<string, unknown>) => {
            const phone = String(
              row['070전번'] ?? row['phone'] ?? row['전화번호'] ?? row['070'] ?? '',
            ).trim()
            const dong = String(row['등록동'] ?? row['dong'] ?? row['동'] ?? '').trim()
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
            return {
              phone,
              registered_dong: dong,
              business_name: biz,
              tracking_keywords: keywords,
            }
          })
          .filter(
            (r) =>
              r.phone && r.registered_dong && r.business_name && r.tracking_keywords.length,
          )

        if (payload.length === 0) {
          showToast(
            '업로드 가능한 행이 없습니다. (070전번/등록동/상호/추적키워드 컬럼 확인)',
          )
          return
        }
        const resp = await uploadRankRows(payload)
        showToast(
          `업로드 완료 — 신규 ${resp.created} · 갱신 ${resp.updated} · 오류 ${resp.errors}건. 매칭이 백그라운드에서 진행됩니다.`,
        )
        await fetchAll()
      } catch (e) {
        console.error('upload failed', e)
        showToast('업로드 실패: ' + (e as Error).message)
      } finally {
        setUploading(false)
      }
    },
    [fetchAll, showToast],
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
      매칭상태: p.match_status ?? 'PENDING_MATCH',
      변경노출: p.dong_changed ? 'Y' : 'N',
      실제노출동: p.actual_dong ?? '',
      매칭상호: p.matched?.name ?? '',
      매칭주소: p.matched?.address ?? '',
      place_id: p.place_id ?? '',
      매칭일시: p.matched_at ?? '',
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '매칭요약')
    XLSX.writeFile(wb, `타지역_순위자동체크_결과_${todayKst()}.xlsx`)
  }, [list])

  /* ── 매칭 재실행 ── */
  const handleRunMatch = useCallback(async () => {
    setRunning(true)
    try {
      const r = await runMatch({})
      showToast(`${r.requested}건 매칭 백그라운드 실행`)
      await fetchAll()
    } catch (e) {
      showToast('매칭 실행 실패: ' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [fetchAll, showToast])

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
          네이버 플레이스 <strong>자동 확정 매칭</strong> + 매일 자동체크로 동별 노출
          순위를 시계열 그래프로 추적합니다.
        </p>
      </div>

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* 0) 변경 노출 배너 — 등록동≠실제 노출동 케이스 알림 */}
      {dongChanged && dongChanged.count > 0 && (
        <DongChangedBanner data={dongChanged} />
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
          onRefresh={fetchAll}
          onRunMatch={handleRunMatch}
          onExport={exportResults}
        />
      )}

      {/* 3) 등록동 × 키워드 매트릭스 — 현재 순위 한눈에 */}
      {list && list.items.length > 0 && <RankMatrix list={list} />}

      {/* 4) 키워드별 30일 추이 그래프 N개 */}
      {list && list.items.length > 0 && <KeywordGraphSection list={list} />}
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
          drag
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
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
              컬럼:{' '}
              <code className="px-1 bg-slate-100 rounded">
                070전번 | 등록동 | 상호 | 추적키워드
              </code>
              <br />
              추적키워드는 쉼표(,)로 최대 5개
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
 * 컴포넌트: 변경 노출 배너
 *  - 등록동≠실제 노출동인 케이스 알림
 *  - 클릭하면 펼쳐서 상호/등록동/실제노출동/place_id 표시
 * ──────────────────────────────────────────────────────────── */
function DongChangedBanner(props: { data: DongChangedListOut }) {
  const { data } = props
  const [open, setOpen] = useState(false)

  return (
    <Card className="p-0 overflow-hidden border-amber-300 ring-1 ring-amber-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 hover:bg-amber-100 text-left"
      >
        <AlertTriangle className="text-amber-600 shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-900">
            변경 노출 발견 {data.count}건
          </div>
          <div className="text-xs text-amber-800/80">
            등록하신 동(洞)과 실제 네이버 플레이스 노출 동이 다른 케이스입니다. 클릭하여
            상세를 확인하세요.
          </div>
        </div>
        {open ? (
          <ChevronUp className="text-amber-700 shrink-0" size={18} />
        ) : (
          <ChevronDown className="text-amber-700 shrink-0" size={18} />
        )}
      </button>
      {open && (
        <div className="border-t border-amber-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-amber-50/60">
              <tr className="text-amber-900">
                <th className="px-3 py-2 text-left font-semibold">상호</th>
                <th className="px-3 py-2 text-left font-semibold">070전번</th>
                <th className="px-3 py-2 text-left font-semibold">등록동</th>
                <th className="px-3 py-2 text-left font-semibold">실제 노출동</th>
                <th className="px-3 py-2 text-left font-semibold">주소</th>
                <th className="px-3 py-2 text-left font-semibold">place_id</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-t border-amber-100 hover:bg-amber-50/40">
                  <td className="px-3 py-2 font-semibold">{it.business_name || '-'}</td>
                  <td className="px-3 py-2 font-mono">{it.phone}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {it.registered_dong || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold inline-flex items-center gap-1">
                      <MapPin size={11} />
                      {it.actual_dong || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{it.address || '-'}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-2">
                    {it.place_id || '-'}
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
 * 컴포넌트: 요약 바
 *  - 자동매칭 / 매칭대기 / 수동확인필요 / 변경노출 4개 타일
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
    <div
      className={clsx(
        'flex-1 px-3 py-2 rounded-lg ring-1',
        `bg-${color}-50 ring-${color}-200`,
      )}
    >
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
          {running ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
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
        <Tile label="매칭대기" value={list.pending} color="slate" />
        <Tile label="수동확인필요" value={list.needs_manual} color="amber" />
        <Tile label="변경노출" value={list.dong_changed_count} color="orange" />
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 등록동 × 키워드 매트릭스
 *  - rows = 등록 플레이스 (상호 + 등록동)
 *  - cols = 모든 추적 키워드 (unique)
 *  - cells = 현재 순위 (place×keyword 의 최신 rank)
 *  - 첫 컬럼 sticky
 * ──────────────────────────────────────────────────────────── */
function RankMatrix(props: { list: RankPlaceListOut }) {
  const { list } = props

  // 매칭 완료(place_id 있음)된 행만 매트릭스에 표시
  const items = useMemo(() => list.items.filter((p) => !!p.place_id), [list])

  // 모든 키워드 union
  const allKeywords = useMemo(() => {
    const s = new Set<string>()
    items.forEach((p) => p.tracking_keywords.forEach((k) => s.add(k)))
    return Array.from(s)
  }, [items])

  // (placePk × keyword) → 최신 rank cache
  const [rankMap, setRankMap] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (items.length === 0) return
    setLoading(true)
    try {
      // 병렬 fetch (최대 동시성 8)
      const queue = [...items]
      const next: Record<string, number | null> = {}
      const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
        while (queue.length) {
          const p = queue.shift()
          if (!p) break
          try {
            const hist = await getRankHistory(p.id, 1)
            for (const s of hist.series) {
              const last = s.points[s.points.length - 1]
              const rank = last?.rank ?? null
              next[`${p.id}::${s.keyword}`] = rank
            }
          } catch (e) {
            console.error('history fetch failed', p.id, e)
          }
        }
      })
      await Promise.all(workers)
      setRankMap(next)
    } finally {
      setLoading(false)
    }
  }, [items])

  useEffect(() => {
    reload()
  }, [reload])

  if (items.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-ink-2">
        매칭 완료된 플레이스가 없습니다. 엑셀을 업로드하고 매칭이 끝날 때까지 잠시
        기다려 주세요.
      </Card>
    )
  }

  const rankCell = (rank: number | null | undefined) => {
    if (rank == null) return <span className="text-ink-2 text-xs">—</span>
    if (rank > 75)
      return <span className="text-rose-600 font-semibold text-xs">75위 밖</span>
    const tone =
      rank <= 3
        ? 'bg-emerald-100 text-emerald-800'
        : rank <= 10
          ? 'bg-blue-100 text-blue-800'
          : rank <= 30
            ? 'bg-slate-100 text-slate-800'
            : 'bg-amber-100 text-amber-800'
    return (
      <span className={clsx('inline-block px-2 py-0.5 rounded font-bold text-xs', tone)}>
        {rank}위
      </span>
    )
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <CheckCircle2 className="text-blue-600" size={18} />
        <h2 className="text-base font-bold">3단계 · 등록동 × 키워드 매트릭스</h2>
        <span className="text-xs text-ink-2">(현재 최신 순위)</span>
        {loading && (
          <Loader2 className="text-blue-500 animate-spin ml-2" size={14} />
        )}
        <button
          onClick={reload}
          disabled={loading}
          className="ml-auto text-xs font-semibold px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr className="text-ink-2">
              <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-slate-50 z-10 min-w-[180px]">
                상호 / 등록동
              </th>
              {allKeywords.map((kw) => (
                <th
                  key={kw}
                  className="px-3 py-2 text-center font-semibold whitespace-nowrap"
                >
                  {kw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-blue-50/30">
                <td className="px-3 py-2 sticky left-0 bg-white z-10 border-r border-slate-100">
                  <div className="font-semibold">{p.business_name || '-'}</div>
                  <div className="text-[11px] text-ink-2 flex items-center gap-1 mt-0.5">
                    <span className="px-1 rounded bg-slate-100">
                      {p.registered_dong || '-'}
                    </span>
                    {p.dong_changed && p.actual_dong && (
                      <span className="px-1 rounded bg-amber-100 text-amber-800 inline-flex items-center gap-0.5">
                        <MapPin size={10} />
                        실제 {p.actual_dong}
                      </span>
                    )}
                  </div>
                </td>
                {allKeywords.map((kw) => {
                  const tracked = p.tracking_keywords.includes(kw)
                  if (!tracked) {
                    return (
                      <td
                        key={kw}
                        className="px-3 py-2 text-center text-ink-2 text-[11px]"
                      >
                        ·
                      </td>
                    )
                  }
                  const r = rankMap[`${p.id}::${kw}`]
                  return (
                    <td key={kw} className="px-3 py-2 text-center">
                      {rankCell(r)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 키워드별 추이 그래프 섹션
 *  - 모든 키워드별로 1개씩 카드
 *  - 각 카드 안에 해당 키워드를 추적하는 모든 플레이스의 30일 라인을 겹쳐서 그림
 * ──────────────────────────────────────────────────────────── */
function KeywordGraphSection(props: { list: RankPlaceListOut }) {
  const { list } = props

  const items = useMemo(() => list.items.filter((p) => !!p.place_id), [list])

  const allKeywords = useMemo(() => {
    const s = new Set<string>()
    items.forEach((p) => p.tracking_keywords.forEach((k) => s.add(k)))
    return Array.from(s)
  }, [items])

  if (items.length === 0 || allKeywords.length === 0) return null

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChartIcon className="text-blue-600" size={18} />
        <h2 className="text-base font-bold">4단계 · 키워드별 30일 순위 추이</h2>
      </div>
      <div className="space-y-6">
        {allKeywords.map((kw) => (
          <KeywordRankCard key={kw} keyword={kw} places={items} />
        ))}
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 단일 키워드 카드
 *  - 키워드를 추적하는 모든 플레이스의 30일 라인 차트
 * ──────────────────────────────────────────────────────────── */
interface KeywordSeriesEntry {
  placePk: number
  label: string
  points: { check_date: string; rank: number | null; out_of_range: boolean }[]
}

function KeywordRankCard(props: { keyword: string; places: RankPlaceOut[] }) {
  const { keyword, places } = props
  const tracking = useMemo(
    () => places.filter((p) => p.tracking_keywords.includes(keyword)),
    [places, keyword],
  )

  const [series, setSeries] = useState<KeywordSeriesEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all(
      tracking.map(async (p) => {
        try {
          const hist = await getRankHistory(p.id, 30)
          const s = hist.series.find((x) => x.keyword === keyword)
          return {
            placePk: p.id,
            label: `${p.business_name ?? '-'} (${p.registered_dong ?? '-'})`,
            points: s?.points ?? [],
          } as KeywordSeriesEntry
        } catch (e) {
          console.error('history failed', p.id, e)
          return {
            placePk: p.id,
            label: p.business_name ?? '-',
            points: [],
          } as KeywordSeriesEntry
        }
      }),
    )
      .then((entries) => {
        if (!alive) return
        setSeries(entries.filter((e) => e.points.length > 0))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [tracking, keyword])

  if (tracking.length === 0) return null

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-bold">{keyword}</h3>
        <span className="text-xs text-ink-2">
          {tracking.length}개 플레이스 추적 중
        </span>
        {loading && (
          <Loader2 className="text-blue-500 animate-spin ml-2" size={12} />
        )}
      </div>
      {series.length === 0 && !loading ? (
        <div className="py-10 text-center text-xs text-ink-2">
          아직 기록된 순위 데이터가 없습니다. 매일 자동체크 이후 데이터가 누적됩니다.
        </div>
      ) : (
        <MultiLineChart series={series} />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 다중 라인 SVG 차트 (Y축 반전, 1위=상단)
 * ──────────────────────────────────────────────────────────── */
const LINE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
]

function MultiLineChart(props: { series: KeywordSeriesEntry[] }) {
  const { series } = props

  const W = 760
  const H = 240
  const PAD_L = 40
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 28

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  // 가장 긴 시리즈의 날짜 축 기준
  const longest =
    series.reduce(
      (acc, s) => (s.points.length > acc.points.length ? s : acc),
      series[0],
    ) ?? null
  const len = longest?.points.length ?? 0
  if (len === 0) return null

  const ranks = series.flatMap((s) =>
    s.points.map((p) => p.rank).filter((r): r is number => r != null),
  )
  const maxRank = Math.max(75, ...(ranks.length ? ranks : [10]))

  const x = (i: number) =>
    PAD_L + (len <= 1 ? innerW / 2 : (innerW * i) / (len - 1))
  const y = (r: number) => PAD_T + (innerH * (r - 1)) / Math.max(1, maxRank - 1)

  const yTicks = [1, 5, 10, 25, 50, 75].filter((t) => t <= maxRank)

  // 각 시리즈의 path 계산
  const lines = series.map((s, idx) => {
    const segments: string[] = []
    let current: string[] = []
    s.points.forEach((p, i) => {
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
    return {
      idx,
      label: s.label,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      segments,
      points: s.points,
      lastRank: s.points[s.points.length - 1]?.rank ?? null,
    }
  })

  return (
    <div>
      <div className="bg-slate-50 rounded-lg p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
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
              <text
                x={PAD_L - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize="10"
                fill="#64748b"
              >
                {t}
              </text>
            </g>
          ))}
          {/* X axis labels */}
          {longest && longest.points.length > 0 && (
            <>
              <text
                x={x(0)}
                y={H - 8}
                fontSize="9"
                fill="#64748b"
                textAnchor="start"
              >
                {longest.points[0].check_date.slice(5)}
              </text>
              {longest.points.length > 2 && (
                <text
                  x={x(Math.floor(longest.points.length / 2))}
                  y={H - 8}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="middle"
                >
                  {longest.points[
                    Math.floor(longest.points.length / 2)
                  ].check_date.slice(5)}
                </text>
              )}
              {longest.points.length > 1 && (
                <text
                  x={x(longest.points.length - 1)}
                  y={H - 8}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="end"
                >
                  {longest.points[longest.points.length - 1].check_date.slice(5)}
                </text>
              )}
            </>
          )}
          {/* Lines + points */}
          {lines.map((ln) => (
            <g key={ln.idx}>
              {ln.segments.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={ln.color}
                  strokeWidth="2"
                />
              ))}
              {ln.points.map((p, i) => {
                if (p.rank == null || p.out_of_range) return null
                return (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p.rank)}
                    r="2.5"
                    fill={ln.color}
                    stroke="white"
                    strokeWidth="1"
                  />
                )
              })}
            </g>
          ))}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {lines.map((ln) => (
          <div key={ln.idx} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: ln.color }}
            />
            <span className="text-ink-1">{ln.label}</span>
            {ln.lastRank != null ? (
              <span className="text-emerald-700 font-semibold">
                {ln.lastRank}위
              </span>
            ) : (
              <span className="text-rose-600 font-semibold">75위 밖</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
