/**
 * Monitor 페이지 — 4탭 셸
 *  ├─ 등록 관리 (RegisterTab)
 *  ├─ 실시간 노출 확인 (LiveCheckTab)
 *  ├─ 자동 노출 검증 (HistoryBody) — 2026-05 사이드바에서 이동
 *  └─ 설정 (SettingsTab)
 *
 * URL: /monitor?tab=register | live | history | settings
 */
import { useSearchParams } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'
import { ClipboardList, Activity, History as HistoryIcon, Settings } from 'lucide-react'
import RegisterTab from './RegisterTab'
import LiveCheckTab from './LiveCheckTab'
import SettingsTab from './SettingsTab'
import { HistoryBody } from '../History'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import clsx from 'clsx'

type TabKey = 'register' | 'live' | 'history' | 'settings'

const TABS: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    key: 'register',
    label: '등록 관리',
    icon: <ClipboardList size={16} />,
    desc: '070 번호 등록 / 수정 / 삭제',
  },
  {
    key: 'live',
    label: '실시간 노출 확인',
    icon: <Activity size={16} />,
    desc: '플레이스 ID 기반 즉시 4중 검증',
  },
  {
    key: 'history',
    label: '자동 노출 검증',
    icon: <HistoryIcon size={16} />,
    desc: '자동/수동 검증 회차별 결과 요약',
  },
  {
    key: 'settings',
    label: '설정',
    icon: <Settings size={16} />,
    desc: '검증 주기 / 알림 / 구글시트',
  },
]

export default function Monitor() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) || 'register'
  useBodyClass('solution-tool-page')

  const setTab = (key: TabKey) => {
    setParams({ tab: key })
  }

  return (
    <div data-page="solution-tool">
      <PageSeo
        title="네이버 노출관리 자동체크 솔루션"
        description="플레이스 ID 4중 검증을 매일 새벽 자동 실행. 변경 즉시 이메일·카카오 알림으로 매출 손실 차단."
        path="/monitor"
        keywords={[
          '네이버 노출관리',
          '노출 자동체크',
          '플레이스 모니터링',
          '070 가상번호',
          '플레이스 누락',
          '4중 검증',
          '타지역닷컴',
        ]}
      />
      <TopBar
        title="실시간 노출 관리"
        subtitle="등록한 070 가상번호의 노출 상태를 플레이스 ID 기반으로 점검합니다"
      />

      {/* ───── 탭 바 ───── */}
      <div className="flex flex-wrap items-center gap-2 mb-6 p-1.5 rounded-pill bg-white shadow-card w-fit">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={clsx(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-pill text-body-sm font-semibold transition-all',
                active
                  ? 'bg-brand-500 text-white shadow-card'
                  : 'text-ink-muted hover:text-ink hover:bg-bg-subtle/60',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ───── 활성 탭 콘텐츠 ───── */}
      {tab === 'register' && <RegisterTab />}
      {tab === 'live' && <LiveCheckTab />}
      {tab === 'history' && <HistoryBody />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
