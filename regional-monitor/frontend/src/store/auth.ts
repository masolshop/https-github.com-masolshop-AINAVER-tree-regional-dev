/**
 * 인증 상태 (Zustand)
 * - 로그인 / 로그아웃 / 사용자 정보 / 로그인 모달 트리거
 * - 추후 Google OAuth 연동 시 setUser 호출
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
  plan: 'FREE' | 'BASIC' | 'PRO'
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  // 로그인 모달
  loginModalOpen: boolean
  // 로그인이 필요한 페이지로 이동하려고 했을 때 저장
  redirectAfterLogin: string | null

  // Actions
  setUser: (user: User | null) => void
  logout: () => void
  openLoginModal: (redirectTo?: string | null) => void
  closeLoginModal: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      loginModalOpen: false,
      redirectAfterLogin: null,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
          loginModalOpen: false,
        }),

      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
        }),

      openLoginModal: (redirectTo = null) =>
        set({
          loginModalOpen: true,
          redirectAfterLogin: redirectTo,
        }),

      closeLoginModal: () =>
        set({
          loginModalOpen: false,
        }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
