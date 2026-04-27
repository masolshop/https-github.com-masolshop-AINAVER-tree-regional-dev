/**
 * 사이드바
 * - 0번: 계정 정보 카드 (상단 고정)
 * - 1번: 홈
 * - 2번: 솔루션 소개
 * - 3번: 실시간 노출 관리   ← 로그인 필요
 * - 4번: 자동 노출 검증 관리   ← 로그인 필요
 */
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  Radio,
  History,
  LogIn,
  LogOut,
  User as UserIcon,
  ShieldCheck,
  Crown,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth'
import { useLogout } from '@/hooks/useAuth'

const PLAN_LABEL: Record<string, string> = {
  free: 'FREE',
  basic: 'BASIC',
  pro: 'PRO',
  enterprise: 'ENTERPRISE',
}

interface MenuItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string; size?: number }>
  requireAuth: boolean
}

const MENU: MenuItem[] = [
  { to: '/',         label: '홈',                  icon: LayoutDashboard, requireAuth: false },
  { to: '/intro',    label: '솔루션 소개',          icon: BookOpen,        requireAuth: false },
  { to: '/monitor',  label: '실시간 노출 관리',     icon: Radio,           requireAuth: true  },
  { to: '/history',  label: '자동 노출 검증 관리', icon: History,         requireAuth: true  },
]

export function Sidebar() {
  const navigate = useNavigate()
  const { user, isAuthenticated, openLoginModal } = useAuthStore()
  const logoutMut = useLogout()

  const handleMenuClick = (item: MenuItem, e: React.MouseEvent) => {
    if (item.requireAuth && !isAuthenticated) {
      e.preventDefault()
      openLoginModal(item.to)
    }
  }

  return (
    <aside className="w-72 shrink-0 h-screen sticky top-0 flex flex-col p-5 gap-4">
      {/* 로고 */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-card">
            <ShieldCheck className="text-white" size={20} />
          </div>
          <div className="leading-tight">
            <div className="text-h3 font-extrabold text-ink">RegionWatch</div>
            <div className="text-caption text-ink-muted">실시간 노출 관리</div>
          </div>
        </div>
      </div>

      {/* 0. 계정 카드 */}
      <div
        className={clsx(
          'rounded-card p-4 transition-all',
          isAuthenticated
            ? 'bg-brand-800 text-white shadow-card-dark'
            : 'bg-white shadow-card',
        )}
      >
        {isAuthenticated && user ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {user.picture ? (
                <img src={user.picture} alt="" className="w-10 h-10 rounded-full ring-2 ring-white/30" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <UserIcon size={20} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-body font-semibold truncate">{user.name}</div>
                <div className="text-caption opacity-80 truncate">{user.email}</div>
              </div>
            </div>
            {user.company && (
              <div className="flex items-center justify-between pt-2 border-t border-white/15">
                <span className="text-caption opacity-80">회사</span>
                <span className="text-caption font-medium truncate max-w-[60%]">
                  {user.company}
                  {user.job_title ? ` · ${user.job_title}` : ''}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-white/15">
              <span className="text-caption opacity-80">플랜</span>
              <span className="text-caption font-bold px-2 py-0.5 rounded-full bg-white/20">
                {PLAN_LABEL[user.plan] ?? user.plan.toUpperCase()}
              </span>
            </div>
            <button
              onClick={() => {
                logoutMut.mutate(undefined, {
                  onSettled: () => navigate('/'),
                })
              }}
              disabled={logoutMut.isPending}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-caption font-medium rounded-xl bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-60"
            >
              <LogOut size={14} /> 로그아웃
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-bg-subtle flex items-center justify-center text-ink-muted">
                <UserIcon size={20} />
              </div>
              <div>
                <div className="text-body font-semibold text-ink">게스트</div>
                <div className="text-caption text-ink-muted">로그인이 필요합니다</div>
              </div>
            </div>
            <button
              onClick={() => openLoginModal()}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-body-sm font-semibold rounded-xl bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              <LogIn size={16} /> 로그인 / 회원가입
            </button>
          </div>
        )}
      </div>

      {/* 메뉴 */}
      <nav className="flex flex-col gap-1.5">
        {MENU.map((item) => {
          const Icon = item.icon
          const locked = item.requireAuth && !isAuthenticated
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(e) => handleMenuClick(item, e)}
              className={({ isActive }) =>
                clsx(
                  'sidebar-item',
                  isActive && !locked && 'active',
                  locked && 'opacity-60',
                )
              }
            >
              <Icon size={18} />
              <span className="flex-1">{item.label}</span>
              {locked && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-ink-watermark text-ink-muted font-semibold">
                  로그인
                </span>
              )}
            </NavLink>
          )
        })}

        {/* 슈퍼어드민 전용 메뉴 */}
        {isAuthenticated && user?.is_superadmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              clsx(
                'sidebar-item mt-2 border-t border-bg-subtle pt-3',
                isActive && 'active',
              )
            }
          >
            <Crown size={18} className="text-amber-500" />
            <span className="flex-1">관리자 콘솔</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">
              ADMIN
            </span>
          </NavLink>
        )}
      </nav>

      {/* 하단 푸터 */}
      <div className="mt-auto px-3 py-2 text-caption text-ink-soft">
        <div>© 2026 RegionWatch</div>
        <div className="mt-1">v0.1.0 · 검증 정확도 97.2%</div>
      </div>
    </aside>
  )
}
