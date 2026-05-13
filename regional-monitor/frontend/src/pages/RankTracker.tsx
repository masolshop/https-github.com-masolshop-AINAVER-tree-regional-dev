/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5)
 *
 * 사용자가 Excel(070전번 | 등록동 | 상호 | 추적키워드)을 업로드하면
 *  1) 네이버 지도 크롤링으로 place_id 자동 매칭
 *  2) 매일 새벽 자동 배치로 "등록동 + 키워드" 검색 순위 체크
 *  3) 일별 순위 변동 추적 + 그래프
 *
 * 본 페이지는 stub — 백엔드 모듈(place_matcher / rank_checker / rank_scheduler) 도입 후
 * Phase 4에서 풀 UI(업로드 카드, 매칭 결과 테이블, 추이 차트) 구현 예정.
 */
import { TrendingUp, Upload, LineChart, Bell } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'

export default function RankTracker() {
  useBodyClass('solution-tool-page')

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
          <strong>070전번 · 등록동 · 상호 · 추적키워드</strong> 4컬럼 엑셀 한 번 업로드로
          — 네이버 플레이스 자동 매칭 + 매일 새벽 동별 노출 순위를 자동 추적합니다.
        </p>
      </div>

      {/* 작동 프로세스 안내 (출시 전 임시 UI) */}
      <Card className="p-6 space-y-4">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold ring-1 ring-amber-200">
            🚧 출시 준비 중
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4 bg-gradient-to-br from-blue-50 to-white border-blue-100">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={18} className="text-blue-600" />
              <span className="font-bold text-sm">1. Excel 업로드</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px]">
                070전번 | 등록동 | 상호 | 추적키워드
              </code>
              <br />
              4컬럼 양식 한 번만 올리시면 됩니다.
            </p>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={18} className="text-emerald-600" />
              <span className="font-bold text-sm">2. place_id 자동 매칭</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              네이버 지도를 크롤링해 070전번 · 상호 · 등록동 3중 매칭으로 플레이스 ID를 자동 추출합니다.
            </p>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-purple-50 to-white border-purple-100">
            <div className="flex items-center gap-2 mb-2">
              <LineChart size={18} className="text-purple-600" />
              <span className="font-bold text-sm">3. 매일 자동 순위 체크</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              매일 새벽 2시 KST,
              <code className="px-1 py-0.5 mx-1 bg-slate-100 rounded text-[11px]">등록동 + 키워드</code>
              조합으로 검색해 현재 노출 순위를 기록합니다.
            </p>
          </Card>
          <Card className="p-4 bg-gradient-to-br from-rose-50 to-white border-rose-100">
            <div className="flex items-center gap-2 mb-2">
              <Bell size={18} className="text-rose-600" />
              <span className="font-bold text-sm">4. 순위 변동 알림</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              5단계 이상 하락 · 75위 권외 이탈 등 변동 발생 시 즉시 이메일/카카오 알림으로 알려드립니다.
            </p>
          </Card>
        </div>

        <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-ink-2 leading-relaxed">
          <strong className="text-ink-1">📅 출시 일정 안내</strong>
          <br />
          현재 백엔드 자동 매칭 모듈(place_matcher) · 일별 배치 잡(rank_scheduler) 개발 중입니다.
          정식 오픈 시 사이드바 메뉴에서 바로 사용 가능합니다.
        </div>
      </Card>
    </div>
  )
}
