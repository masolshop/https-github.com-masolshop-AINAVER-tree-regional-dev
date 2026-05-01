/**
 * 네이버 1페이지 키워드 발굴 — 메인/타지역 자동 분류.
 *
 * 솔루션 #1: 키워드 입력 → 네이버 모바일 1페이지 플레이스 5~7건 →
 *   070/흥신소/주소상세 룰로 분류 → KPI/테이블/엑셀 다운로드.
 *
 * 백엔드: POST /api/v1/keyword/discover/batch
 *
 * 분류 4단계 (룰 v2):
 *   · main                — 도로명 + 번지/건물명 상세 보유 (메인 사업자)
 *   · third_party         — 070 번호 또는 흥신소 키워드 (확정 타지역)
 *   · third_party_suspect — 동/리 단위 주소만 있는 의심 케이스
 *   · unknown             — 정보 부족
 */
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  Search,
  Download,
  Loader2,
  AlertCircle,
  ExternalLink,
  Filter,
} from 'lucide-react'

import {
  keywordApi,
  type KeywordClassification,
  type KeywordDiscoverResult,
  type KeywordPlaceItem,
} from '@/api/keyword'

const DEFAULT_KEYWORDS = ['선불폰', '심부름센터', '흥신소'].join('\n')

type Filter = 'all' | KeywordClassification

const CLASSIFICATION_META: Record<
  KeywordClassification,
  { label: string; bg: string; text: string; ring: string }
> = {
  third_party: {
    label: '타지역 확정',
    bg: 'bg-orange-100',
    text: 'text-orange-800',
    ring: 'ring-orange-300',
  },
  third_party_suspect: {
    label: '타지역 의심',
    bg: 'bg-yellow-100',
    text: 'text-yellow-800',
    ring: 'ring-yellow-300',
  },
  main: {
    label: '메인',
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    ring: 'ring-emerald-300',
  },
  unknown: {
    label: '미상',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    ring: 'ring-slate-300',
  },
}

