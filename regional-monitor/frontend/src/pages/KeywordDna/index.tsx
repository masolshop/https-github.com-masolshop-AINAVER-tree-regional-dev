/**
 * 타지역키워드 DNA 파싱 솔루션 — 4 탭 통합 페이지.
 *
 * Tab 1: DNA 분석 (단일 키워드 → 6 카테고리 + golden combos)
 * Tab 2: 다중 비교 (2-8개 키워드 매트릭스 + 유사도)
 * Tab 3: 네트워크 그래프 (SVG force-directed)
 * Tab 4: 키워드 추천 (미커버 영역 자동 탐지)
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Dna, GitCompare, Network, Lightbulb } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { KeywordDnaApi, type DictionaryStats } from '@/api/keywordDna'
import { useAuthStore } from '@/store/auth'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import { fmtNum } from './shared'

import DnaTab from './DnaTab'
import CompareTab from './CompareTab'
import GraphTab from './GraphTab'
import RecommendTab from './RecommendTab'

type TabKey = 'dna' | 'compare' | 'graph' | 'recommend'

interface TabDef {
  key: TabKey
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  desc: string
}

const TABS: TabDef[] = [
  { key: 'dna', label: 'DNA 분석', icon: Dna, desc: '단일 키워드를 6 카테고리로 도식화' },
  { key: 'compare', label: '다중 비교', icon: GitCompare, desc: '2-8개 키워드 매트릭스 + 유사도' },
  { key: 'graph', label: '네트워크 그래프', icon: Network, desc: '토큰 동시출현 시각화' },
  { key: 'recommend', label: '키워드 추천', icon: Lightbulb, desc: '미커버 블루오션 자동 탐지' },
]

export default function KeywordDnaPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = (params.get('tab') as TabKey) || 'dna'
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? tabParam : 'dna'

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [dictStats, setDictStats] = useState<DictionaryStats | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    KeywordDnaApi.dictionaryStats()
      .then((s) => setDictStats(s))
      .catch(() => setDictStats(null))
  }, [isAuthenticated])

  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(params)
    next.set('tab', k)
    setParams(next, { replace: true })
  }

  useBodyClass('solution-tool-page')
  return (
    <div className="space-y-5" data-page="solution-tool">
      <PageSeo
        title="타지역 키워드 DNA 파싱 솔루션 — 1초 분석"
        description="시드 키워드 한 개로 6가지 DNA를 1초 만에 분해하는 규칙형 키워드 분석 엔진입니다."
        path="/keyword-dna"
        keywords={[
          '키워드 DNA',
          '타지역 키워드',
          '네이버 키워드 분석',
          '상호 키워드',
          '키워드 파싱',
          '플레이스 키워드',
          '타지역닷컴',
        ]}
      />
      <TopBar
        title="타지역 키워드 DNA 파싱 솔루션"
        subtitle="네이버 봇이 키워드 형태소로 상호를 읽는 로직을 분석 — 등록 상호 DNA·비교·네트워크·블루오션 추천 (AI 미사용 규칙 기반)"
      />

      {/* 사전 통계 카드 */}
      {dictStats?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] text-slate-500">분석 대상 상호</div>
            <div className="text-xl font-bold text-slate-800">
              {fmtNum(dictStats.stats.business_count)}
              <span className="text-xs text-slate-500 ml-1">개</span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] text-slate-500">등록 업종</div>
            <div className="text-xl font-bold text-slate-800">
              {fmtNum(dictStats.stats.category_count)}
              <span className="text-xs text-slate-500 ml-1">종</span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] text-slate-500">사전 토큰</div>
            <div className="text-xl font-bold text-slate-800">
              {fmtNum(dictStats.stats.token_count)}
              <span className="text-xs text-slate-500 ml-1">개</span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] text-slate-500">총 회선수 가중치</div>
            <div className="text-xl font-bold text-slate-800">
              {fmtNum(dictStats.stats.total_weight)}
            </div>
          </div>
        </div>
      )}

      {/* 탭 바 */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex-1 min-w-[150px] flex items-center gap-2 px-3 py-2.5 rounded-lg transition text-left',
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'hover:bg-slate-50 text-slate-700',
              )}
            >
              <Icon size={18} className={active ? 'text-white' : 'text-blue-600'} />
              <div className="min-w-0">
                <div className={clsx('text-sm font-bold leading-tight', active ? 'text-white' : 'text-slate-800')}>
                  {t.label}
                </div>
                <div className={clsx('text-[10px] leading-tight truncate', active ? 'text-blue-100' : 'text-slate-500')}>
                  {t.desc}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* 탭 본문 */}
      {tab === 'dna' && <DnaTab />}
      {tab === 'compare' && <CompareTab />}
      {tab === 'graph' && <GraphTab />}
      {tab === 'recommend' && <RecommendTab />}
    </div>
  )
}
