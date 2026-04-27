/**
 * Admin Dashboard — /admin
 *
 * 슈퍼어드민 전용. 4개 탭:
 *  · 대시보드 — 시스템 통계
 *  · 사용자  — 검색/필터/플랜·차단/삭제
 *  · 결제    — 목록/수동 부여/환불
 *  · 백업    — DB·사용자·코드 자동 백업/다운로드/즉시 실행
 *
 * 라우팅 가드: AdminRoute 가 user.is_superadmin 검사. 비-어드민 → / 로 리다이렉트.
 */
import { useState } from 'react'
import {
  LayoutDashboard,
  Users as UsersIcon,
  CreditCard,
  ShieldCheck,
  HardDrive,
} from 'lucide-react'

import { useAuthStore } from '@/store/auth'
import { TopBar } from '@/components/layout/TopBar'

import { AdminStats } from './AdminStats'
import { AdminUsers } from './AdminUsers'
import { AdminPayments } from './AdminPayments'
import { AdminBackup } from './AdminBackup'

type TabKey = 'stats' | 'users' | 'payments' | 'backup'

const TABS: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'stats', label: '대시보드', icon: <LayoutDashboard className="h-4 w-4" />, desc: '시스템 전체 통계' },
  { key: 'users', label: '사용자 관리', icon: <UsersIcon className="h-4 w-4" />, desc: '회원 목록·플랜·차단' },
  { key: 'payments', label: '결제 관리', icon: <CreditCard className="h-4 w-4" />, desc: '결제 이력·수동 부여·환불' },
  { key: 'backup', label: '백업', icon: <HardDrive className="h-4 w-4" />, desc: 'DB·사용자·코드 자동 백업' },
]


export default function Admin() {
  const [tab, setTab] = useState<TabKey>('stats')
  const user = useAuthStore((s) => s.user)

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
              onClick={() => setTab(t.key)}
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
          {tab === 'users' && <AdminUsers />}
          {tab === 'payments' && <AdminPayments />}
          {tab === 'backup' && <AdminBackup />}
        </div>
      </div>
    </div>
  )
}
