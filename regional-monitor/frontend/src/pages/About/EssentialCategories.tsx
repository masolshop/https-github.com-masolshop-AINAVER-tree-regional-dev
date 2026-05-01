/**
 * 타지역 필수업종
 * - 타지역서비스가 필수/유효한 업종 리스트와 회선수(시장규모) 시각화
 * - 데이터 소스: /api/v1/keyword-dna/health 의 dictionary 통계
 */
import { useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Briefcase, TrendingUp, AlertCircle } from 'lucide-react'
import { KeywordDnaApi } from '@/api/keywordDna'

interface CategoryRow {
  category: string
  count: number
}

// 필수업종 시드 (출장/긴급출동형 서비스)
const ESSENTIAL_HINTS = [
  '하수구', '누수', '열쇠', '보일러', '이사', '이삿짐', '청소', '폐기물',
  '심부름', '흥신소', '에어컨', '배관', '수도', '도어', '유품정리',
  '특수청소', '철거', '용달', '퀵', '고소', '사다리', '크레인', '스카이',
  '자동문', '셔터', '샤시', '창호', '유리', '거울', 'CCTV', '전기공사',
  '운전대행', '꽃집', '꽃배달', '중고차', '컴퓨터수리', '누수탐지',
]

function isEssential(name: string): boolean {
  return ESSENTIAL_HINTS.some((h) => name.includes(h))
}

export default function EssentialCategories() {
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    KeywordDnaApi.categories()
      .then((res) => {
        if (!mounted) return
        setRows(res?.categories ?? [])
      })
      .catch((err: any) => {
        if (!mounted) return
        setErrMsg(err?.message || '카테고리 정보를 불러오지 못했습니다.')
      })
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [])

  const filtered = rows
    .filter((r) => isEssential(r.category))
    .sort((a, b) => b.count - a.count)

  const totalWeight = filtered.reduce((s, r) => s + r.count, 0)
  const maxCount = filtered[0]?.count ?? 1

  return (
    <div className="space-y-8">
      <TopBar
        title="타지역 필수업종"
        subtitle="타지역서비스 운영이 필수/유효한 업종 리스트 (회선수 기준 시장규모 정렬)"
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card variant="white">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <Briefcase size={14} /> 필수업종 수
          </div>
          <div className="text-h2 font-bold text-ink mt-1">
            {filtered.length.toLocaleString()}
          </div>
        </Card>
        <Card variant="white">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <TrendingUp size={14} /> 합산 회선수
          </div>
          <div className="text-h2 font-bold text-ink mt-1">
            {totalWeight.toLocaleString()}
          </div>
        </Card>
        <Card variant="white" className="hidden md:block">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <AlertCircle size={14} /> 데이터 소스
          </div>
          <div className="text-body font-semibold text-ink mt-1">
            타지역업종리스트.xlsx (216개 카테고리)
          </div>
        </Card>
      </div>

      {/* 에러 */}
      {errMsg && (
        <Card variant="white" className="border border-rose-200 bg-rose-50">
          <p className="text-body-sm text-rose-700">{errMsg}</p>
        </Card>
      )}

      {/* 표 */}
      <Card variant="white" className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-bg-subtle flex items-center justify-between">
          <h3 className="text-h3 text-ink">필수업종 회선수 랭킹</h3>
          {loading && <span className="text-caption text-ink-muted">로딩 중…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-bg-subtle">
              <tr className="text-ink-muted text-caption">
                <th className="text-left px-4 py-2 w-12">순위</th>
                <th className="text-left px-4 py-2">업종</th>
                <th className="text-right px-4 py-2 w-32">회선수</th>
                <th className="text-left px-4 py-2 w-1/3">시장규모</th>
                <th className="text-right px-4 py-2 w-20">비중</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const pct = totalWeight > 0 ? (r.count / totalWeight) * 100 : 0
                const barPct = (r.count / maxCount) * 100
                return (
                  <tr key={r.category} className="border-t border-bg-subtle hover:bg-bg-subtle/40">
                    <td className="px-4 py-2 text-ink-muted">{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-ink">{r.category}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.count.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-ink-muted">{pct.toFixed(1)}%</td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    표시할 필수업종이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
