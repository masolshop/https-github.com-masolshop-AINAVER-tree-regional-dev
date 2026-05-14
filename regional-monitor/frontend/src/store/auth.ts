/**
 * 인증 스토어 (Zustand + persist)
 *
 * 보관 항목:
 *  - accessToken : 우리 서비스 JWT (/api/v1/auth/google 응답)
 *  - user        : 사용자 정보 (이름/회사/플랜/프로필 완성 여부)
 *  - loginModal  : 로그인 / 가입 추가정보 / 약관 동의 UI 상태
 *
 * 외부 흐름:
 *  1) <App /> 마운트 시 client.configureAuth({ getToken, onUnauthorized }) 호출
 *  2) 토큰이 있으면 authApi.me() 로 검증 → user 갱신 또는 logout
 *  3) Google 로그인 콜백 → authApi.loginWithGoogle(id_token) → setSession(...)
 *  4) needs_profile=true 면 modalStep='profile' 로 추가정보 모달 노출
 *  5) authApi.completeProfile() 성공 시 closeLoginModal()
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { User } from '@/api/types'

/** 로그인 모달의 단계 */
export type LoginModalStep =
  | 'login'         // 로그인 화면 (아이디/비번 또는 Google)
  | 'signup'        // 직접 회원가입 (아이디/비번 + 이메일/이름/회사/휴대폰)
  | 'forgot-id'     // 아이디 찾기 (이메일 입력)
  | 'forgot-pw'     // 비밀번호 찾기 (아이디/이메일 입력)
  | 'profile'       // Google 로그인 후 추가정보 입력 (구 흐름)
  | 'closed'

interface AuthState {
  /* persist 대상 */
  accessToken: string | null
  user: User | null

  /* 메모리 전용 */
  isAuthenticated: boolean        // = !!user && user.is_profile_complete
  /** 외부 공개 데모 게스트 세션 여부 — user.is_demo === true 일 때만 활성 */
  isDemo: boolean
  modalStep: LoginModalStep
  redirectAfterLogin: string | null

  /* Actions */
  setSession: (token: string, user: User) => void
  setUser: (user: User) => void
  logout: () => void

  openLoginModal: (redirectTo?: string | null) => void
  openProfileModal: () => void
  openSignupModal: () => void
  openForgotIdModal: () => void
  openForgotPasswordModal: () => void
  setModalStep: (step: LoginModalStep) => void
  closeLoginModal: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isDemo: false,
      modalStep: 'closed',
      redirectAfterLogin: null,

      setSession: (token, user) =>
        set({
          accessToken: token,
          user,
          isAuthenticated: user.is_profile_complete,
          isDemo: !!user.is_demo,
          // 신규 가입자(프로필 미완성)는 추가정보 모달, 그 외는 닫기
          // 데모 게스트는 절대 추가정보 모달 띄우지 않음
          modalStep:
            user.is_demo || user.is_profile_complete ? 'closed' : 'profile',
        }),

      setUser: (user) =>
        set((state) => ({
          user,
          isAuthenticated: !!state.accessToken && user.is_profile_complete,
          isDemo: !!user.is_demo,
          modalStep:
            user.is_demo || user.is_profile_complete
              ? 'closed'
              : state.modalStep,
        })),

      logout: () =>
        set({
          accessToken: null,
          user: null,
          isAuthenticated: false,
          isDemo: false,
          modalStep: 'closed',
          redirectAfterLogin: null,
        }),

      openLoginModal: (redirectTo = null) =>
        set({ modalStep: 'login', redirectAfterLogin: redirectTo }),

      openProfileModal: () => set({ modalStep: 'profile' }),
      openSignupModal: () => set({ modalStep: 'signup' }),
      openForgotIdModal: () => set({ modalStep: 'forgot-id' }),
      openForgotPasswordModal: () => set({ modalStep: 'forgot-pw' }),
      setModalStep: (step) => set({ modalStep: step }),

      closeLoginModal: () => set({ modalStep: 'closed' }),
    }),
    {
      name: 'rm-auth-v2',
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
      }),
      // localStorage → 메모리로 hydrate 시 isAuthenticated/isDemo 재계산
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.isAuthenticated =
          !!state.accessToken && !!state.user && state.user.is_profile_complete
        state.isDemo = !!state.user?.is_demo
      },
    },
  ),
)
