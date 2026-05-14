/**
 * Tab 4: 키워드 추천 자동화 — 미커버/저경쟁 영역 탐지.
 *
 * Opportunity Score = market_weight / (1 + log(competition_weight + 1))
 *   - market_weight: seed 풀에서 modifier 토큰의 모분포 가중치 (수요)
 *   - competition_weight: seed+modifier 동시 등장 회선수 (경쟁)
 * 상태 라벨:
 *   - uncovered (미커버): 동시 등장 0건 → 블루오션
 *   - low_competition (저경쟁): 1-2건
 *   - moderate (중간): 3-5건
 *   - saturated (포화): 6건+
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Lightbulb,
  Loader2,
  AlertTriangle,
  Sparkles,
  Download,
  TrendingUp,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import {
  KeywordDnaApi,
  type RecommendResult,
  type OppStatus,
} from '@/api/keywordDna'
import { demoApi } from '@/api/demo'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import {
  CAT_LABEL,
  CAT_PILL,
  SAMPLE_KEYWORDS,
  todayKstDate,
  safeFilename,
  fmtNum,
} from './shared'

const STATUS_PILL: Record<OppStatus, string> = {
  uncovered: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300',
  low_competition: 'bg-blue-100 text-blue-700 ring-1 ring-blue-300',
  moderate: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
  saturated: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300',
}

const STATUS_DOT: Record<OppStatus, string> = {
  uncovered: 'bg-emerald-500',
  low_competition: 'bg-blue-500',
  moderate: 'bg-amber-500',
  saturated: 'bg-rose-500',
}

const STATUS_DESC: Record<OppStatus, string> = {
  uncovered: '🔥 블루오션 — 시장 수요는 있으나 등록 상호 0건',
  low_competition: '✨ 저경쟁 — 1-2건만 등록, 진입 적기',
  moderate: '⚖️ 중간 — 3-5건 등록, 차별화 필요',
  saturated: '⚠️ 포화 — 6건 이상 등록',
}

export default function RecommendTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isDemo = useAuthStore((s) => s.isDemo)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [seed, setSeed] = useState('하수구')
  const [top, setTop] = useState(20)
  const [minDf, setMinDf] = useState(3)
  const [result, setResult] = useState<RecommendResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | OppStatus>('all')

  // 데모: 마운트 시 캡처된 흥신소 추천 자동 로드
  useEffect(() => {
    if (!isAuthenticated || !isDemo) return
    if (result) return
    setLoading(true)
    setErrMsg(null)
    demoApi
      .keywordDna()
      .then((r) => {
        setSeed(r.keyword || '흥신소')
        setResult(r.recommend)
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
      setLoading(true)
      setErrMsg(null)
      try {
        const r = await demoApi.keywordDna()
        setSeed(r.keyword || '흥신소')
        setResult(r.recommend)
      } catch (e: any) {
        setErrMsg(e instanceof ApiError ? e.message : (e?.message || '데모 데이터 로드 실패'))
      } finally {
        setLoading(false)
      }
      return
    }
    const target = (kw ?? seed).trim()
    if (!target) {
      setErrMsg('seed 키워드를 입력하세요.')
      return
    }
    setSeed(target)
    setLoading(true)
    setErrMsg(null)
    try {
      const r = await KeywordDnaApi.recommend(target, { top, min_modifier_df: minDf })
      setResult(r)
      if (r.stats.seed_matched === 0) {
        setErrMsg(`'${target}'을(를) 포함하는 등록 상호가 없습니다.`)
      }
    } catch (e: any) {
      setErrMsg(e instanceof ApiError ? e.message : (e?.message || '추천 분석 실패'))
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
    const rows = result.candidates.map((c, i) => ({
      순위: i + 1,
      추천_조합: c.combo,
      수식어: c.modifier,
      카테고리: CAT_LABEL[c.modifier_category],
      상태: c.status_label,
      기회점수: c.opportunity,
      시장수요_가중치: Math.round(c.market_weight),
      시장수요_상호수: c.market_df,
      경쟁_가중치: Math.round(c.competition_weight),
      경쟁_상호수: c.competition_count,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '키워드_추천')
    XLSX.writeFile(
      wb,
      `타지역_키워드추천_${safeFilename(result.normalized)}_${todayKstDate()}.xlsx`,
    )
  }

  const filtered = (result?.candidates || []).filter((c) =>
    statusFilter === 'all' ? true : c.status === statusFilter,
  )

  // KPI counts
  const counts: Record<OppStatus, number> = {
    uncovered: 0,
    low_competition: 0,
    moderate: 0,
    saturated: 0,
  }
  if (result) {
    for (const c of result.candidates) counts[c.status]++
  }

  return (
    <div className="space-y-5">
      <Card variant="white" className="p-5">
        <div className="flex items-start gap-2 mb-3">
          <Lightbulb className="text-amber-500 mt-0.5" size={20} />
          <div>
            <div className="text-base font-bold text-slate-800">키워드 추천 — 미커버 영역 탐지</div>
            <div className="text-xs text-slate-500">
              seed 키워드 풀에서 자주 등장하는 행동·재료·장소 토큰을 후보로 생성하고,
              시장 수요 대비 경쟁이 낮은 조합(블루오션)을 자동 추천합니다.
            </div>
          </div>
        </div>

        {isDemo && (
          <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
            🎬 외부 공개 데모 — seed <b>"흥신소"</b>의 실제 캡처 추천 결과를 보여드립니다.
            실시간 분석은 회원가입 후 이용 가능합니다.
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-stretch">
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="seed 키워드 (예: 하수구, 흥신소, 누수)"
            className={`flex-1 min-w-[220px] px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDemo ? 'bg-slate-100 cursor-not-allowed' : ''}`}
            maxLength={30}
            readOnly={isDemo}
            title={isDemo ? '데모 키워드는 변경할 수 없습니다' : undefined}
          />
          <button
            onClick={() => submit()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 rounded-lg shadow-sm"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" />추천 중...</> : <><Sparkles size={16} />추천 분석</>}
          </button>
          <select
            value={top}
            onChange={(e) => setTop(Number(e.target.value))}
            disabled={isDemo}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
          >
            <option value={10}>상위 10개</option>
            <option value={20}>상위 20개</option>
            <option value={30}>상위 30개</option>
            <option value={50}>상위 50개</option>
          </select>
          <select
            value={minDf}
            onChange={(e) => setMinDf(Number(e.target.value))}
            disabled={isDemo}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
          >
            <option value={1}>모분포 1회 이상</option>
            <option value={3}>모분포 3회 이상</option>
            <option value={5}>모분포 5회 이상</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-500 self-center mr-1">빠른 시작:</span>
          {SAMPLE_KEYWORDS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="px-2.5 py-1 text-xs rounded-full bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-700 ring-1 ring-slate-200"
            >
              {s}
            </button>
          ))}
        </div>

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800">{errMsg}</div>
          </div>
        )}
      </Card>

      {result && result.candidates.length > 0 && (
        <>
          {/* 상태별 KPI 4종 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['uncovered', 'low_competition', 'moderate', 'saturated'] as OppStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                className={clsx(
                  'text-left bg-white rounded-xl border-2 px-4 py-3 transition',
                  statusFilter === s
                    ? 'border-blue-500 shadow-md'
                    : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={clsx('inline-block w-2.5 h-2.5 rounded-full', STATUS_DOT[s])} />
                  <div className="text-[11px] text-slate-500 font-bold">
                    {s === 'uncovered' && '미커버'}
                    {s === 'low_competition' && '저경쟁'}
                    {s === 'moderate' && '중간'}
                    {s === 'saturated' && '포화'}
                  </div>
                </div>
                <div className="text-xl font-bold text-slate-800 mt-1">
                  {counts[s]}<span className="text-xs text-slate-500 ml-1">건</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{STATUS_DESC[s]}</div>
              </button>
            ))}
          </div>

          {/* 결과 테이블 */}
          <Card variant="white" className="p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <div className="text-base font-bold text-slate-800 inline-flex items-center gap-1.5">
                  <TrendingUp size={18} className="text-emerald-600" />
                  추천 키워드 ({filtered.length}건 / 전체 {result.candidates.length})
                </div>
                <div className="text-xs text-slate-500">
                  seed: <span className="font-bold text-blue-700">{result.normalized}</span> · 매칭 상호 {fmtNum(result.stats.seed_matched)}건 · {result.stats.elapsed_ms}ms
                </div>
              </div>
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                >
                  <option value="all">전체</option>
                  <option value="uncovered">미커버</option>
                  <option value="low_competition">저경쟁</option>
                  <option value="moderate">중간</option>
                  <option value="saturated">포화</option>
                </select>
                <button
                  onClick={downloadExcel}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg border-2 border-blue-700 shadow-sm"
                >
                  <Download size={16} />Excel 다운로드
                </button>
              </div>
            </div>

            {/* 카드 그리드 — top */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((c, i) => {
                const maxOpp = result.candidates[0]?.opportunity || 1
                const oppPct = Math.min(100, (c.opportunity / maxOpp) * 100)
                return (
                  <div
                    key={c.combo}
                    className="relative bg-gradient-to-br from-white to-slate-50 rounded-xl border-2 border-slate-200 hover:border-blue-300 px-4 py-3 transition overflow-hidden"
                  >
                    {/* 순위 */}
                    <div className="absolute top-2 right-2 text-[10px] tabular-nums text-slate-400 font-bold">
                      #{i + 1}
                    </div>
                    {/* 진행 바 */}
                    <div
                      className="absolute left-0 bottom-0 h-1 bg-blue-500"
                      style={{ width: `${oppPct}%` }}
                    />

                    <div className="flex items-center gap-2 mb-2">
                      <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold', STATUS_PILL[c.status])}>
                        <span className={clsx('inline-block w-1.5 h-1.5 rounded-full', STATUS_DOT[c.status])} />
                        {c.status_label}
                      </span>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', CAT_PILL[c.modifier_category])}>
                        {CAT_LABEL[c.modifier_category]}
                      </span>
                    </div>

                    <div className="text-base font-bold text-slate-800 mb-1">{c.combo}</div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
                      <div>
                        <div className="text-slate-500">기회 점수</div>
                        <div className="text-base font-bold text-blue-700 tabular-nums">{fmtNum(c.opportunity)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">시장 수요</div>
                        <div className="text-sm font-bold text-emerald-700 tabular-nums">
                          {fmtNum(c.market_weight)}
                        </div>
                        <div className="text-[10px] text-slate-400">{c.market_df}건</div>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">현재 경쟁</span>
                        <span className={clsx(
                          'font-bold tabular-nums',
                          c.competition_count === 0 ? 'text-emerald-700' :
                          c.competition_count <= 2 ? 'text-blue-700' :
                          c.competition_count <= 5 ? 'text-amber-700' : 'text-rose-700',
                        )}>
                          {c.competition_count}건 ({fmtNum(c.competition_weight)})
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">
                해당 상태의 추천 키워드가 없습니다.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
