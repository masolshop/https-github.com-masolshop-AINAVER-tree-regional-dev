/**
 * 인증 API — /api/v1/auth/*
 */
import { api } from './client'
import type {
  GoogleLoginRequest,
  GoogleLoginResponse,
  MeResponse,
  MessageResponse,
  ProfileCompleteRequest,
  PasswordLoginRequest,
  PasswordLoginResponse,
} from './types'

export const authApi = {
  /** Google ID 토큰 → 우리 JWT 발급 + User 생성/조회 */
  loginWithGoogle: (body: GoogleLoginRequest) =>
    api.post<GoogleLoginResponse>('/api/v1/auth/google', body),

  /** 이메일 + 비밀번호 로그인 (어드민/직접가입 사용자) */
  loginWithPassword: (body: PasswordLoginRequest) =>
    api.post<PasswordLoginResponse>('/api/v1/auth/login', body),

  /** 신규 가입자 추가정보 + 약관 동의 저장 */
  completeProfile: (body: ProfileCompleteRequest) =>
    api.post<MeResponse>('/api/v1/auth/profile', body),

  /** 현재 로그인 사용자 정보 (앱 시작 시 토큰 유효성 검증용) */
  me: () =>
    api.get<MeResponse>('/api/v1/auth/me', { skipUnauthorizedHandler: true }),

  logout: () => api.post<MessageResponse>('/api/v1/auth/logout'),
}
