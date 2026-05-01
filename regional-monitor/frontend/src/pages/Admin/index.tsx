/**
 * Admin Dashboard — /admin
 *
 * 슈퍼어드민 전용. 5개 탭:
 *  · 대시보드     — 시스템 통계
 *  · 회원 모니터링 — 전 회원 등록갯수·검증상태 요약 (/admin/monitor 또는 ?tab=monitor)
 *  · 사용자       — 검색/필터/플랜·차단/삭제
 *  · 결제         — 목록/수동 부여/환불
 *  · 백업         — DB·사용자·코드 자동 백업/다운로드/즉시 실행
 *
 * 라우팅 가드: AdminRoute 가 user.is_superadmin 검사. 비-어드민 → / 로 리다이렉트.
 *
 * URL 동기화:
 *  · /admin/monitor          → tab=monitor
 *  · /admin?tab=stats|users|... → 해당 탭
 *  · 탭 전환 시 URL replace (히스토리 오염 방지)
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard,
  Users as UsersIcon,
  CreditCard,
  ShieldCheck,
  HardDrive,
  Activity,
  Clock,
  Mail,
} from 'lucide-react'

import { useAuthStore } from '@/store/auth'
import { TopBar } from '@/components/layout/TopBar'

import { AdminStats } from './AdminStats'
import { AdminUsers } from './AdminUsers'
import { AdminPayments } from './AdminPayments'
import { AdminBackup } from './AdminBackup'
import { AdminMonitor } from './AdminMonitor'
import { AdminSchedule } from './AdminSchedule'
import { AdminWeeklyReport } from './AdminWeeklyReport'

type TabKey = 'stats' | 'monitor' | 'schedule' | 'weekly-report' | 'users' | 'payments' | 'backup'

const TABS: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'stats', label: '대시보드', icon: <LayoutDashboard className="h-4 w-4" />, desc: '시스템 전체 통계' },
  { key: 'monitor', label: '회원 모니터링', icon: <Activity className="h-4 w-4" />, desc: '전 회원 등록·검증상태 요약' },
  { key: 'schedule', label: '검증 스케줄', icon: <Clock className="h-4 w-4" />, desc: '자동 검증 주기·슬롯 v2' },
  { key: 'weekly-report', label: '주간 리포트', icon: <Mail className="h-4 w-4" />, desc: '주간 메일 발송 이력·수동 발송' },
  { key: 'users', label: '사용자 관리', icon: <UsersIcon className="h-4 w-4" />, desc: '회원 목록·플랜·차단' },
  { key: 'payments', label: '결제 관리', icon: <CreditCard className="h-4 w-4" />, desc: '결제 이력·수동 부여·환불' },
  { key: 'backup', label: '백업', icon: <HardDrive className="h-4 w-4" />, desc: 'DB·사용자·코드 자동 백업' },
]

const VALID_TABS: TabKey[] = ['stats', 'monitor', 'schedule', 'weekly-report', 'users', 'payments', 'backup']

function pickInitialTab(pathname: string, searchTab: string | null): TabKey {
  // /admin/monitor, /admin/schedule 형태 우선
  if (pathname.startsWith('/admin/monitor')) return 'monitor'
  if (pathname.startsWith('/admin/schedule')) return 'schedule'
  if (searchTab && VALID_TABS.includes(searchTab as TabKey)) {
    return searchTab as TabKey
  }
  return 'stats'
}


export default function Admin() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)

  const [tab, setTab] = useState<TabKey>(() =>
    pickInitialTab(location.pathname, searchParams.get('tab')),
  )

  // URL → 탭 동기화 (브라우저 뒤로/앞으로 시)
  useEffect(() => {
    const next = pickInitialTab(location.pathname, searchParams.get('tab'))
    if (next !== tab) setTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, searchParams])

  // 탭 변경 시 URL 동기화 (replace — 히스토리 오염 방지)
  const handleTabChange = (next: TabKey) => {
    setTab(next)
    // /admin/monitor, /admin/schedule 경로에서 다른 탭으로 가면 /admin 으로 정규화
    if (location.pathname.startsWith('/admin/monitor') && next !== 'monitor') {
      navigate(`/admin?tab=${next}`, { replace: true })
      return
    }
    if (location.pathname.startsWith('/admin/schedule') && next !== 'schedule') {
      navigate(`/admin?tab=${next}`, { replace: true })
      return
    }
    const sp = new URLSearchParams(searchParams)
    if (next === 'stats') {
      sp.delete('tab')
    } else {
      sp.set('tab', next)
    }
    setSearchParams(sp, { replace: true })
  }

  return (
    <div className="min-h-screen bg-bg pb-20">
      <TopBar
        title="관리자 콘솔"
        subtitle={
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            슈퍼어드민 — {user?.email}
          </span>
        }
      />

      <div className="mx-auto max-w-[1400px] px-6">
        {/* 탭 바 */}
        <div className="mt-6 flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`group relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t.icon}
              {t.label}
              <span className="hidden text-[11px] font-normal text-ink-muted lg:inline">
                · {t.desc}
              </span>
              {tab === t.key && (
                <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-brand-500" />
              )}
            </button>
          ))}
        </div>

        {/* 탭 컨텐츠 */}
        <div className="mt-6">
          {tab === 'stats' && <AdminStats />}
          {tab === 'monitor' && <AdminMonitor />}
          {tab === 'schedule' && <AdminSchedule />}
          {tab === 'weekly-report' && <AdminWeeklyReport />}
          {tab === 'users' && <AdminUsers />}
          {tab === 'payments' && <AdminPayments />}
          {tab === 'backup' && <AdminBackup />}
        </div>
      </div>
    </div>
  )
}
