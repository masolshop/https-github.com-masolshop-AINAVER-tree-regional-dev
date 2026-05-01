/**
 * 키워드 발굴 페이지 (솔루션 #1)
 *
 * 흐름:
 *   1) 사용자가 키워드를 한 줄당 1개씩 입력 (최대 30개)
 *   2) [분석 시작] → /api/v1/keyword/discover/batch 호출
 *   3) 결과 카드/테이블 + KPI 6종 + 엑셀 다운로드
 *
 * 분류 색상:
 *   · 메인           — emerald
 *   · 타지역(확정)    — orange  (070 / 흥신소)
 *   · 타지역(의심)    — yellow  (주소가 동/리까지만)
 *   · 미상           — slate
 */
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import clsx from 'clsx'
import {
  Search as SearchIcon,
  Download,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { keywordApi } from '@/api/keyword'
import type {
  KeywordDiscoverResult,
  KeywordPlaceItem,
  KeywordClassification,
} from '@/api/keyword'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'

// ──────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────
const CLS_LABEL: Record<KeywordClassification, string> = {
  third_party: '타지역',
  third_party_suspect: '타지역(의심)',
  main: '메인',
  unknown: '미상',
}

const CLS_PILL: Record<KeywordClassification, string> = {
  third_party: 'bg-orange-100 text-orange-800 ring-1 ring-orange-200',
  third_party_suspect: 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-200',
  main: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  unknown: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
}

function ClassificationPill({ c }: { c: KeywordClassification }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap',
        CLS_PILL[c],
      )}
    >
      {CLS_LABEL[c]}
    </span>
  )
}

function todayKstDate(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000)
  return kst.toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────