function ClassificationPill({ c }: { c: KeywordClassification }) {
  const m = CLASSIFICATION_META[c]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.bg} ${m.text}`}
    >
      {m.label}
    </span>
  )
}

export default function KeywordDiscover() {
  const [input, setInput] = useState(DEFAULT_KEYWORDS)
  const [display, setDisplay] = useState(10)
  const [paceMs, setPaceMs] = useState(500)
  const [useCache, setUseCache] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [results, setResults] = useState<KeywordDiscoverResult[]>([])

  const runMut = useMutation({
    mutationFn: () => {
      const keywords = input
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!keywords.length) {
        throw new Error('키워드를 1개 이상 입력하세요.')
      }
      if (keywords.length > 50) {
        throw new Error('한 번에 최대 50개까지 분석 가능합니다.')
      }
      return keywordApi.discoverBatch({
        keywords,
        display,
        pace_ms: paceMs,
        use_cache: useCache,
      })
    },
    onSuccess: (data) => {
      setResults(data.results || [])
    },
  })

  // ── KPI 집계 ────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totalKw = results.length
    const tpKw = results.filter((r) => r.summary?.is_third_party_keyword).length
    const noPlace = results.filter((r) => r.source === 'none').length
    const items = results.flatMap((r) => r.items || [])
    const tp = items.filter((i) => i.classification === 'third_party').length
    const sus = items.filter((i) => i.classification === 'third_party_suspect').length
    const main = items.filter((i) => i.classification === 'main').length
    const unk = items.filter((i) => i.classification === 'unknown').length
    return {
      totalKw,
      tpKw,
      noPlace,
      total: items.length,
      tp,
      sus,
      main,
      unk,
    }
  }, [results])

  // ── 엑셀 다운로드 ────────────────────────────────────────
  const downloadXlsx = () => {
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
          분류: CLASSIFICATION_META[it.classification].label,
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
      { wch: 14 }, { wch: 6 }, { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 18 },
      { wch: 36 }, { wch: 36 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 14 }, { wch: 48 },
    ]
    XLSX.utils.book_append_sheet(wb, ws1, '키워드_요약')
    XLSX.utils.book_append_sheet(wb, ws2, '플레이스_상세')
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `네이버_1페이지_키워드발굴_${today}.xlsx`)
  }

  // ── 필터 적용 (각 키워드 카드 내부) ──────────────────────
  const filterItems = (items: KeywordPlaceItem[]): KeywordPlaceItem[] => {
    if (filter === 'all') return items
    return items.filter((i) => i.classification === filter)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      {/* 헤더 */}
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink lg:text-3xl">
          <Search className="text-brand-600" size={28} />
          네이버 1페이지 키워드 발굴
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          입력한 키워드의 네이버 모바일 1페이지 노출 플레이스를 메인/타지역으로 자동 분류합니다.
          (070·흥신소·주소 단순도 룰 적용)
        </p>
      </header>

      {/* 입력 카드 */}
      <section className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="키워드를 한 줄에 하나씩 입력 (예: 선불폰 / 심부름센터 / 흥신소)"
            className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <div className="flex flex-row gap-2 lg:w-44 lg:flex-col">
            <button
              onClick={() => runMut.mutate()}
              disabled={runMut.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300"
            >
              {runMut.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 분석 중…
                </>
              ) : (
                <>▶ 분석 시작</>
              )}
            </button>
            <button
              onClick={downloadXlsx}
              disabled={!results.length}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
            >
              <Download size={14} /> 엑셀
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
              onChange={(e) => setDisplay(parseInt(e.target.value) || 10)}
              className="w-16 rounded border border-line px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            호출 간격(ms)
            <input
              type="number"
              min={200}
              max={3000}
              step={100}
              value={paceMs}
              onChange={(e) => setPaceMs(parseInt(e.target.value) || 500)}
              className="w-20 rounded border border-line px-2 py-1"
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
          <span className="ml-auto text-ink-soft">
            최대 50개 키워드 · 일반적으로 키워드당 2~3초 소요
          </span>
        </div>

        {runMut.isError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {(runMut.error as Error)?.message || '분석 실패'}
          </div>
        )}
      </section>

      {/* KPI */}
      {results.length > 0 && (
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-7">
          <KpiCard label="분석 키워드" value={kpi.totalKw} />
          <KpiCard label="타지역 키워드" value={kpi.tpKw} accent="text-orange-600" />
          <KpiCard label="플레이스 없음" value={kpi.noPlace} accent="text-slate-500" />
          <KpiCard label="총 노출" value={kpi.total} />
          <KpiCard label="타지역 확정" value={kpi.tp} accent="text-orange-600" />
          <KpiCard label="타지역 의심" value={kpi.sus} accent="text-yellow-600" />
          <KpiCard label="메인" value={kpi.main} accent="text-emerald-600" />
        </section>
      )}

      {/* 필터 */}
      {results.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <Filter size={14} className="text-ink-muted" />
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            전체
          </FilterChip>
          <FilterChip
            active={filter === 'third_party'}
            onClick={() => setFilter('third_party')}
            color="orange"
          >
            타지역 확정 ({kpi.tp})
          </FilterChip>
          <FilterChip
            active={filter === 'third_party_suspect'}
            onClick={() => setFilter('third_party_suspect')}
            color="yellow"
          >
            타지역 의심 ({kpi.sus})
          </FilterChip>
          <FilterChip
            active={filter === 'main'}
            onClick={() => setFilter('main')}
            color="emerald"
          >
            메인 ({kpi.main})
          </FilterChip>
          {kpi.unk > 0 && (
            <FilterChip
              active={filter === 'unknown'}
              onClick={() => setFilter('unknown')}
            >
              미상 ({kpi.unk})
            </FilterChip>
          )}
        </div>
      )}

      {/* 결과 카드 */}
      <section className="space-y-5">
        {results.map((r) => {
          const sm = r.summary || ({} as any)
          const isTpKw = !!sm.is_third_party_keyword
          const visibleItems = filterItems(r.items || [])
          return (
            <div
              key={r.keyword}
              className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
            >
              {/* 카드 헤더 */}
              <div
                className={`flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 ${
                  isTpKw ? 'bg-orange-50' : 'bg-slate-50'
                }`}
              >
                <h3 className="text-base font-bold text-ink">{r.keyword}</h3>
                {isTpKw && (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">
                    타지역 키워드
                  </span>
                )}
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                  {r.source === 'html_apollo' ? 'apollo' : r.source}
                </span>
                {r.from_cache && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    cache
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-muted">
                  총 {sm.total ?? 0} · 타지역 {sm.third_party_count ?? 0} · 의심{' '}
                  {sm.third_party_suspect_count ?? 0} · 메인 {sm.main_count ?? 0} · 비율{' '}
                  {((sm.third_party_ratio ?? 0) * 100).toFixed(0)}%
                  {r.elapsed_ms ? ` · ${r.elapsed_ms}ms` : ''}
                </span>
              </div>

              {/* 에러 */}
              {r.error && (
                <div className="border-b border-line bg-rose-50 px-5 py-2 text-xs text-rose-700">
                  ⚠ {r.error}
                </div>
              )}

              {/* 결과 테이블 */}
              {visibleItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-xs text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">순위</th>
                        <th className="px-3 py-2 text-left">분류</th>
                        <th className="px-3 py-2 text-left">상호</th>
                        <th className="px-3 py-2 text-left">전화</th>
                        <th className="px-3 py-2 text-left">카테고리</th>
                        <th className="px-3 py-2 text-left">주소</th>
                        <th className="px-3 py-2 text-left">Place ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((it) => (
                        <tr
                          key={it.place_id}
                          className="border-t border-line hover:bg-slate-50"
                        >
                          <td className="px-3 py-2 tabular-nums text-ink-muted">
                            #{it.rank}
                          </td>
                          <td className="px-3 py-2">
                            <ClassificationPill c={it.classification} />
                          </td>
                          <td className="px-3 py-2 font-medium text-ink">
                            {it.name}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-muted">
                            {it.phone || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-muted">
                            {it.category || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-muted">
                            {it.road_address || it.address || '-'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            <a
                              href={`https://m.place.naver.com/place/${it.place_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-brand-600 hover:underline"
                            >
                              {it.place_id}
                              <ExternalLink size={11} />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !r.error && (
                  <div className="px-5 py-8 text-center text-sm text-ink-muted">
                    {filter === 'all'
                      ? '결과 없음'
                      : '선택된 분류에 해당하는 항목이 없습니다.'}
                  </div>
                )
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

// ── 작은 컴포넌트 ──────────────────────────────────────────
function KpiCard({
  label,
  value,
  accent = 'text-ink',
}: {
  label: string
  value: number
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
  color = 'slate',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: 'slate' | 'orange' | 'yellow' | 'emerald'
}) {
  const colorMap: Record<string, string> = {
    slate: active ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700',
    orange: active ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700',
    yellow: active ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-700',
    emerald: active
      ? 'bg-emerald-600 text-white'
      : 'bg-emerald-50 text-emerald-700',
  }
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${colorMap[color]}`}
    >
      {children}
    </button>
  )
}
