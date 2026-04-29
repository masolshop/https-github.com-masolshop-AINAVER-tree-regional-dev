/**
 * 사이드바
 * - 0번: 계정 정보 카드 (상단 고정)
 * - 1번: 홈
 * - 2번: 솔루션 소개
 * - 3번: 실시간 노출 관리   ← 로그인 필요
 * - 4번: 자동 노출 검증 관리   ← 로그인 필요
 *
 * 데스크탑(≥lg): 좌측 고정 사이드바
 * 모바일(<lg): AppLayout이 Drawer로 감싸서 표시
 *
 * onItemClick: 메뉴/로그인/로그아웃 클릭 시 호출 (모바일 Drawer 자동 닫기용)
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
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
  Edit3,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth'
import { useLogout } from '@/hooks/useAuth'
import { authApi } from '@/api/auth'
import type { User } from '@/api/types'

interface SidebarProps {
  onItemClick?: () => void
}

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

export function Sidebar({ onItemClick }: SidebarProps = {}) {
  const navigate = useNavigate()
  const { user, isAuthenticated, openLoginModal } = useAuthStore()
  const logoutMut = useLogout()
  const [editOpen, setEditOpen] = useState(false)

  const handleMenuClick = (item: MenuItem, e: React.MouseEvent) => {
    if (item.requireAuth && !isAuthenticated) {
      e.preventDefault()
      openLoginModal(item.to)
    }
    onItemClick?.()
  }

  return (
    <aside className="w-72 shrink-0 h-screen lg:sticky lg:top-0 flex flex-col p-5 gap-4 bg-bg overflow-y-auto">
      {/* 로고 */}
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-card">
            <ShieldCheck className="text-white" size={20} />
          </div>
          <div className="leading-tight">
            <div className="text-h3 font-extrabold text-ink">타지역서비스</div>
            <div className="text-caption text-ink-muted">네이버 실시간 노출 관리</div>
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-caption font-medium rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
              >
                <Edit3 size={14} /> 정보 수정
              </button>
              <button
                onClick={() => {
                  onItemClick?.()
                  logoutMut.mutate(undefined, {
                    onSettled: () => navigate('/'),
                  })
                }}
                disabled={logoutMut.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-caption font-medium rounded-xl bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-60"
              >
                <LogOut size={14} /> 로그아웃
              </button>
            </div>
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
              onClick={() => {
                onItemClick?.()
                openLoginModal()
              }}
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
            onClick={() => onItemClick?.()}
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
        <div>© 2026 타지역서비스</div>
        <div className="mt-1">v0.1.0 · 검증 정확도 97.2%</div>
      </div>

      {/* 본인 정보 수정 모달 */}
      {editOpen && user && (
        <ProfileEditModal user={user} onClose={() => setEditOpen(false)} />
      )}
    </aside>
  )
}


// ──────────────────────────────────────────────────────────────
// 본인 정보 수정 모달 — 이름/이메일/회사명/직함
// ──────────────────────────────────────────────────────────────

function ProfileEditModal({ user, onClose }: { user: User; onClose: () => void }) {
  const setUser = useAuthStore((s) => s.setUser)
  const [name, setName] = useState<string>(user.name || '')
  const [email, setEmail] = useState<string>(user.email || '')
  const [company, setCompany] = useState<string>(user.company || '')
  const [jobTitle, setJobTitle] = useState<string>(user.job_title || '')
  const [errMsg, setErrMsg] = useState<string>('')

  const mutation = useMutation({
    mutationFn: () => {
      const body: import('@/api/types').MyProfileUpdateRequest = {}
      const trimmedName = name.trim()
      if (trimmedName && trimmedName !== user.name) body.name = trimmedName
      const trimmedEmail = email.trim().toLowerCase()
      if (trimmedEmail && trimmedEmail !== (user.email || '').toLowerCase()) {
        body.email = trimmedEmail
      }
      const trimmedCompany = company.trim()
      if (trimmedCompany !== (user.company || '')) {
        body.company = trimmedCompany || null
      }
      const trimmedJob = jobTitle.trim()
      if (trimmedJob !== (user.job_title || '')) {
        body.job_title = trimmedJob || null
      }
      // 변경된 필드가 하나도 없으면 호출 생략
      if (Object.keys(body).length === 0) {
        return Promise.resolve({ user })
      }
      return authApi.updateMyProfile(body)
    },
    onSuccess: (res) => {
      if (res?.user) setUser(res.user)
      onClose()
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        '저장 중 오류가 발생했습니다.'
      setErrMsg(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

  // ⚠️ 사이드바(<aside>) 안에서 렌더되면 stacking-context에 갇혀 메인 콘텐츠와 겹쳐 보임.
  // createPortal 로 document.body 직속에 렌더하여 화면 전체를 덮도록 한다.
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 px-4"
      onClick={(e) => {
        // 백드롭 클릭 시 닫기 (모달 본체 클릭은 무시)
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">내 정보 수정</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-slate-100 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-ink-muted">이름</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-ink-muted">
              이메일 (로그인 ID로 사용됨)
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm focus:border-brand-400 focus:outline-none"
            />
            <div className="mt-1 text-[11px] text-amber-600">
              ⚠️ 이메일 변경 시 새 주소로 로그인해야 합니다 (다른 사용자와 중복 시 저장 불가).
            </div>
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-ink-muted">회사명</div>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="(선택) 회사/상호명"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-ink-muted">직함</div>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="(선택) 대표 / 매니저 등"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-ink-muted">
            플랜 / quota / 자동검증 슬롯은 본 화면에서 변경할 수 없습니다.
            플랜 변경은 결제 후 자동 적용됩니다.
          </div>

          {errMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {errMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
            >
              취소
            </button>
            <button
              onClick={() => {
                setErrMsg('')
                mutation.mutate()
              }}
              disabled={mutation.isPending}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {mutation.isPending ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