export default function KeywordDiscover() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [text, setText] = useState<string>('선불폰\n심부름센터\n흥신소')
  const [display, setDisplay] = useState<number>(10)
  const [pace, setPace] = useState<number>(500)
  const [useCache, setUseCache] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<KeywordDiscoverResult[]>([])
  const [errMsg, setErrMsg] = useState<string>('')

  const keywords = useMemo(
    () =>
      text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [text],
  )

  // ── KPI 집계 ─────────────────────────────────────
  const kpi = useMemo(() => {
    const fetched = results.filter((r) => r.source === 'html_apollo').length
    const tpKeywords = results.filter((r) => r.summary?.is_third_party_keyword).length
    let total = 0,
      tp = 0,
      sus = 0,
      main = 0
    for (const r of results) {
      total += r.summary?.total ?? 0
      tp += r.summary?.third_party_count ?? 0
      sus += r.summary?.third_party_suspect_count ?? 0
      main += r.summary?.main_count ?? 0
    }
    return { fetched, tpKeywords, total, tp, sus, main }
  }, [results])

  // ── 분석 실행 ─────────────────────────────────────
  async function runAnalyze() {
    setErrMsg('')
    if (!isAuthenticated) {
      openLoginModal('/keyword')
      return
    }
    if (!keywords.length) {
      setErrMsg('키워드를 1개 이상 입력해 주세요.')
      return
    }
    if (keywords.length > 30) {
      setErrMsg('한 번에 최대 30개 키워드까지 가능합니다.')
      return
    }
    setLoading(true)
    setResults([])
    setProgress({ done: 0, total: keywords.length })

    try {
      // 백엔드가 batch 를 순차 처리 (pace_ms 적용) — 단일 호출로 일괄 수행.
      const resp = await keywordApi.discoverBatch({
        keywords,
        display,
        pace_ms: pace,
        use_cache: useCache,
      })
      setResults(resp.results || [])
      setProgress({ done: keywords.length, total: keywords.length })
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status === 429 ? '요청이 많아 잠시 후 다시 시도해 주세요. ' : ''}${e.message}`
          : (e as Error).message || '분석 실패'
      setErrMsg(msg)
    } finally {
      setLoading(false)
      setTimeout(() => setProgress(null), 800)
    }
  }

  // ── 엑셀 다운로드 ─────────────────────────────────
  function downloadXlsx() {
    if (!results.length) return

    const summaryRows = results.map((r) => ({
      키워드: r.keyword,
      타지역키워드여부: r.summary?.is_third_party_keyword ? 'Y' : 'N',
      총노출: r.summary?.total ?? 0,
      타지역확정: r.summary?.third_party_count ?? 0,
      타지역의심: r.summary?.third_party_suspect_count ?? 0,
      메인: r.summary?.main_count ?? 0,
      미상: r.summary?.unknown_count ?? 0,
      타지역비율: ((r.summary?.third_party_ratio ?? 0) * 100).toFixed(1) + '%',
      소스: r.source,
      에러: r.error || '',
      가져온시각: r.fetched_at || '',
    }))

    const detailRows: Record<string, unknown>[] = []
    for (const r of results) {
      for (const it of r.items || []) {
        detailRows.push({
          키워드: r.keyword,
          순위: it.rank,
          분류: CLS_LABEL[it.classification],
          상호: it.name,
          전화: it.phone || '',
          카테고리: it.category || '',
          도로명주소: it.road_address || '',
          지번주소: it.address || '',
          영업상태: it.business_status || '',
          네이버예약: it.naver_booking ? 'Y' : '',
          방문자리뷰: it.visitor_review_count ?? '',
          블로그리뷰: it.blog_review_count ?? '',
          PlaceID: it.place_id,
          URL: `https://m.place.naver.com/place/${it.place_id}`,
        })
      }
    }

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(summaryRows)
    const ws2 = XLSX.utils.json_to_sheet(detailRows)
    ws1['!cols'] = [
      { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 24 },
    ]
    ws2['!cols'] = [
      { wch: 14 }, { wch: 6 }, { wch: 12 }, { wch: 26 }, { wch: 16 },
      { wch: 18 }, { wch: 36 }, { wch: 36 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 48 },
    ]
    XLSX.utils.book_append_sheet(wb, ws1, '키워드_요약')
    XLSX.utils.book_append_sheet(wb, ws2, '플레이스_상세')
    XLSX.writeFile(wb, `네이버_1페이지_키워드발굴_${todayKstDate()}.xlsx`)
  }

  // ──────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-5">
      <header>
        <h1 className="text-2xl lg:text-3xl font-bold text-ink flex items-center gap-2">
          <Sparkles className="text-amber-500" size={26} />
          네이버 1페이지 키워드 발굴
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          네이버 모바일 플레이스 1페이지에서{' '}
          <span className="font-semibold text-ink">메인 / 타지역</span> 플레이스를 자동 분류해{' '}
          <span className="font-semibold text-amber-600">타지역 노출 키워드</span>를 발굴합니다.
          (070 → 타지역 확정, 흥신소 룰, 주소 단순도 보조 룰 적용)
        </p>
      </header>

      {/* 검색 카드 */}
      <Card className="p-5">
        <div className="flex flex-col lg:flex-row gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="키워드를 한 줄에 하나씩 입력 (최대 30개)"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm focus:border-brand-400 focus:outline-none font-mono"
          />
          <div className="flex flex-row lg:flex-col gap-2 lg:w-44">
            <button
              onClick={runAnalyze}
              disabled={loading || !keywords.length}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  분석 중...
                </>
              ) : (
                <>
                  <SearchIcon size={16} />
                  분석 시작
                </>
              )}
            </button>
            <button
              onClick={downloadXlsx}
              disabled={!results.length}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              <Download size={16} />
              엑셀 다운로드
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            가져올 개수
            <input
              type="number"
              min={1}
              max={20}
              value={display}
              onChange={(e) => setDisplay(parseInt(e.target.value || '10', 10))}
              className="w-16 border border-line rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            호출 간격(ms)
            <input
              type="number"
              min={200}
              max={3000}
              step={100}
              value={pace}
              onChange={(e) => setPace(parseInt(e.target.value || '500', 10))}
              className="w-20 border border-line rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={useCache}
              onChange={(e) => setUseCache(e.target.checked)}
            />
            6시간 캐시 사용
          </label>
          <span className="ml-auto">
            입력 키워드: <strong>{keywords.length}</strong>
            {progress && (
              <span className="ml-2 text-brand-700">
                · 진행 {progress.done}/{progress.total}
              </span>
            )}
          </span>
        </div>

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>{errMsg}</div>
          </div>
        )}
      </Card>

      {/* KPI 카드들 */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Kpi label="분석 키워드" value={results.length} tone="default" />
          <Kpi label="타지역 키워드" value={kpi.tpKeywords} tone="orange" />
          <Kpi label="플레이스 노출" value={kpi.fetched} tone="default" />
          <Kpi label="타지역 확정" value={kpi.tp} tone="orange" />
          <Kpi label="타지역 의심" value={kpi.sus} tone="yellow" />
          <Kpi label="메인" value={kpi.main} tone="emerald" />
        </div>
      )}

      {/* 키워드별 상세 카드 */}
      {results.map((r) => (
        <KeywordResultCard key={r.keyword} r={r} />
      ))}

      {!results.length && !loading && (
        <Card className="p-8 text-center text-sm text-ink-muted">
          분석할 키워드를 입력한 뒤 <strong>분석 시작</strong> 버튼을 눌러주세요.
          <br />
          한 번에 최대 30개 키워드까지 분석할 수 있습니다 (분당 호출 제한 20개).
        </Card>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────
// sub components
// ──────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'default' | 'orange' | 'yellow' | 'emerald'
}) {
  const toneCls: Record<typeof tone, string> = {
    default: 'text-ink',
    orange: 'text-orange-600',
    yellow: 'text-yellow-600',
    emerald: 'text-emerald-600',
  } as const
  return (
    <Card className="p-4">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={clsx('text-2xl font-bold mt-1 tabular-nums', toneCls[tone])}>{value}</div>
    </Card>
  )
}

