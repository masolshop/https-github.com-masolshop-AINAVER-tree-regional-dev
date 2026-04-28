/**
 * 비밀번호 재설정 페이지 — /reset-password?token=…
 *
 * 흐름:
 *   1) URL의 token 파라미터를 GET /auth/reset-password/verify 로 사전 검증
 *      · 유효하면 마스킹된 이메일 표시 + 새 비밀번호 입력 폼
 *      · 만료/무효면 안내 + 비밀번호 찾기 화면으로 복귀 안내
 *   2) POST /auth/reset-password { token, new_password } 로 재설정
 *   3) 성공 시 로그인 모달 자동 노출 + / 로 이동
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Lock, CheckCircle2, AlertCircle, Loader2, ArrowRight, ShieldCheck } from 'lucide-react'

import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth'
import { useResetPassword } from '@/hooks/useAuth'
import { ApiError } from '@/api/client'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const openLoginModal = useAuthStore((s) => s.openLoginModal)
  const openForgotPasswordModal = useAuthStore((s) => s.openForgotPasswordModal)
  const resetPassword = useResetPassword()

  const verifyQuery = useQuery({
    queryKey: ['reset-password-verify', token],
    queryFn: () => authApi.verifyResetToken(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: 30_000,
  })

  const tokenValid = !!verifyQuery.data?.valid
  const emailMasked = verifyQuery.data?.email_masked

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  const passwordOk = password.length >= 8
  const password2Ok = password === password2 && password2.length > 0

  const canSubmit = useMemo(
    () => tokenValid && passwordOk && password2Ok && !resetPassword.isPending && !doneMsg,
    [tokenValid, passwordOk, password2Ok, resetPassword.isPending, doneMsg],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!passwordOk) {
      setErrorMsg('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (!password2Ok) {
      setErrorMsg('비밀번호가 일치하지 않습니다.')
      return
    }
    resetPassword.mutate(
      { token, new_password: password },
      {
        onSuccess: (res) => setDoneMsg(res.message),
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '비밀번호 변경 실패')
        },
      },
    )
  }

  // 변경 성공 후 자동 로그인 모달 열기 (3초)
  useEffect(() => {
    if (!doneMsg) return
    const t = setTimeout(() => {
      navigate('/')
      openLoginModal()
    }, 3000)
    return () => clearTimeout(t)
  }, [doneMsg, navigate, openLoginModal])

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-bg-subtle">
      <div className="w-full max-w-md bg-white rounded-card-lg shadow-card p-8">
        <div className="text-center mb-6">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-brand-500 items-center justify-center mb-4 shadow-card">
            <ShieldCheck className="text-white" size={24} />
          </div>
          <h1 className="text-h2 text-ink mb-1">비밀번호 재설정</h1>
          <p className="text-body-sm text-ink-muted">
            새 비밀번호를 설정해주세요
          </p>
        </div>

        {/* 토큰 검증 중 */}
        {verifyQuery.isPending && (
          <div className="py-10 text-center text-ink-muted">
            <Loader2 className="animate-spin mx-auto mb-2" size={24} />
            <p className="text-body-sm">링크 확인 중…</p>
          </div>
        )}

        {/* 토큰 무효 / 만료 */}
        {(verifyQuery.isError || (verifyQuery.data && !verifyQuery.data.valid)) && (
          <div className="space-y-4">
            <div className="px-4 py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-body-sm font-semibold">유효하지 않거나 만료된 링크입니다.</p>
                <p className="text-caption mt-1">
                  보안을 위해 비밀번호 재설정 링크는 1시간 동안만 유효합니다. 다시 요청해주세요.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                navigate('/')
                openForgotPasswordModal()
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors"
            >
              비밀번호 찾기 다시 시도 <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* 토큰 유효 → 입력 폼 */}
        {tokenValid && !doneMsg && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {emailMasked && (
              <div className="px-3 py-2.5 rounded-xl bg-bg-subtle text-caption text-ink-muted flex items-center gap-2">
                계정 이메일: <span className="font-semibold text-ink">{emailMasked}</span>
              </div>
            )}

            <div>
              <label className="flex items-center gap-1.5 text-caption font-semibold text-ink mb-1.5">
                <Lock size={14} className="text-ink-muted" /> 새 비밀번호
                <span className="text-red-500">*</span>
                <span className="text-ink-muted font-normal">· 8자 이상</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
                className="rm-field-input"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-caption font-semibold text-ink mb-1.5">
                <Lock size={14} className="text-ink-muted" /> 새 비밀번호 확인
                <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="rm-field-input"
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
            >
              {resetPassword.isPending ? (
                <><Loader2 className="animate-spin" size={16} /> 변경 중…</>
              ) : (
                <>비밀번호 변경</>
              )}
            </button>

            {errorMsg && (
              <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </form>
        )}

        {/* 변경 성공 */}
        {doneMsg && (
          <div className="space-y-4">
            <div className="px-4 py-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-body-sm font-semibold">{doneMsg}</p>
                <p className="text-caption mt-1">잠시 후 로그인 화면으로 이동합니다.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { navigate('/'); openLoginModal() }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors"
            >
              로그인하러 가기 <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
