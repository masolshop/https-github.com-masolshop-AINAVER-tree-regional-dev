/**
 * Tab 1: DNA 분석 (단일 키워드)
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Search as SearchIcon,
  Download,
  Sparkles,
  Loader2,
  AlertTriangle,
  Dna,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import {
  KeywordDnaApi,
  type DnaResult,
  type RecommendedItem,
} from '@/api/keywordDna'
import { demoApi } from '@/api/demo'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import {
  CATEGORIES,
  CAT_LABEL,
  CAT_DESC,
  CAT_PILL,
  CAT_BAR,
  CAT_ICON,
  SAMPLE_KEYWORDS,
  todayKstDate,
  safeFilename,
  fmtNum,
  pctOf,
} from './shared'

export default function DnaTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isDemo = useAuthStore((s) => s.isDemo)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [keyword, setKeyword] = useState('흥신소')
  const [topPerCat, setTopPerCat] = useState(15)
  const [minDf, setMinDf] = useState(2)
  const [result, setResult] = useState<DnaResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [recommended, setRecommended] = useState<RecommendedItem[]>([])
  const [detailExample, setDetailExample] = useState<{
    name: string
    weight: number
    tokens: string[]
  } | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    KeywordDnaApi.recommended(40)
      .then((rec) => setRecommended(rec.items || []))
      .catch(() => setRecommended([]))
  }, [isAuthenticated])

  // 데모: 마운트 시 캡처된 흥신소 DNA 자동 로드
  useEffect(() => {
    if (!isAuthenticated || !isDemo) return
    if (result) return
    setLoading(true)
    setErrMsg(null)
    demoApi
      .keywordDna()
      .then((r) => {
        setKeyword(r.keyword || '흥신소')
        setResult(r.analyze)
      })
      .catch((e: any) =>
        setErrMsg(e instanceof ApiError ? e.message : (e?.message || '데모 데이터 로드 실패')),
      )
      .finally(() => setLoading(false))
  }, [isAuthenticated, isDemo, result])

  const submit = async (kw?: string) => {
    if (!isAuthenticated) {
      openLoginModal()
      return
    }
    if (isDemo) {
      // 데모는 입력 무시하고 캡처 데이터 재로드
      setLoading(true)
      setErrMsg(null)
      try {
        const r = await demoApi.keywordDna()
        setKeyword(r.keyword || '흥신소')
        setResult(r.analyze)
      } catch (e: any) {
        setErrMsg(e instanceof ApiError ? e.message : (e?.message || '데모 데이터 로드 실패'))
      } finally {
        setLoading(false)
      }
      return
    }
    const target = (kw ?? keyword).trim()
    if (!target) {
      setErrMsg('키워드를 입력하세요.')
      return
    }
    setKeyword(target)
    setLoading(true)
    setErrMsg(null)
    try {
      const r = await KeywordDnaApi.analyze(target, {
        top_per_category: topPerCat,
        min_df: minDf,
        examples: 30,
      })
      setResult(r)
      if (r.stats.matched === 0) {
        setErrMsg(`'${target}'을(를) 포함하는 등록 상호가 없습니다.`)
      }
    } catch (e: any) {
      setErrMsg(e instanceof ApiError ? e.message : (e?.message || '분석 실패'))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const downloadExcel = async () => {
    if (!result) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()
    const wb = XLSX.utils.book_new()
    const summaryRows: any[] = []
    for (const cat of CATEGORIES) {
      for (const t of result.dna[cat] || []) {
        summaryRows.push({
          카테고리: CAT_LABEL[cat],
          토큰: t.token,
          출현_상호수: t.df,
          가중치: Math.round(t.weight),
          비중_퍼센트: (t.share * 100).toFixed(1),
        })
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'DNA_요약')
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.golden.map((g, i) => ({
          순위: i + 1,
          조합: g.combo,
          메인: g.main,
          수식어: g.modifier,
          카테고리: CAT_LABEL[g.modifier_category],
          가중치: Math.round(g.weight),
        })),
      ),
      '골든_조합',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.examples.map((e, i) => ({
          순위: i + 1,
          상호: e.name,
          회선수: Math.round(e.weight),
          파싱토큰: e.tokens.join(' / '),
        })),
      ),
      '매칭_상호',
    )
    XLSX.writeFile(
      wb,
      `타지역_키워드DNA_${safeFilename(result.normalized)}_${todayKstDate()}.xlsx`,
    )
  }

  return (
    <div className="space-y-5">
      {/* 검색 패널 */}
      <Card variant="white" className="p-5">
        <div className="flex items-start gap-2 mb-3">
          <Dna className="text-blue-600 mt-0.5" size={20} />
          <div>
            <div className="text-base font-bold text-slate-800">키워드 DNA 분석</div>
            <div className="text-xs text-slate-500">
              타지역 봇은 상호에서 키워드 형태소만 매칭합니다. 입력 키워드가 어떤 행동·재료·장소와 함께 등록돼 있는지 분석합니다.
            </div>
          </div>
        </div>

        {isDemo && (
          <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
            🎬 외부 공개 데모 — 키워드 <b>"흥신소"</b>의 실제 캡처 결과를 보여드립니다.
            실시간 분석은 회원가입 후 이용 가능합니다.
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-stretch">
          <div className="relative flex-1 min-w-[260px]">
            <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder="예: 흥신소, 하수구, 누수, 보일러"
              className={clsx(
                'w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                isDemo && 'bg-slate-100 cursor-not-allowed',
              )}
              maxLength={30}
              readOnly={isDemo}
              title={isDemo ? '데모 키워드는 변경할 수 없습니다' : undefined}
            />
          </div>
          <button
            onClick={() => submit()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 rounded-lg shadow-sm transition"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" />분석 중...</> : <><Sparkles size={16} />DNA 분석</>}
          </button>
          <select
            value={topPerCat}
            onChange={(e) => setTopPerCat(Number(e.target.value))}
            disabled={isDemo}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
          >
            <option value={8}>카테고리당 8개</option>
            <option value={15}>카테고리당 15개</option>
            <option value={25}>카테고리당 25개</option>
          </select>
          <select
            value={minDf}
            onChange={(e) => setMinDf(Number(e.target.value))}
            disabled={isDemo}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
          >
            <option value={1}>1회 이상</option>
            <option value={2}>2회 이상</option>
            <option value={3}>3회 이상</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-500 self-center mr-1">빠른 시작:</span>
          {SAMPLE_KEYWORDS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className={clsx(
                'px-2.5 py-1 text-xs rounded-full transition',
                keyword === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-slate-700 hover:bg-blue-50 hover:text-blue-700 ring-1 ring-slate-200',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {recommended.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-[11px] text-slate-500 self-center mr-1">회선수 상위:</span>
            {recommended.slice(0, 12).map((r) => (
              <button
                key={r.token}
                onClick={() => submit(r.token)}
                className="px-2 py-0.5 text-[11px] rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200"
                title={`회선수 가중치 ${fmtNum(r.weight)}, 등록 ${r.df}건`}
              >
                {r.token}
              </button>
            ))}
          </div>
        )}

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800">{errMsg}</div>
          </div>
        )}
      </Card>

      {result && result.stats.matched > 0 && (
        <>
          <Card variant="white" className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4">
                <div>
                  <div className="text-[11px] text-slate-500">분석 키워드</div>
                  <div className="text-lg font-bold text-blue-700">{result.normalized}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">매칭 상호</div>
                  <div className="text-lg font-bold text-slate-800">
                    {fmtNum(result.stats.matched)}
                    <span className="text-xs text-slate-500 ml-1">/ {fmtNum(result.stats.total)}건</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">매칭 회선수</div>
                  <div className="text-lg font-bold text-emerald-700">{fmtNum(result.stats.weight_matched)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">시장 점유</div>
                  <div className="text-lg font-bold text-slate-800">
                    {pctOf(result.stats.weight_matched, result.stats.total_weight)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">분석 시간</div>
                  <div className="text-lg font-bold text-slate-800">
                    {result.stats.elapsed_ms}<span className="text-xs text-slate-500 ml-0.5">ms</span>
                  </div>
                </div>
              </div>
              <button
                onClick={downloadExcel}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg border-2 border-blue-700 shadow-sm transition"
              >
                <Download size={16} />Excel 다운로드
              </button>
            </div>
          </Card>

          {result.golden.length > 0 && (
            <Card variant="white" className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="text-amber-500" size={18} />
                <div>
                  <div className="text-base font-bold text-slate-800">🌟 황금 키워드 조합 (Golden Combos)</div>
                  <div className="text-xs text-slate-500">
                    "{result.normalized}" + 동반 행동·재료·장소 — 회선수 가중치 순
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {result.golden.map((g, idx) => {
                  const maxW = result.golden[0]?.weight || 1
                  const pct = pctOf(g.weight, maxW)
                  return (
                    <div
                      key={`${g.combo}-${idx}`}
                      className="relative bg-gradient-to-br from-blue-50 to-amber-50 rounded-lg px-3 py-2.5 border border-amber-200 overflow-hidden"
                    >
                      <div className="absolute left-0 bottom-0 h-1 bg-amber-400" style={{ width: `${pct}%` }} />
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 tabular-nums">#{idx + 1}</span>
                        <span className="text-sm font-bold text-slate-800">{g.combo}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                        <span className={clsx('px-1.5 rounded', CAT_PILL[g.modifier_category])}>
                          {CAT_LABEL[g.modifier_category]}
                        </span>
                        <span className="text-slate-500">가중치 {fmtNum(g.weight)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {CATEGORIES.map((cat) => {
              const items = result.dna[cat] || []
              const maxW = items[0]?.weight || 1
              return (
                <Card key={cat} variant="white" className="p-4">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                    <span className="text-lg">{CAT_ICON[cat]}</span>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-slate-800">{CAT_LABEL[cat]}</div>
                      <div className="text-[11px] text-slate-500 leading-tight">{CAT_DESC[cat]}</div>
                    </div>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', CAT_PILL[cat])}>{items.length}개</span>
                  </div>
                  {items.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-2">매칭된 토큰이 없습니다.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {items.map((t, i) => {
                        const pct = pctOf(t.weight, maxW)
                        return (
                          <li key={t.token} className="relative bg-slate-50 hover:bg-blue-50 rounded px-2 py-1.5 transition">
                            <div className={clsx('absolute left-0 top-0 bottom-0 rounded-l opacity-20', CAT_BAR[cat])} style={{ width: `${pct}%` }} />
                            <div className="relative flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[10px] tabular-nums text-slate-400 w-4">{i + 1}</span>
                                <span className="text-sm font-bold text-slate-800 truncate">{t.token}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 tabular-nums shrink-0">
                                <span title="등록 상호 수">{t.df}건</span>
                                <span className="text-slate-300">·</span>
                                <span className="font-semibold text-slate-700">{fmtNum(t.weight)}</span>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </Card>
              )
            })}
          </div>

          {result.examples.length > 0 && (
            <Card variant="white" className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-base font-bold text-slate-800">📋 매칭 상호 샘플 ({result.examples.length}개)</div>
                  <div className="text-xs text-slate-500">행을 클릭하면 토큰 분해를 볼 수 있습니다.</div>
                </div>
              </div>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="px-2 py-1.5 w-12 text-right">#</th>
                      <th className="px-2 py-1.5">상호 (등록명)</th>
                      <th className="px-2 py-1.5 w-24 text-right">회선수</th>
                      <th className="px-2 py-1.5">파싱 토큰</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.examples.map((ex, i) => (
                      <tr
                        key={`${ex.name}-${i}`}
                        className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer"
                        onClick={() => setDetailExample(ex)}
                      >
                        <td className="px-2 py-1.5 text-right text-slate-400 tabular-nums">{i + 1}</td>
                        <td className="px-2 py-1.5 font-medium text-slate-800">{ex.name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 font-bold">{fmtNum(ex.weight)}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {ex.tokens.slice(0, 12).map((tok, ti) => (
                              <span key={`${tok}-${ti}`} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded ring-1 ring-blue-100">
                                {tok}
                              </span>
                            ))}
                            {ex.tokens.length > 12 && (
                              <span className="text-[10px] text-slate-400 self-center">+{ex.tokens.length - 12}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {detailExample && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setDetailExample(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-800">상호 토큰 분해</div>
                <div className="text-xs text-slate-500">{detailExample.name}</div>
              </div>
              <button onClick={() => setDetailExample(null)} className="p-1 hover:bg-slate-100 rounded">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm">
                <span className="text-slate-500">회선수: </span>
                <span className="font-bold text-emerald-700">{fmtNum(detailExample.weight)}</span>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1.5">파싱 토큰 ({detailExample.tokens.length}개) — 최장 일치 순</div>
                <div className="flex flex-wrap gap-1.5">
                  {detailExample.tokens.map((tok, i) => (
                    <span key={`${tok}-${i}`} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded ring-1 ring-blue-200">
                      {tok}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