function KeywordResultCard({ r }: { r: KeywordDiscoverResult }) {
  const sm = r.summary
  const isTpKw = sm?.is_third_party_keyword
  const ratio = ((sm?.third_party_ratio ?? 0) * 100).toFixed(0)

  return (
    <Card className="overflow-hidden p-0">
      <div
        className={clsx(
          'px-5 py-3 border-b border-line flex flex-wrap items-center gap-2',
          isTpKw ? 'bg-amber-50' : 'bg-bg-subtle',
        )}
      >
        <h2 className="font-bold text-ink text-base">{r.keyword}</h2>
        {isTpKw && (
          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 ring-1 ring-orange-200 text-[11px] font-bold">
            타지역 키워드
          </span>
        )}
        <span
          className={clsx(
            'px-2 py-0.5 rounded-full text-[11px] font-semibold',
            r.source === 'html_apollo'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-rose-100 text-rose-700',
          )}
        >
          {r.source === 'html_apollo' ? 'apollo' : 'no-result'}
        </span>
        {r.from_cache && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px]">
            cache
          </span>
        )}
        <span className="text-xs text-ink-muted ml-auto">
          총 {sm?.total ?? 0} · 타지역 {sm?.third_party_count ?? 0} · 의심{' '}
          {sm?.third_party_suspect_count ?? 0} · 메인 {sm?.main_count ?? 0} · 비율 {ratio}%
          {r.elapsed_ms ? ` · ${r.elapsed_ms}ms` : ''}
        </span>
      </div>

      {r.error && (
        <div className="px-5 py-2.5 text-sm text-rose-700 bg-rose-50 border-b border-rose-100 flex items-center gap-1.5">
          <AlertTriangle size={14} /> {r.error}
        </div>
      )}

      {r.items?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-ink-muted text-xs">
              <tr>
                <th className="px-3 py-2 text-left">순위</th>
                <th className="px-3 py-2 text-left">분류</th>
                <th className="px-3 py-2 text-left">상호</th>
                <th className="px-3 py-2 text-left">전화</th>
                <th className="px-3 py-2 text-left">카테고리</th>
                <th className="px-3 py-2 text-left">주소</th>
                <th className="px-3 py-2 text-left">Place</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it: KeywordPlaceItem) => (
                <tr key={`${r.keyword}-${it.place_id}`} className="border-t border-line hover:bg-bg-subtle/50">
                  <td className="px-3 py-2 tabular-nums">{it.rank}</td>
                  <td className="px-3 py-2">
                    <ClassificationPill c={it.classification} />
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">{it.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{it.phone || '-'}</td>
                  <td className="px-3 py-2 text-ink-muted">{it.category || '-'}</td>
                  <td className="px-3 py-2 text-ink-muted text-xs">
                    {it.road_address || it.address || '-'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <a
                      href={`https://m.place.naver.com/place/${encodeURIComponent(it.place_id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {it.place_id} <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  )
}
