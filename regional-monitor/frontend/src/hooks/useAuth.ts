/**
 * 인증 React Query 훅
 *
 *  - useGoogleLogin()    : id_token 받아서 로그인 (mutation)
 *  - useCompleteProfile(): 추가정보 + 동의 저장 (mutation)
 *  - useMe()             : 토큰 유효성 검증 + user 동기화 (query, enabled=토큰 존재)
 *  - useLogout()         : 서버 통지 + store.logout()
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth'
import type {
  PasswordLoginRequest,
  ProfileCompleteRequest,
  SignupRequest,
  ForgotIdRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@/api/types'

export const authKeys = {
  me: ['auth', 'me'] as const,
}

export function useGoogleLogin() {
  const setSession = useAuthStore((s) => s.setSession)
  return useMutation({
    mutationFn: (idToken: string) => authApi.loginWithGoogle({ id_token: idToken }),
    onSuccess: (data) => {
      setSession(data.access_token, data.user)
    },
  })
}

/** 어드민/직접가입 사용자용 — 아이디(또는 이메일)+비밀번호 로그인 */
export function usePasswordLogin() {
  const setSession = useAuthStore((s) => s.setSession)
  return useMutation({
    mutationFn: (body: PasswordLoginRequest) => authApi.loginWithPassword(body),
    onSuccess: (data) => {
      setSession(data.access_token, data.user)
    },
  })
}

/** 직접 회원가입 (아이디/비밀번호 + 이메일/이름/회사/휴대폰) */
export function useSignup() {
  const setSession = useAuthStore((s) => s.setSession)
  return useMutation({
    mutationFn: (body: SignupRequest) => authApi.signup(body),
    onSuccess: (data) => {
      setSession(data.access_token, data.user)
    },
  })
}

/** 아이디 찾기 (이메일 발송) */
export function useForgotId() {
  return useMutation({
    mutationFn: (body: ForgotIdRequest) => authApi.forgotId(body),
  })
}

/** 비밀번호 재설정 링크 발송 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) => authApi.forgotPassword(body),
  })
}

/** 비밀번호 재설정 실행 */
export function useResetPassword() {
  return useMutation({
    mutationFn: (body: ResetPasswordRequest) => authApi.resetPassword(body),
  })
}

export function useCompleteProfile() {
  const setUser = useAuthStore((s) => s.setUser)
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal)
  return useMutation({
    mutationFn: (body: ProfileCompleteRequest) => authApi.completeProfile(body),
    onSuccess: (data) => {
      setUser(data.user)
      closeLoginModal()
    },
  })
}

/** 토큰이 있으면 백그라운드로 /me 호출 → 만료/무효면 로그아웃 */
export function useMe() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)

  const query = useQuery({
    queryKey: authKeys.me,
    queryFn: authApi.me,
    enabled: !!accessToken,
    staleTime: 60_000,
    retry: false,
  })

  // 성공/실패 시 스토어 동기화
  useEffect(() => {
    if (query.data) setUser(query.data.user)
  }, [query.data, setUser])

  useEffect(() => {
    if (query.isError) {
      // 토큰이 만료/무효 → 로그아웃
      logout()
    }
  }, [query.isError, logout])

  return query
}

export function useLogout() {
  const qc = useQueryClient()
  const logout = useAuthStore((s) => s.logout)
  return useMutation({
    mutationFn: async () => {
      try {
        await authApi.logout()
      } catch {
        // 토큰이 이미 무효라도 클라이언트 측 로그아웃은 진행
      }
    },
    onSettled: () => {
      logout()
      qc.clear()
    },
  })
}
