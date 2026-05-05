/**
 * 키워드 발굴 페이지 (솔루션 #1)
 *
 * 탭 3개:
 *   1) 키워드 분석 — 입력한 키워드(최대 30개) 1페이지 분류 (기존 기능)
 *   2) 지역 + 키워드 — 시도/시군구/동(리) 선택 후 검색
 *      · sigungu 모드: "{시군구} {키워드}" — 노출 결과 그대로
 *      · dong 모드   : "{동/리} {키워드}" — 0건이면 '타지역 노출 없음'
 *      · both 모드   : 두 결과 동시
 *   3) 지역 일괄 — 전국 229개 시군구 또는 시도 단위 일괄 (백그라운드 job)
 *
 * 분류 색상:
 *   · 메인           — emerald
 *   · 타지역(확정)    — orange  (070 / 흥신소)
 *   · 타지역(의심)    — yellow  (주소가 동/리까지만)
 *   · 미상           — slate
 */
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Search as SearchIcon,
  Download,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  MapPin,
  Globe,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import { keywordApi } from '@/api/keyword'
import type {
  KeywordDiscoverResult,
  KeywordPlaceItem,
  KeywordClassification,
  RegionsResponse,
  RegionMode,
  RegionDiscoverItem,
  DiscoverByRegionResponse,
  BulkJobStatus,
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
type TabKey = 'keyword' | 'region' | 'bulk'

export default function KeywordDiscover() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)
  const [tab, setTab] = useState<TabKey>('keyword')
  useBodyClass('solution-tool-page')

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-5" data-page="solution-tool">
      <PageSeo
        title="네이버 1페이지 키워드 발굴"
        description="네이버 1페이지 자동 분류로 청정 황금 키워드 발굴. 회선수 기반 수익 가능 키워드만 추천."
        path="/keyword"
        keywords={[
          '네이버 1페이지 키워드',
          '키워드 발굴',
          '청정 키워드',
          '플레이스 키워드',
          '네이버 검색 키워드',
          '타지역 키워드',
          '타지역닷컴',
        ]}
      />
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

      {/* 탭 — 박스 형태 + 활성 강조 */}
      <div className="flex flex-wrap items-center gap-2">
        <TabBtn active={tab === 'keyword'} onClick={() => setTab('keyword')} icon={<SearchIcon size={15} />}>
          키워드 분석
        </TabBtn>
        <TabBtn active={tab === 'region'} onClick={() => setTab('region')} icon={<MapPin size={15} />}>
          검색
        </TabBtn>
        <TabBtn active={tab === 'bulk'} onClick={() => setTab('bulk')} icon={<Globe size={15} />}>
          지역 일괄
        </TabBtn>
      </div>

      {tab === 'keyword' && (
        <KeywordTab isAuthenticated={isAuthenticated} openLoginModal={openLoginModal} />
      )}
      {tab === 'region' && (
        <RegionTab isAuthenticated={isAuthenticated} openLoginModal={openLoginModal} />
      )}
      {tab === 'bulk' && (
        <BulkRegionTab isAuthenticated={isAuthenticated} openLoginModal={openLoginModal} />
      )}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg border-2 transition-all shadow-sm',
        active
          ? 'border-brand-600 bg-brand-600 text-white shadow-md ring-2 ring-brand-200'
          : 'border-slate-300 bg-white text-ink-muted hover:border-brand-400 hover:text-brand-700 hover:bg-brand-50',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ══════════════════════════════════════════════════════
