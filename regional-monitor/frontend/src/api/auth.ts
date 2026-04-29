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
  SignupRequest,
  SignupResponse,
  CheckDuplicateRequest,
  CheckDuplicateResponse,
  ForgotIdRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResetPasswordVerifyResponse,
  VerifySlotUpdateRequest,
  VerifySlotUpdateResponse,
  MyProfileUpdateRequest,
  MyProfileUpdateResponse,
} from './types'

export const authApi = {
  /** Google ID 토큰 → 우리 JWT 발급 + User 생성/조회 */
  loginWithGoogle: (body: GoogleLoginRequest) =>
    api.post<GoogleLoginResponse>('/api/v1/auth/google', body),

  /** 이메일/아이디 + 비밀번호 로그인 (어드민/직접가입 사용자) */
  loginWithPassword: (body: PasswordLoginRequest) =>
    api.post<PasswordLoginResponse>('/api/v1/auth/login', body),

  /** 직접 회원가입 (아이디/비밀번호) */
  signup: (body: SignupRequest) =>
    api.post<SignupResponse>('/api/v1/auth/signup', body),

  /** 가입 전 휴대폰/이메일 중복 확인 */
  checkDuplicate: (body: CheckDuplicateRequest) =>
    api.post<CheckDuplicateResponse>('/api/v1/auth/check-duplicate', body),

  /** 신규 가입자 추가정보 + 약관 동의 저장 */
  completeProfile: (body: ProfileCompleteRequest) =>
    api.post<MeResponse>('/api/v1/auth/profile', body),

  /** 현재 로그인 사용자 정보 (앱 시작 시 토큰 유효성 검증용) */
  me: () =>
    api.get<MeResponse>('/api/v1/auth/me', { skipUnauthorizedHandler: true }),

  logout: () => api.post<MessageResponse>('/api/v1/auth/logout'),

  /** 아이디 찾기 — 가입 이메일로 username 발송 */
  forgotId: (body: ForgotIdRequest) =>
    api.post<MessageResponse>('/api/v1/auth/forgot-id', body),

  /** 비밀번호 재설정 링크 발송 */
  forgotPassword: (body: ForgotPasswordRequest) =>
    api.post<MessageResponse>('/api/v1/auth/forgot-password', body),

  /** 재설정 토큰 사전 유효성 확인 */
  verifyResetToken: (token: string) =>
    api.get<ResetPasswordVerifyResponse>(
      `/api/v1/auth/reset-password/verify?token=${encodeURIComponent(token)}`,
      { skipUnauthorizedHandler: true },
    ),

  /** 비밀번호 재설정 실행 */
  resetPassword: (body: ResetPasswordRequest) =>
    api.post<MessageResponse>('/api/v1/auth/reset-password', body),

  /** 내 자동 검증 시각(0~23시) 변경 */
  updateVerifySlot: (body: VerifySlotUpdateRequest) =>
    api.patch<VerifySlotUpdateResponse>('/api/v1/auth/me/verify-slot', body),

  /** 본인 프로필 수정 — 이름/이메일/회사명/직함 */
  updateMyProfile: (body: MyProfileUpdateRequest) =>
    api.patch<MyProfileUpdateResponse>('/api/v1/auth/me', body),

  /** 회원 탈퇴 — 본인 계정 + 모든 데이터 영구 삭제 */
  deleteMyAccount: () => api.del<MessageResponse>('/api/v1/auth/me'),
}
