/**
 * Tab 2: 다중 키워드 비교 매트릭스 (히트맵 + 유사도)
 */
import { useState } from 'react'
import clsx from 'clsx'
import {
  Plus,
  X,
  Download,
  Loader2,
  AlertTriangle,
  GitCompare,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { KeywordDnaApi, type CompareResult, type DnaCategory } from '@/api/keywordDna'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import {
  CAT_LABEL,
  CAT_PILL,
  todayKstDate,
  safeFilename,
  fmtNum,
} from './shared'

const PRESETS = [
  ['흥신소', '심부름센터', '탐정'],
  ['하수구', '누수', '변기'],
  ['보일러', '에어컨', '수도'],
  ['열쇠', '도어락', 'CCTV'],
]

// 히트맵 색상 (블루 계열, 가중치 비율 0~1)
function heatColor(ratio: number): string {
  if (ratio <= 0) return 'bg-slate-50 text-slate-400'
  if (ratio < 0.1) return 'bg-blue-50 text-slate-700'
  if (ratio < 0.25) return 'bg-blue-100 text-slate-800'
  if (ratio < 0.45) return 'bg-blue-200 text-slate-900'
  if (ratio < 0.65) return 'bg-blue-400 text-white'
  if (ratio < 0.85) return 'bg-blue-500 text-white'
  return 'bg-blue-700 text-white'
}

export default function CompareTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [keywords, setKeywords] = useState<string[]>(['흥신소', '하수구', '누수'])
  const [input, setInput] = useState('')
  const [topPerCat, setTopPerCat] = useState(12)
  const [minDf, setMinDf] = useState(2)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'shared' | 'unique'>('all')
  const [catFilter, setCatFilter] = useState<DnaCategory | 'all'>('all')

  const addKeyword = () => {
    const v = input.trim()
    if (!v) return
    if (keywords.includes(v)) {
      setErrMsg('이미 추가된 키워드입니다.')
      return
    }
    if (keywords.length >= 8) {
      setErrMsg('최대 8개까지 비교할 수 있습니다.')
      return
    }
    setKeywords([...keywords, v])
    setInput('')
    setErrMsg(null)
  }

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw))
  }

  const submit = async () => {
    if (!isAuthenticated) {
      openLoginModal()
      return
    }
    if (keywords.length < 2) {
      setErrMsg('최소 2개 키워드가 필요합니다.')
      return
    }
    setLoading(true)
    setErrMsg(null)
    try {
      const r = await KeywordDnaApi.compare(keywords, { top_per_category: topPerCat, min_df: minDf })
      setResult(r)
    } catch (e: any) {
      setErrMsg(e instanceof ApiError ? e.message : (e?.message || '비교 분석 실패'))
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

    // Sheet 1: 매트릭스
    const matrixRows = result.matrix.map((r, i) => {
      const row: any = {
        순위: i + 1,
        토큰: r.token,
        카테고리: CAT_LABEL[r.category],
        등장키워드수: r.kw_count,
        총가중치: Math.round(r.total_weight),
        공유여부: r.is_shared ? '공유' : (r.is_unique ? '고유' : '부분'),
      }
      for (const kw of result.keywords) {
        row[`${kw}_가중치`] = Math.round(r.weights[kw] || 0)
        row[`${kw}_상호수`] = r.dfs[kw] || 0
      }
      return row
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrixRows), '비교_매트릭스')

    // Sheet 2: 유사도
    const simRows = result.similarity.map((s) => ({
      키워드1: s.kw1,
      키워드2: s.kw2,
      Jaccard유사도: s.jaccard,
      Cosine유사도: s.cosine,
      공유토큰수: s.shared_count,
      공유토큰: s.shared.join(' / '),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(simRows), '유사도')

    // Sheet 3: 요약
    const sumRows = result.summary.map((s) => ({
      키워드: s.keyword,
      매칭상호수: s.matched,
      매칭회선수: Math.round(s.weight_matched),
      시장점유: `${(s.share * 100).toFixed(1)}%`,
      분석시간_ms: s.elapsed_ms,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sumRows), '요약')

    XLSX.writeFile(
      wb,
      `타지역_키워드비교_${safeFilename(result.keywords.join('_'))}_${todayKstDate()}.xlsx`,
    )
  }

  // 매트릭스 필터링
  const filteredMatrix = (result?.matrix || []).filter((r) => {
    if (filter === 'shared' && !r.is_shared) return false
    if (filter === 'unique' && !r.is_unique) return false
    if (catFilter !== 'all' && r.category !== catFilter) return false
    return true
  })

  // 키워드별 max 가중치 (히트맵 정규화용)
  const maxByKw: Record<string, number> = {}
  if (result) {
    for (const kw of result.keywords) {
      maxByKw[kw] = Math.max(1, ...result.matrix.map((r) => r.weights[kw] || 0))
    }
  }

  return (
    <div className="space-y-5">
      {/* 입력 패널 */}
      <Card variant="white" className="p-5">
        <div className="flex items-start gap-2 mb-3">
          <GitCompare className="text-blue-600 mt-0.5" size={20} />
          <div>
            <div className="text-base font-bold text-slate-800">다중 키워드 비교 매트릭스</div>
            <div className="text-xs text-slate-500">
              여러 키워드(2-8개)를 동시 분석하여 공유/고유 토큰, 유사도(Jaccard·Cosine)를 매트릭스로 도식화합니다.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3 items-stretch">
          <div className="flex-1 min-w-[220px] flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addKeyword() }}
              placeholder="키워드 입력 후 Enter (최대 8개)"
              className="flex-1 px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={30}
            />
            <button
              onClick={addKeyword}
              className="px-3 py-2 text-xs bg-slate-100 hover:bg-blue-100 rounded-lg border border-slate-300"
            >
              <Plus size={14} className="inline mr-1" />추가
            </button>
          </div>
          <button
            onClick={submit}
            disabled={loading || keywords.length < 2}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 rounded-lg shadow-sm"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" />비교 중...</> : <><Sparkles size={16} />비교 분석</>}
          </button>
          <select
            value={topPerCat}
            onChange={(e) => setTopPerCat(Number(e.target.value))}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value={8}>상위 8개</option>
            <option value={12}>상위 12개</option>
            <option value={20}>상위 20개</option>
          </select>
          <select
            value={minDf}
            onChange={(e) => setMinDf(Number(e.target.value))}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value={1}>1회 이상</option>
            <option value={2}>2회 이상</option>
            <option value={3}>3회 이상</option>
          </select>
        </div>

        {/* 추가된 키워드 칩 */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {keywords.map((kw) => (
              <span key={kw} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                {kw}
                <button onClick={() => removeKeyword(kw)} className="hover:bg-blue-200 rounded-full p-0.5">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 프리셋 */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-500 self-center mr-1">프리셋:</span>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => { setKeywords(p); setErrMsg(null) }}
              className="px-2.5 py-1 text-[11px] rounded-full bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-700 ring-1 ring-slate-200"
            >
              {p.join(' / ')}
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

      {result && (
        <>
          {/* 키워드별 KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {result.summary.map((s) => (
              <div key={s.keyword} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <div className="text-[11px] text-slate-500">{s.keyword}</div>
                <div className="text-lg font-bold text-blue-700">{fmtNum(s.matched)}<span className="text-xs text-slate-500 ml-1">건</span></div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  회선수 <span className="text-emerald-700 font-bold">{fmtNum(s.weight_matched)}</span> · 점유 {(s.share * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>

          {/* 유사도 카드 */}
          {result.similarity.length > 0 && (
            <Card variant="white" className="p-5">
              <div className="text-base font-bold text-slate-800 mb-3">📐 키워드 간 유사도</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {result.similarity.map((s, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <div className="text-sm font-bold text-slate-800">
                      <span className="text-blue-700">{s.kw1}</span> ↔ <span className="text-blue-700">{s.kw2}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                      <div>
                        <div className="text-slate-500">Jaccard</div>
                        <div className="text-base font-bold text-emerald-700">{(s.jaccard * 100).toFixed(1)}%</div>
                        <div className="h-1.5 mt-1 bg-emerald-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${s.jaccard * 100}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Cosine</div>
                        <div className="text-base font-bold text-blue-700">{(s.cosine * 100).toFixed(1)}%</div>
                        <div className="h-1.5 mt-1 bg-blue-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${s.cosine * 100}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      공유 토큰 <span className="font-bold text-slate-700">{s.shared_count}</span>개
                      {s.shared.length > 0 && (
                        <span className="block mt-0.5 truncate">{s.shared.slice(0, 8).join(', ')}{s.shared.length > 8 ? '...' : ''}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 매트릭스 히트맵 */}
          <Card variant="white" className="p-5">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div>
                <div className="text-base font-bold text-slate-800">🔥 토큰 × 키워드 매트릭스 (히트맵)</div>
                <div className="text-xs text-slate-500">
                  총 {fmtNum(result.matrix_total)}개 토큰 · 공유 {result.shared_count} · 고유 {result.unique_count} · 표시 {filteredMatrix.length}건
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                >
                  <option value="all">전체</option>
                  <option value="shared">공유 토큰만</option>
                  <option value="unique">고유 토큰만</option>
                </select>
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value as any)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                >
                  <option value="all">전체 카테고리</option>
                  <option value="main">메인</option>
                  <option value="action">동작</option>
                  <option value="material">재료</option>
                  <option value="place">장소</option>
                  <option value="brand">브랜드</option>
                  <option value="tag">태그</option>
                </select>
                <button
                  onClick={downloadExcel}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg border-2 border-blue-700 shadow-sm"
                >
                  <Download size={16} />Excel 다운로드
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-2 text-right w-10 text-slate-500">#</th>
                    <th className="px-2 py-2 text-left text-slate-500 min-w-[120px]">토큰</th>
                    <th className="px-2 py-2 text-left text-slate-500 w-20">카테고리</th>
                    <th className="px-2 py-2 text-right text-slate-500 w-12">등장</th>
                    {result.keywords.map((kw) => (
                      <th key={kw} className="px-2 py-2 text-center text-slate-700 font-bold min-w-[80px]">
                        {kw}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.slice(0, 100).map((r, i) => (
                    <tr key={r.token} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1 text-right tabular-nums text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1 font-bold text-slate-800">
                        {r.token}
                        {r.is_shared && <span className="ml-1 text-[9px] text-emerald-700 font-bold">[공유]</span>}
                        {r.is_unique && <span className="ml-1 text-[9px] text-amber-700 font-bold">[고유]</span>}
                      </td>
                      <td className="px-2 py-1">
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', CAT_PILL[r.category])}>
                          {CAT_LABEL[r.category]}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-700 font-bold">{r.kw_count}</td>
                      {result.keywords.map((kw) => {
                        const w = r.weights[kw] || 0
                        const ratio = w / (maxByKw[kw] || 1)
                        return (
                          <td
                            key={kw}
                            className={clsx('px-2 py-1 text-center tabular-nums font-bold transition', heatColor(ratio))}
                            title={`회선수 ${fmtNum(w)} / 상호 ${r.dfs[kw] || 0}건`}
                          >
                            {w > 0 ? fmtNum(w) : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredMatrix.length > 100 && (
                <div className="text-[11px] text-slate-500 text-center py-2">
                  상위 100건만 표시 (전체 {filteredMatrix.length}건). Excel 다운로드로 전체 확인 가능.
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