// Tab 1: 키워드 분석 (기존 기능)
// ══════════════════════════════════════════════════════
function KeywordTab({
  isAuthenticated,
  openLoginModal,
}: {
  isAuthenticated: boolean
  openLoginModal: (returnTo?: string) => void
}) {
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

  async function downloadXlsx() {
    if (!results.length) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()

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

  return (
    <div className="space-y-5">
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

// ══════════════════════════════════════════════════════
// Tab 2: 지역 + 키워드 (단건)
// ══════════════════════════════════════════════════════
interface RegionMatch {
  sido: string
  sigungu: string
  dong: string
  // matched on which level: 'sigungu' or 'dong'
  level: 'sigungu' | 'dong'
}

function RegionTab({
  isAuthenticated,
  openLoginModal,
}: {
  isAuthenticated: boolean
  openLoginModal: (returnTo?: string) => void
}) {
  const [regions, setRegions] = useState<RegionsResponse | null>(null)
  const [regionsErr, setRegionsErr] = useState<string>('')

  const [sido, setSido] = useState<string>('')
  const [sigungu, setSigungu] = useState<string>('')
  const [dong, setDong] = useState<string>('')
  const [mode, setMode] = useState<RegionMode>('sigungu')
  const [text, setText] = useState<string>('선불폰\n흥신소')
  const [display, setDisplay] = useState<number>(10)
  const [useCache, setUseCache] = useState<boolean>(true)

  // 자유 검색
  const [searchInput, setSearchInput] = useState<string>('')
  const [showSuggest, setShowSuggest] = useState<boolean>(false)

  const [loading, setLoading] = useState<boolean>(false)
  const [resp, setResp] = useState<DiscoverByRegionResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string>('')

  const keywords = useMemo(
    () =>
      text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [text],
  )

  // 지역 트리 로드 (인증 필요)
  useEffect(() => {
    if (!isAuthenticated) return
    let alive = true
    keywordApi
      .regions()
      .then((r) => {
        if (!alive) return
        setRegions(r)
        const sidos = Object.keys(r.tree)
        if (sidos.length && !sido) setSido(sidos[0])
      })
      .catch((e: unknown) => {
        if (!alive) return
        setRegionsErr(e instanceof ApiError ? e.message : (e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [isAuthenticated])  // eslint-disable-line react-hooks/exhaustive-deps

  const sidos = useMemo(() => (regions ? Object.keys(regions.tree) : []), [regions])
  const sigungus = useMemo(() => {
    if (!regions || !sido) return [] as string[]
    return Object.keys(regions.tree[sido] || {})
  }, [regions, sido])
  const dongs = useMemo(() => {
    if (!regions || !sido) return [] as string[]
    return regions.tree[sido]?.[sigungu] || []
  }, [regions, sido, sigungu])

  // 시도 변경 시 시군구 첫 항목으로
  useEffect(() => {
    if (!sigungus.length) {
      setSigungu('')
      return
    }
    if (!sigungus.includes(sigungu)) setSigungu(sigungus[0])
  }, [sigungus])  // eslint-disable-line react-hooks/exhaustive-deps

  // 시군구 변경 시 동 첫 항목으로
  useEffect(() => {
    if (!dongs.length) {
      setDong('')
      return
    }
    if (!dongs.includes(dong)) setDong(dongs[0])
  }, [dongs])  // eslint-disable-line react-hooks/exhaustive-deps

  // 자유 검색: "서초동" / "서초구" / "강릉시" 등 입력 시 매칭 후보 (최대 30개)
  const matches = useMemo<RegionMatch[]>(() => {
    if (!regions) return []
    const q = searchInput.trim()
    if (!q) return []
    const out: RegionMatch[] = []
    for (const sd of Object.keys(regions.tree)) {
      const sgMap = regions.tree[sd]
      for (const sg of Object.keys(sgMap)) {
        // 시군구 매칭
        if (sg && sg.includes(q)) {
          out.push({ sido: sd, sigungu: sg, dong: '', level: 'sigungu' })
          if (out.length >= 30) return out
        }
        // 동/리 매칭
        for (const d of sgMap[sg]) {
          if (d.includes(q)) {
            out.push({ sido: sd, sigungu: sg, dong: d, level: 'dong' })
            if (out.length >= 30) return out
          }
        }
      }
    }
    return out
  }, [regions, searchInput])

  function applyMatch(m: RegionMatch) {
    setSido(m.sido)
    setSigungu(m.sigungu)
    if (m.level === 'dong') {
      setDong(m.dong)
      setMode('both')
    } else {
      // 시군구 매칭이면 동은 첫 항목으로 (cascade가 자동 세팅)
      setMode('sigungu')
    }
    setSearchInput('')
    setShowSuggest(false)
  }

  async function runSearch() {
    setErrMsg('')
    if (!isAuthenticated) {
      openLoginModal('/keyword')
      return
    }
    if (!sido) {
      setErrMsg('시도를 선택해 주세요.')
      return
    }
    if ((mode === 'dong' || mode === 'both') && !dong) {
      setErrMsg('동/리를 선택해 주세요.')
      return
    }
    if (!keywords.length) {
      setErrMsg('키워드를 1개 이상 입력해 주세요.')
      return
    }
    if (keywords.length > 10) {
      setErrMsg('지역 검색은 한 번에 최대 10개 키워드까지 가능합니다.')
      return
    }
    setLoading(true)
    setResp(null)
    try {
      const r = await keywordApi.discoverByRegion({
        sido,
        sigungu,
        dong,
        mode,
        keywords,
        display,
        use_cache: useCache,
      })
      setResp(r)
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : (e as Error).message || '분석 실패'
      setErrMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        {/* 자유 검색 — "서초동" 입력 시 시·구·동 자동 매칭 */}
        <div className="mb-4 relative">
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold flex items-center gap-1.5">
              <SearchIcon size={14} className="text-brand-600" />
              지역 검색 <span className="text-ink-muted font-normal">(예: 서초동, 강남구, 강릉시 — 입력 즉시 매칭)</span>
            </div>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value)
                setShowSuggest(true)
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 200)}
              placeholder="시군구 또는 동/리명을 입력하세요"
              className="w-full border-2 border-slate-300 hover:border-brand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors"
              disabled={!regions}
            />
          </label>
          {showSuggest && matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-lg border-2 border-brand-200 bg-white shadow-lg">
              {matches.map((m, i) => (
                <button
                  key={`${m.sido}-${m.sigungu}-${m.dong}-${i}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyMatch(m)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-brand-50 flex items-center gap-2 border-b border-line last:border-0 text-sm"
                >
                  <span
                    className={clsx(
                      'px-1.5 py-0.5 rounded text-[10px] font-bold',
                      m.level === 'dong'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-100 text-blue-800',
                    )}
                  >
                    {m.level === 'dong' ? '동/리' : '시군구'}
                  </span>
                  <span className="text-ink-muted">{m.sido}</span>
                  <span className="font-semibold text-ink">
                    {m.sigungu || '(세종)'}
                  </span>
                  {m.dong && <span className="text-ink">{m.dong}</span>}
                </button>
              ))}
            </div>
          )}
          {showSuggest && searchInput && matches.length === 0 && regions && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border-2 border-line bg-white shadow-lg p-3 text-sm text-ink-muted">
              일치하는 지역이 없습니다.
            </div>
          )}
        </div>

        {/* 지역 선택 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">시도</div>
            <select
              value={sido}
              onChange={(e) => setSido(e.target.value)}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm"
              disabled={!regions}
            >
              {sidos.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">시군구</div>
            <select
              value={sigungu}
              onChange={(e) => setSigungu(e.target.value)}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm"
              disabled={!sigungus.length}
            >
              {sigungus.map((s) => (
                <option key={s || '__empty__'} value={s}>
                  {s || '(시군구 없음 — 세종)'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">동/리</div>
            <select
              value={dong}
              onChange={(e) => setDong(e.target.value)}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm"
              disabled={!dongs.length}
            >
              {dongs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 현재 선택된 지역 — 시·군·구·동 출력 */}
        {sido && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted text-xs">선택된 지역:</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold text-xs">
              {sido}
            </span>
            {sigungu && (
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold text-xs">
                {sigungu}
              </span>
            )}
            {dong && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-xs">
                {dong}
              </span>
            )}
          </div>
        )}

        {/* 검색 모드 */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="font-semibold text-ink">검색 모드</span>
          <ModeRadio mode={mode} setMode={setMode} value="sigungu" label="시군구" hint="“시군구 + 키워드”" />
          <ModeRadio mode={mode} setMode={setMode} value="dong" label="동/리" hint="“동·리 + 키워드”" />
          <ModeRadio mode={mode} setMode={setMode} value="both" label="둘 다" hint="시군구·동 동시" />
        </div>

        {/* 키워드 입력 */}
        <div className="mt-4 flex flex-col lg:flex-row gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="키워드를 한 줄에 하나씩 입력 (최대 10개)"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:border-brand-400 focus:outline-none"
          />
          <div className="flex flex-row lg:flex-col gap-2 lg:w-44">
            <button
              onClick={runSearch}
              disabled={loading || !keywords.length || !sido}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  검색 중...
                </>
              ) : (
                <>
                  <SearchIcon size={16} />
                  지역 검색
                </>
              )}
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
            <input
              type="checkbox"
              checked={useCache}
              onChange={(e) => setUseCache(e.target.checked)}
            />
            6시간 캐시
          </label>
          <span className="ml-auto">
            {regions
              ? `전국 ${regions.summary.sigungu_count.toLocaleString()}개 시군구 / ${regions.summary.dong_count.toLocaleString()}개 동·리`
              : regionsErr || '지역 데이터 로딩 중...'}
          </span>
        </div>

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>{errMsg}</div>
          </div>
        )}
      </Card>

      {/* 결과 */}
      {resp?.results.map((row) => (
        <div key={row.keyword} className="space-y-3">
          <h3 className="font-bold text-ink text-base flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            {row.keyword}
            <span className="text-xs text-ink-muted ml-2">
              {resp.sido} {resp.sigungu} {resp.dong}
            </span>
          </h3>
          {row.error && (
            <div className="px-4 py-2.5 text-sm rounded-lg border border-rose-200 bg-rose-50 text-rose-700">
              {row.error}
            </div>
          )}
          {row.result && <RegionResultCard r={row.result} />}
          {row.sigungu_result && <RegionResultCard r={row.sigungu_result} />}
          {row.dong_result && <RegionResultCard r={row.dong_result} />}
        </div>
      ))}

      {!resp && !loading && (
        <Card className="p-8 text-center text-sm text-ink-muted">
          시도/시군구/동(리)을 선택하고 키워드를 입력한 뒤 <strong>지역 검색</strong>을 눌러주세요.
          <br />
          시군구 모드는 노출 결과 그대로, 동/리 모드는 0건이면 “타지역 노출 없음”으로 표시됩니다.
        </Card>
      )}
    </div>
  )
}

function ModeRadio({
  mode,
  setMode,
  value,
  label,
  hint,
}: {
  mode: RegionMode
  setMode: (m: RegionMode) => void
  value: RegionMode
  label: string
  hint: string
}) {
  const active = mode === value
  return (
    <label
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors',
        active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-line text-ink-muted hover:bg-bg-subtle',
      )}
    >
      <input
        type="radio"
        className="hidden"
        checked={active}
        onChange={() => setMode(value)}
      />
      <span className="font-semibold">{label}</span>
      <span className="text-[11px] text-ink-muted">{hint}</span>
    </label>
  )
}

function RegionResultCard({ r }: { r: RegionDiscoverItem }) {
  const sm = r.summary
  const isTpKw = sm?.is_third_party_keyword
  const ratio = ((sm?.third_party_ratio ?? 0) * 100).toFixed(0)

  const modeLabel = r.mode === 'sigungu' ? '시군구' : r.mode === 'dong' ? '동/리' : '둘 다'

  return (
    <Card className="overflow-hidden p-0">
      <div
        className={clsx(
          'px-5 py-3 border-b border-line flex flex-wrap items-center gap-2',
          isTpKw ? 'bg-amber-50' : 'bg-bg-subtle',
        )}
      >
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
          {modeLabel}
        </span>
        <span className="font-mono text-xs text-ink">{r.query}</span>
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

      {r.message && (
        <div className="px-5 py-3 text-sm text-amber-800 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
          <AlertTriangle size={14} /> {r.message}
        </div>
      )}
      {r.error && (
        <div className="px-5 py-2.5 text-sm text-rose-700 bg-rose-50 border-b border-rose-100 flex items-center gap-1.5">
          <AlertTriangle size={14} /> {r.error}
        </div>
      )}

      {r.items?.length ? <PlacesTable rows={r.items} keyHint={r.query} /> : null}
    </Card>
  )
}

// ══════════════════════════════════════════════════════
// Tab 3: 지역 일괄 (시도 / 전국)
// ══════════════════════════════════════════════════════
function BulkRegionTab({
  isAuthenticated,
  openLoginModal,
}: {
  isAuthenticated: boolean
  openLoginModal: (returnTo?: string) => void
}) {
  const [regions, setRegions] = useState<RegionsResponse | null>(null)
  const [scope, setScope] = useState<'sido' | 'nationwide' | 'sigungu'>('sido')
  const [sido, setSido] = useState<string>('')
  const [sigungu, setSigungu] = useState<string>('')
  const [text, setText] = useState<string>('선불폰')
  const [display, setDisplay] = useState<number>(10)
  const [paceMs, setPaceMs] = useState<number>(500)
  const [concurrency, setConcurrency] = useState<number>(5)
  const [useCache, setUseCache] = useState<boolean>(true)

  const [job, setJob] = useState<BulkJobStatus | null>(null)
  const [jobId, setJobId] = useState<string>('')
  const [estSec, setEstSec] = useState<number>(0)
  const [errMsg, setErrMsg] = useState<string>('')
  const [starting, setStarting] = useState<boolean>(false)
  const [detailRow, setDetailRow] = useState<any | null>(null)
  const [minRatio, setMinRatio] = useState<number>(0)        // 타지역비율 N% 이상만 표시
  const [hideZero, setHideZero] = useState<boolean>(false)   // 노출 0건 행 숨김

  const keywords = useMemo(
    () =>
      text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [text],
  )

  useEffect(() => {
    if (!isAuthenticated) return
    let alive = true
    keywordApi.regions().then((r) => {
      if (!alive) return
      setRegions(r)
      const sidos = Object.keys(r.tree)
      if (sidos.length && !sido) setSido(sidos[0])
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [isAuthenticated])  // eslint-disable-line react-hooks/exhaustive-deps

  const sidos = useMemo(() => (regions ? Object.keys(regions.tree) : []), [regions])
  const bulkSigungus = useMemo(() => {
    if (!regions || !sido) return [] as string[]
    return Object.keys(regions.tree[sido] || {})
  }, [regions, sido])

  // scope=sigungu 전환 시 시도/시군구 자동 채움
  useEffect(() => {
    if (scope !== 'sigungu') return
    if (!regions) return
    if (!sido && sidos.length) setSido(sidos[0])
  }, [scope, regions, sidos]) // eslint-disable-line react-hooks/exhaustive-deps

  // 시도 변경 시 시군구 첫 항목으로
  useEffect(() => {
    if (!bulkSigungus.length) {
      setSigungu('')
      return
    }
    if (!bulkSigungus.includes(sigungu)) setSigungu(bulkSigungus[0])
  }, [bulkSigungus]) // eslint-disable-line react-hooks/exhaustive-deps

  // 폴링
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const s = await keywordApi.jobStatus(jobId, true)
        if (cancelled) return
        setJob(s)
        if (s.status === 'running') {
          timer = setTimeout(tick, 1500)
        }
      } catch (e) {
        if (cancelled) return
        setErrMsg(e instanceof ApiError ? e.message : (e as Error).message)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId])

  const totalPairs = useMemo(() => {
    if (!regions || !keywords.length) return 0
    if (scope === 'nationwide') {
      return regions.summary.sigungu_count * keywords.length
    }
    if (scope === 'sido') {
      if (!sido) return 0
      return Object.keys(regions.tree[sido] || {}).length * keywords.length
    }
    // scope === 'sigungu' — 해당 시군구의 동/리 수 × 키워드
    if (!sido || !(sigungu in (regions.tree[sido] || {}))) return 0
    return (regions.tree[sido][sigungu]?.length || 0) * keywords.length
  }, [regions, scope, sido, sigungu, keywords])

  async function startJob() {
    setErrMsg('')
    if (!isAuthenticated) {
      openLoginModal('/keyword')
      return
    }
    if (!keywords.length) {
      setErrMsg('키워드를 1개 이상 입력해 주세요.')
      return
    }
    if (keywords.length > 5) {
      setErrMsg('지역 일괄은 한 번에 최대 5개 키워드까지 가능합니다.')
      return
    }
    if ((scope === 'sido' || scope === 'sigungu') && !sido) {
      setErrMsg('시도를 선택해 주세요.')
      return
    }
    if (scope === 'sigungu' && !(sigungu in (regions?.tree[sido] || {}))) {
      setErrMsg('시군구를 선택해 주세요.')
      return
    }
    setStarting(true)
    setJob(null)
    setJobId('')
    try {
      const r = await keywordApi.discoverBulkRegion({
        scope,
        sido: scope === 'nationwide' ? '' : sido,
        sigungu: scope === 'sigungu' ? sigungu : '',
        keywords,
        display,
        pace_ms: paceMs,
        concurrency,
        use_cache: useCache,
      })
      setJobId(r.job_id)
      setEstSec(r.estimated_seconds)
    } catch (e) {
      setErrMsg(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  // exposed memo (전체 노출된 조합 — KPI 표시용 보조)
  void useMemo(() => {
    if (!job?.results) return []
    return job.results.filter((r) => r.exposed)
  }, [job])

  // 결과 필터 (타지역비율 ≥ minRatio, 노출 0건 숨김 옵션) + 정렬
  const filteredResults = useMemo(() => {
    if (!job?.results) return [] as any[]
    const minRatioFrac = minRatio / 100
    const arr = job.results.filter((r: any) => {
      const sm = r.summary || {}
      const ratio = sm.third_party_ratio ?? 0
      const total = sm.total ?? 0
      if (hideZero && total === 0) return false
      if (ratio < minRatioFrac) return false
      return true
    })
    return arr.sort(
      (a: any, b: any) =>
        (b.summary?.third_party_ratio ?? 0) - (a.summary?.third_party_ratio ?? 0),
    )
  }, [job, minRatio, hideZero])

  // (a) 일괄 결과 요약 Excel 다운로드
  async function downloadSummaryXlsx() {
    if (!filteredResults.length) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()
    const rows = filteredResults.map((r: any) => {
      const sm = r.summary || {}
      return {
        시도: r.sido || '',
        시군구: r.sigungu || '',
        '동/리': r.dong || '',
        키워드: r.keyword || '',
        검색쿼리: r.query || '',
        총: sm.total ?? 0,
        메인: sm.main_count ?? 0,
        타지역: sm.third_party_count ?? 0,
        의심: sm.third_party_suspect_count ?? 0,
        '타지역비율(%)': Math.round((sm.third_party_ratio ?? 0) * 100),
        타지역키워드: sm.is_third_party_keyword ? 'YES' : '',
        소요ms: r.elapsed_ms ?? '',
        오류: r.error || '',
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
      { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 6 }, { wch: 12 },
      { wch: 12 }, { wch: 8 }, { wch: 20 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '일괄검색_요약')
    XLSX.writeFile(wb, `네이버_지역일괄_요약_${todayKstDate()}.xlsx`)
  }

  // (b) 일괄 결과 + 업체 상세 Excel 다운로드 (모달과 동일한 정보)
  async function downloadDetailXlsx() {
    if (!filteredResults.length) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()
    const summaryRows = filteredResults.map((r: any) => {
      const sm = r.summary || {}
      return {
        시도: r.sido || '',
        시군구: r.sigungu || '',
        '동/리': r.dong || '',
        키워드: r.keyword || '',
        검색쿼리: r.query || '',
        총: sm.total ?? 0,
        메인: sm.main_count ?? 0,
        타지역: sm.third_party_count ?? 0,
        의심: sm.third_party_suspect_count ?? 0,
        '타지역비율(%)': Math.round((sm.third_party_ratio ?? 0) * 100),
        타지역키워드: sm.is_third_party_keyword ? 'YES' : '',
      }
    })
    const detailRows: Record<string, any>[] = []
    for (const r of filteredResults) {
      const items: any[] = (r as any).items || []
      for (const it of items) {
        detailRows.push({
          시도: r.sido || '',
          시군구: r.sigungu || '',
          '동/리': r.dong || '',
          키워드: r.keyword || '',
          검색쿼리: r.query || '',
          순위: it.rank,
          분류: (CLS_LABEL as Record<string, string>)[it.classification] || it.classification,
          카테고리: it.category || '',
          전번: it.phone || '',
          상호: it.name || '',
          주소: it.road_address || it.address || '',
          영업상태: it.business_status || '',
          예약: it.naver_booking ? 'YES' : '',
          방문리뷰: it.visitor_review_count ?? 0,
          블로그리뷰: it.blog_review_count ?? 0,
          PlaceID: it.place_id || '',
          URL: it.place_id
            ? `https://m.place.naver.com/place/${it.place_id}`
            : '',
        })
      }
    }
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(summaryRows)
    ws1['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
      { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 12 },
    ]
    XLSX.utils.book_append_sheet(wb, ws1, '일괄검색_요약')

    const ws2 = XLSX.utils.json_to_sheet(detailRows)
    ws2['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
      { wch: 5 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 24 },
      { wch: 36 }, { wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 8 },
      { wch: 14 }, { wch: 40 },
    ]
    XLSX.utils.book_append_sheet(wb, ws2, '업체_상세')

    XLSX.writeFile(wb, `네이버_지역일괄_상세_${todayKstDate()}.xlsx`)
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">범위</div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'sido' | 'nationwide' | 'sigungu')}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm"
            >
              <option value="sido">시도 단위 (시도 안의 시군구 일괄)</option>
              <option value="sigungu">시군구 단위 (시군구 안의 동/리 일괄)</option>
              <option value="nationwide">전국 (229개 시군구)</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">
              시도 선택 {scope === 'nationwide' && '(전국에서는 사용 안 함)'}
            </div>
            <select
              value={sido}
              onChange={(e) => setSido(e.target.value)}
              disabled={scope === 'nationwide'}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm disabled:bg-slate-50"
            >
              {sidos.map((s) => (
                <option key={s} value={s}>
                  {s} ({Object.keys(regions?.tree[s] || {}).length}개 시군구)
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            <div className="mb-1 font-semibold">
              시군구 선택 {scope !== 'sigungu' && '(시군구 단위에만 사용)'}
            </div>
            <select
              value={sigungu}
              onChange={(e) => setSigungu(e.target.value)}
              disabled={scope !== 'sigungu' || !bulkSigungus.length}
              className="w-full border border-line rounded-lg px-2 py-2 text-sm disabled:bg-slate-50"
            >
              {bulkSigungus.map((s) => (
                <option key={s || '__empty__'} value={s}>
                  {s || '(세종 — 시군구 없음)'} ({(regions?.tree[sido]?.[s] || []).length}개 동/리)
                </option>
              ))}
            </select>
          </label>
        </div>

        {scope === 'sigungu' && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            <strong>시군구 단위:</strong> 선택한 <strong>{sido} {sigungu || '(세종)'}</strong> 안의 모든 동/리에 대해
            “<span className="font-mono">동·리 + 키워드</span>”로 검색합니다 (동/리 모드).
            결과 0건은 “타지역 노출 없음”으로 표시됩니다.
          </div>
        )}

        <div className="mt-4 flex flex-col lg:flex-row gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="키워드를 한 줄에 하나씩 입력 (최대 5개)"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:border-brand-400 focus:outline-none"
          />
          <div className="flex flex-row lg:flex-col gap-2 lg:w-44">
            <button
              onClick={startJob}
              disabled={
                starting ||
                !keywords.length ||
                ((scope === 'sido' || scope === 'sigungu') && !sido) ||
                (scope === 'sigungu' && !(sigungu in (regions?.tree[sido] || {})))
              }
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              {starting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  시작 중...
                </>
              ) : (
                <>
                  <Globe size={16} />
                  일괄 시작
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            가져올 개수
            <input
              type="number" min={1} max={20} value={display}
              onChange={(e) => setDisplay(parseInt(e.target.value || '10', 10))}
              className="w-16 border border-line rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            동시 호출
            <input
              type="number" min={1} max={8} value={concurrency}
              onChange={(e) => setConcurrency(parseInt(e.target.value || '5', 10))}
              className="w-14 border border-line rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            호출 간격(ms)
            <input
              type="number" min={200} max={3000} step={100} value={paceMs}
              onChange={(e) => setPaceMs(parseInt(e.target.value || '500', 10))}
              className="w-20 border border-line rounded px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useCache} onChange={(e) => setUseCache(e.target.checked)} />
            6시간 캐시
          </label>
          <span className="ml-auto">
            예상 조합: <strong>{totalPairs.toLocaleString()}</strong>개
            {estSec ? ` · 예상 시간 ~${Math.max(1, Math.round(estSec / 60))}분` : ''}
          </span>
        </div>

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>{errMsg}</div>
          </div>
        )}
      </Card>

      {/* 진행률 / 결과 */}
      {job && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={clsx(
                'px-2 py-0.5 rounded-full text-[11px] font-bold',
                job.status === 'done'
                  ? 'bg-emerald-100 text-emerald-800'
                  : job.status === 'failed'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-amber-100 text-amber-800',
              )}
            >
              {job.status === 'running' ? '진행 중' : job.status === 'done' ? '완료' : job.status === 'failed' ? '실패' : job.status}
            </span>
            <span className="text-sm font-mono">
              {job.done.toLocaleString()} / {job.total.toLocaleString()}
            </span>
            <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden min-w-32">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            <span className="text-xs text-ink-muted">{Math.round(job.progress * 100)}%</span>
          </div>

          <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="조합 수" value={job.summary.pair_count} tone="default" />
            <Kpi label="노출된 조합" value={job.summary.exposed_pair_count} tone="default" />
            <Kpi label="타지역 확정" value={job.summary.third_party_count} tone="orange" />
            <Kpi label="타지역 의심" value={job.summary.third_party_suspect_count} tone="yellow" />
            <Kpi label="메인" value={job.summary.main_count} tone="emerald" />
          </div>
        </Card>
      )}

      {job && job.results && job.results.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-bg-subtle flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">
              결과 ({filteredResults.length} / {job.results.length})
            </span>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              타지역비율 ≥
              <input
                type="number"
                min={0}
                max={100}
                step={10}
                value={minRatio}
                onChange={(e) => setMinRatio(Math.min(100, Math.max(0, parseInt(e.target.value || '0', 10))))}
                className="w-16 border border-line rounded px-2 py-1"
              />
              <span>%</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              노출 0건 숨김
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={downloadSummaryXlsx}
                disabled={!filteredResults.length}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-3 py-1.5 text-xs transition-colors"
              >
                <Download size={13} />
                요약 Excel
              </button>
              <button
                type="button"
                onClick={downloadDetailXlsx}
                disabled={!filteredResults.length}
                className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-3 py-1.5 text-xs transition-colors"
              >
                <Download size={13} />
                상세 Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-ink-muted text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">시도</th>
                  <th className="px-3 py-2 text-left">시군구</th>
                  <th className="px-3 py-2 text-left">동/리</th>
                  <th className="px-3 py-2 text-left">키워드</th>
                  <th className="px-3 py-2 text-left">쿼리</th>
                  <th className="px-3 py-2 text-right">총</th>
                  <th className="px-3 py-2 text-right">메인</th>
                  <th className="px-3 py-2 text-right">타지역</th>
                  <th className="px-3 py-2 text-right">의심</th>
                  <th className="px-3 py-2 text-right">비율</th>
                  <th className="px-3 py-2 text-left">타지역키워드</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r, i) => {
                  const sm = r.summary
                  const ratio = (sm?.third_party_ratio ?? 0) * 100
                  const hasItems = (r.items?.length ?? 0) > 0
                  return (
                    <tr
                      key={`${r.sido}-${r.sigungu}-${r.dong}-${r.keyword}-${i}`}
                      className={clsx(
                        'border-t border-line',
                        hasItems
                          ? 'hover:bg-brand-50 cursor-pointer'
                          : 'hover:bg-bg-subtle/50',
                      )}
                      onClick={() => hasItems && setDetailRow(r)}
                      title={hasItems ? '클릭하면 순위별 업체 목록' : ''}
                    >
                      <td className="px-3 py-2">{r.sido || '-'}</td>
                      <td className="px-3 py-2 font-medium text-ink">{r.sigungu || '(없음)'}</td>
                      <td className="px-3 py-2 text-ink">
                        {hasItems ? (
                          <button
                            type="button"
                            className="text-brand-700 hover:underline font-medium"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDetailRow(r)
                            }}
                          >
                            {r.dong || '-'}
                          </button>
                        ) : (
                          <span>{r.dong || '-'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.keyword}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-muted">{r.query}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{sm?.total ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{sm?.main_count ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-700">{sm?.third_party_count ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-yellow-700">{sm?.third_party_suspect_count ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{ratio.toFixed(0)}%</td>
                      <td className="px-3 py-2">
                        {sm?.is_third_party_keyword ? (
                          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 ring-1 ring-orange-200 text-[11px] font-bold">
                            YES
                          </span>
                        ) : (
                          <span className="text-ink-muted text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filteredResults.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-ink-muted text-sm">
                      필터 조건에 맞는 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!job && !starting && (
        <Card className="p-8 text-center text-sm text-ink-muted">
          범위(시도/시군구/전국)를 선택하고 키워드를 입력한 뒤 <strong>일괄 시작</strong>을 눌러주세요.
          <br />
          시도/전국은 시군구 검색, 시군구 단위는 해당 시군구의 모든 동/리를 검색합니다.
        </Card>
      )}

      {detailRow && (
        <RegionDetailModal row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════
// 동/리 클릭 시 순위별 업체 모달
// ══════════════════════════════════════════════════════
function RegionDetailModal({
  row,
  onClose,
}: {
  row: any
  onClose: () => void
}) {
  const sm = row.summary || {}
  const items: KeywordPlaceItem[] = row.items || []
  const ratio = ((sm.third_party_ratio ?? 0) * 100).toFixed(0)

  async function downloadModalXlsx() {
    if (!items.length) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()
    const rows = items.map((it: any) => ({
      시도: row.sido || '',
      시군구: row.sigungu || '',
      '동/리': row.dong || '',
      키워드: row.keyword || '',
      검색쿼리: row.query || '',
      순위: it.rank,
      분류: (CLS_LABEL as Record<string, string>)[it.classification] || it.classification,
      카테고리: it.category || '',
      전번: it.phone || '',
      상호: it.name || '',
      주소: it.road_address || it.address || '',
      영업상태: it.business_status || '',
      예약: it.naver_booking ? 'YES' : '',
      방문리뷰: it.visitor_review_count ?? 0,
      블로그리뷰: it.blog_review_count ?? 0,
      PlaceID: it.place_id || '',
      URL: it.place_id ? `https://m.place.naver.com/place/${it.place_id}` : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
      { wch: 5 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 24 },
      { wch: 36 }, { wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 8 },
      { wch: 14 }, { wch: 40 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '업체_상세')
    const safeRegion = `${row.sido || ''}_${row.sigungu || ''}_${row.dong || ''}`.replace(/\s+/g, '')
    XLSX.writeFile(wb, `네이버_${safeRegion}_${row.keyword}_${todayKstDate()}.xlsx`)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-line bg-bg-subtle flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-ink text-base">
            {row.sido} {row.sigungu || '(없음)'} {row.dong || ''}
          </h2>
          <span className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 text-[11px] font-semibold">
            {row.keyword}
          </span>
          <span className="font-mono text-xs text-ink-muted">{row.query}</span>
          <span className="text-xs text-ink-muted ml-auto">
            총 {sm.total ?? 0} · 메인 {sm.main_count ?? 0} · 타지역 {sm.third_party_count ?? 0} · 의심 {sm.third_party_suspect_count ?? 0} · 비율 {ratio}%
          </span>
          <button
            type="button"
            onClick={downloadModalXlsx}
            disabled={!items.length}
            className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg px-2.5 py-1 text-xs transition-colors"
            title="이 동/리 결과 Excel 다운로드"
          >
            <Download size={12} />
            Excel
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 p-1 rounded hover:bg-slate-200 text-ink-muted"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 - 순위별 업체 목록 */}
        <div className="flex-1 overflow-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-ink-muted">
              결과 없음 (타지역 노출 없음)
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-ink-muted text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">순위</th>
                  <th className="px-3 py-2 text-left">분류</th>
                  <th className="px-3 py-2 text-left">카테고리</th>
                  <th className="px-3 py-2 text-left">전번</th>
                  <th className="px-3 py-2 text-left">상호</th>
                  <th className="px-3 py-2 text-left">주소</th>
                  <th className="px-3 py-2 text-left">Place</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: KeywordPlaceItem) => (
                  <tr
                    key={`${row.query}-${it.place_id}-${it.rank}`}
                    className="border-t border-line hover:bg-bg-subtle/50"
                  >
                    <td className="px-3 py-2 tabular-nums font-bold">{it.rank}</td>
                    <td className="px-3 py-2">
                      <ClassificationPill c={it.classification} />
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{it.category || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.phone || '-'}</td>
                    <td className="px-3 py-2 font-medium text-ink">{it.name}</td>
                    <td className="px-3 py-2 text-ink-muted text-xs">
                      {it.road_address || it.address || '-'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <a
                        href={`https://m.place.naver.com/place/${encodeURIComponent(it.place_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {it.place_id} <ExternalLink size={11} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-2.5 border-t border-line bg-bg-subtle text-xs text-ink-muted flex items-center justify-between">
          <span>※ 네이버 모바일 검색 1페이지 플레이스 기준</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 text-ink font-semibold"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════
// 공통 표 / 카드
// ══════════════════════════════════════════════════════
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

function PlacesTable({ rows, keyHint }: { rows: KeywordPlaceItem[]; keyHint: string }) {
  return (
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
          {rows.map((it: KeywordPlaceItem) => (
            <tr key={`${keyHint}-${it.place_id}`} className="border-t border-line hover:bg-bg-subtle/50">
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
                  rel="noopener noreferrer"
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

      {r.items?.length ? <PlacesTable rows={r.items} keyHint={r.keyword} /> : null}
    </Card>
  )
}
