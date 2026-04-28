/**
 * 로그인 / 회원가입 / 아이디·비밀번호 찾기 / Google 추가정보 모달
 *
 * 모달 단계 (store/auth.ts 의 LoginModalStep):
 *   - 'login'      : 로그인 화면 (아이디/비번 또는 Google)
 *   - 'signup'     : 직접 회원가입 (아이디/비번 + 이메일/이름/회사/휴대폰)
 *   - 'forgot-id'  : 아이디 찾기 (이메일 입력)
 *   - 'forgot-pw'  : 비밀번호 재설정 링크 발송 (아이디/이메일 입력)
 *   - 'profile'    : Google 로그인 후 추가정보 입력 (구 흐름 — 호환 유지)
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X,
  ShieldCheck,
  User as UserIcon,
  Phone,
  Building2,
  BriefcaseBusiness,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Mail,
  KeyRound,
  ArrowLeft,
  Lock,
  AtSign,
  Send,
} from 'lucide-react'

import { useAuthStore } from '@/store/auth'
import {
  useGoogleLogin,
  useCompleteProfile,
  usePasswordLogin,
  useSignup,
  useForgotId,
  useForgotPassword,
} from '@/hooks/useAuth'
import { ApiError } from '@/api/client'

/* ─────────────── Google Identity Services 타입 (간이) ─────────────── */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            ux_mode?: 'popup' | 'redirect'
            auto_select?: boolean
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black'
              size?: 'small' | 'medium' | 'large'
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
              shape?: 'rectangular' | 'pill' | 'circle' | 'square'
              width?: number
              locale?: string
            },
          ) => void
          prompt: () => void
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const IS_DEV_MOCK = GOOGLE_CLIENT_ID.trim().length === 0

/** 개발용 페이크 Google ID 토큰 생성 */
function makeDevIdToken(email: string, name: string): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'fake-dev' }
  const payload = {
    iss: 'https://accounts.google.com',
    sub: `dev-${btoa(email).replace(/=/g, '')}`,
    email,
    email_verified: true,
    name,
    picture: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
    aud: 'dev-fake-client-id',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const b64 = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64(header)}.${b64(payload)}.dev-fake-signature`
}

/** 010-XXXX-XXXX 자동 포맷 */
function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11)
  if (digits.length < 4) return digits
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

const PHONE_REGEX = /^010-\d{4}-\d{4}$/
const USERNAME_REGEX = /^[A-Za-z0-9_.]{4,30}$/

/* ═══════════════════════════════════════════════════════════════════
 *   메인 모달
 * ═══════════════════════════════════════════════════════════════════ */
export function LoginModal() {
  const modalStep = useAuthStore((s) => s.modalStep)
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal)

  // ESC 닫기 (profile 단계 외에는 모두 가능)
  useEffect(() => {
    if (modalStep === 'closed' || modalStep === 'profile') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLoginModal()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [modalStep, closeLoginModal])

  if (modalStep === 'closed') return null

  // signup/forgot 등은 외부 클릭으로 닫을 수 있음. profile 만 강제.
  const dismissable = modalStep !== 'profile'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-950/40 backdrop-blur-sm"
      onClick={dismissable ? closeLoginModal : undefined}
    >
      <div
        className="w-full max-w-md bg-white rounded-card-lg shadow-card-hover p-8 relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {modalStep === 'login' && <LoginStep />}
        {modalStep === 'signup' && <SignupStep />}
        {modalStep === 'forgot-id' && <ForgotIdStep />}
        {modalStep === 'forgot-pw' && <ForgotPasswordStep />}
        {modalStep === 'profile' && <ProfileStep />}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   공통 헤더 / 닫기 버튼
 * ═══════════════════════════════════════════════════════════════════ */
function CloseButton() {
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal)
  return (
    <button
      aria-label="닫기"
      onClick={closeLoginModal}
      className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-bg-subtle flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
    >
      <X size={18} />
    </button>
  )
}

function ModalHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="text-center mb-6">
      <div className="inline-flex w-12 h-12 rounded-2xl bg-brand-500 items-center justify-center mb-4 shadow-card">
        {icon}
      </div>
      <h2 className="text-h2 text-ink mb-2">{title}</h2>
      <p className="text-body-sm text-ink-muted">{subtitle}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Step: 로그인
 * ═══════════════════════════════════════════════════════════════════ */
function LoginStep() {
  const setModalStep = useAuthStore((s) => s.setModalStep)
  const googleLogin = useGoogleLogin()
  const passwordLogin = usePasswordLogin()
  const gButtonRef = useRef<HTMLDivElement>(null)
  const [scriptReady, setScriptReady] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 기본 탭: 아이디/비밀번호 로그인 (직접 가입 사용자 우선)
  const [tab, setTab] = useState<'password' | 'google'>('password')
  const [pwIdent, setPwIdent] = useState('')
  const [pwPassword, setPwPassword] = useState('')

  // GIS 스크립트 로드
  useEffect(() => {
    if (IS_DEV_MOCK) return
    if (window.google?.accounts?.id) {
      setScriptReady(true)
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    )
    if (existing) {
      existing.addEventListener('load', () => setScriptReady(true))
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => setScriptReady(true)
    document.head.appendChild(s)
  }, [])

  // GIS 버튼 렌더 (Google 탭일 때만)
  useEffect(() => {
    if (IS_DEV_MOCK) return
    if (tab !== 'google') return
    if (!scriptReady || !gButtonRef.current || !window.google) return

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        setErrorMsg(null)
        googleLogin.mutate(response.credential, {
          onError: (err) => {
            const msg = err instanceof ApiError ? err.message : (err as Error).message
            setErrorMsg(`로그인 실패: ${msg}`)
          },
        })
      },
      ux_mode: 'popup',
      auto_select: false,
    })
    window.google.accounts.id.renderButton(gButtonRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: 360,
      locale: 'ko',
    })
  }, [scriptReady, googleLogin, tab])

  const handleDevMockLogin = () => {
    setErrorMsg(null)
    const email = `dev-${Date.now()}@regionwatch-dev.example.com`
    const name = '테스트 사용자'
    const idToken = makeDevIdToken(email, name)
    googleLogin.mutate(idToken, {
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : (err as Error).message
        setErrorMsg(`로그인 실패: ${msg}`)
      },
    })
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!pwIdent.trim() || !pwPassword) {
      setErrorMsg('아이디(또는 이메일)와 비밀번호를 입력해주세요.')
      return
    }
    passwordLogin.mutate(
      { email: pwIdent.trim(), password: pwPassword },
      {
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '로그인 실패')
        },
      },
    )
  }

  return (
    <>
      <CloseButton />
      <ModalHeader
        icon={<ShieldCheck className="text-white" size={24} />}
        title="타지역서비스 로그인"
        subtitle={
          tab === 'password' ? '아이디 또는 이메일로 로그인' : 'Google 계정으로 1초 로그인'
        }
      />

      {/* 탭 */}
      <div className="flex gap-1 p-1 bg-bg-subtle rounded-xl mb-5">
        <button
          type="button"
          onClick={() => {
            setTab('password')
            setErrorMsg(null)
          }}
          className={`flex-1 py-2 rounded-lg text-caption font-semibold transition-colors ${
            tab === 'password' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          아이디 로그인
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('google')
            setErrorMsg(null)
          }}
          className={`flex-1 py-2 rounded-lg text-caption font-semibold transition-colors ${
            tab === 'google' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          Google 로그인
        </button>
      </div>

      {tab === 'password' && (
        <form onSubmit={handlePasswordSubmit} className="space-y-3.5">
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">
              아이디 또는 이메일
            </label>
            <input
              type="text"
              value={pwIdent}
              onChange={(e) => setPwIdent(e.target.value)}
              placeholder="masol_shop 또는 you@email.com"
              autoComplete="username"
              autoFocus
              className="rm-field-input"
            />
          </div>
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">비밀번호</label>
            <input
              type="password"
              value={pwPassword}
              onChange={(e) => setPwPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="rm-field-input"
            />
          </div>
          <button
            type="submit"
            disabled={passwordLogin.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
          >
            {passwordLogin.isPending ? (
              <>
                <Loader2 className="animate-spin" size={16} /> 로그인 중…
              </>
            ) : (
              <>로그인</>
            )}
          </button>

          {/* 회원가입 / 찾기 링크 */}
          <div className="flex items-center justify-between pt-1 text-caption">
            <button
              type="button"
              onClick={() => setModalStep('signup')}
              className="text-brand-600 hover:text-brand-700 font-semibold"
            >
              회원가입
            </button>
            <div className="flex items-center gap-3 text-ink-muted">
              <button
                type="button"
                onClick={() => setModalStep('forgot-id')}
                className="hover:text-ink"
              >
                아이디 찾기
              </button>
              <span className="text-bg-subtle">·</span>
              <button
                type="button"
                onClick={() => setModalStep('forgot-pw')}
                className="hover:text-ink"
              >
                비밀번호 찾기
              </button>
            </div>
          </div>
        </form>
      )}

      {tab === 'google' && (
        <>
          {IS_DEV_MOCK ? (
            <button
              onClick={handleDevMockLogin}
              disabled={googleLogin.isPending}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl bg-white border-2 border-bg-subtle hover:border-brand-200 hover:bg-bg-subtle disabled:opacity-60 disabled:cursor-wait transition-all font-semibold text-ink"
            >
              {googleLogin.isPending ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              Google 계정으로 계속하기
            </button>
          ) : (
            <div className="flex flex-col items-center">
              <div ref={gButtonRef} className="min-h-[44px]" />
              {!scriptReady && (
                <div className="text-caption text-ink-muted mt-2 flex items-center gap-1.5">
                  <Loader2 className="animate-spin" size={14} /> Google 로그인 준비 중…
                </div>
              )}
              {googleLogin.isPending && (
                <div className="text-caption text-brand-600 mt-2 flex items-center gap-1.5">
                  <Loader2 className="animate-spin" size={14} /> 인증 처리 중…
                </div>
              )}
            </div>
          )}

          <div className="mt-6 text-center text-caption text-ink-muted leading-relaxed">
            처음 로그인 시 <span className="text-ink font-medium">개인정보 수집·이용 동의</span>와<br />
            <span className="text-ink font-medium">서비스 이용약관</span> 동의를 받습니다.
          </div>

          {IS_DEV_MOCK && (
            <div className="mt-5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-caption text-amber-800 text-center">
              ⚠️ 개발 모드 — VITE_GOOGLE_CLIENT_ID 미설정 (페이크 ID 토큰 사용)
            </div>
          )}
        </>
      )}

      {/* 에러 */}
      {errorMsg && (
        <div className="mt-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Step: 직접 회원가입
 * ═══════════════════════════════════════════════════════════════════ */
function SignupStep() {
  const setModalStep = useAuthStore((s) => s.setModalStep)
  const redirectAfterLogin = useAuthStore((s) => s.redirectAfterLogin)
  const navigate = useNavigate()
  const signup = useSignup()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')

  const [agPrivacy, setAgPrivacy] = useState(false)
  const [agTerms, setAgTerms] = useState(false)
  const [agMarketing, setAgMarketing] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const usernameOk = USERNAME_REGEX.test(username)
  const passwordOk = password.length >= 8
  const passwordMatch = password === passwordConfirm && passwordConfirm.length > 0
  const emailOk = /.+@.+\..+/.test(email)
  const nameOk = name.trim().length >= 1
  const phoneOk = PHONE_REGEX.test(phone.trim())
  const companyOk = company.trim().length >= 1
  const requiredAgreementsOk = agPrivacy && agTerms
  const formValid =
    usernameOk &&
    passwordOk &&
    passwordMatch &&
    emailOk &&
    nameOk &&
    phoneOk &&
    companyOk &&
    requiredAgreementsOk

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setErrorMsg(null)
    if (!formValid) return

    signup.mutate(
      {
        username: username.trim(),
        password,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        company: company.trim(),
        job_title: jobTitle.trim() || null,
        agreements: {
          privacy: agPrivacy,
          terms: agTerms,
          marketing: agMarketing,
        },
      },
      {
        onSuccess: () => {
          if (redirectAfterLogin) navigate(redirectAfterLogin)
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '가입 실패')
        },
      },
    )
  }

  const allChecked = agPrivacy && agTerms && agMarketing
  const toggleAll = () => {
    const next = !allChecked
    setAgPrivacy(next)
    setAgTerms(next)
    setAgMarketing(next)
  }

  return (
    <>
      <CloseButton />
      <button
        onClick={() => setModalStep('login')}
        className="absolute top-4 left-4 w-9 h-9 rounded-full hover:bg-bg-subtle flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
        aria-label="로그인으로"
      >
        <ArrowLeft size={18} />
      </button>

      <ModalHeader
        icon={<UserIcon className="text-white" size={24} />}
        title="회원가입"
        subtitle="아이디·이메일·휴대폰으로 1분 안에 시작"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 아이디 */}
        <FieldRow
          icon={<AtSign size={14} />}
          label="아이디"
          required
          hint="4~30자 영문/숫자/_/."
          error={
            submitted && !usernameOk
              ? '아이디는 4~30자, 영문/숫자/_/. 만 사용할 수 있습니다'
              : null
          }
        >
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
            placeholder="masol_shop"
            autoComplete="username"
            autoFocus
            className="rm-field-input"
          />
        </FieldRow>

        {/* 비밀번호 */}
        <FieldRow
          icon={<Lock size={14} />}
          label="비밀번호"
          required
          hint="8자 이상"
          error={submitted && !passwordOk ? '비밀번호는 8자 이상 입력해주세요' : null}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 비밀번호 확인 */}
        <FieldRow
          icon={<Lock size={14} />}
          label="비밀번호 확인"
          required
          error={submitted && !passwordMatch ? '비밀번호가 일치하지 않습니다' : null}
        >
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 이메일 */}
        <FieldRow
          icon={<Mail size={14} />}
          label="이메일"
          required
          hint="아이디·비번 찾기에 사용"
          error={submitted && !emailOk ? '이메일 형식이 올바르지 않습니다' : null}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 이름 */}
        <FieldRow
          icon={<UserIcon size={14} />}
          label="이름"
          required
          error={submitted && !nameOk ? '이름을 입력해주세요' : null}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            autoComplete="name"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 휴대폰 */}
        <FieldRow
          icon={<Phone size={14} />}
          label="휴대폰 번호"
          required
          error={submitted && !phoneOk ? '010-0000-0000 형식으로 입력해주세요' : null}
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="010-0000-0000"
            inputMode="numeric"
            maxLength={13}
            autoComplete="tel"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 회사명 */}
        <FieldRow
          icon={<Building2 size={14} />}
          label="회사명"
          required
          error={submitted && !companyOk ? '회사명을 입력해주세요' : null}
        >
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="(주)마솔샵"
            autoComplete="organization"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 직책 */}
        <FieldRow icon={<BriefcaseBusiness size={14} />} label="직책" hint="선택사항">
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="대표 / 마케터 / 점주 등"
            autoComplete="organization-title"
            className="rm-field-input"
          />
        </FieldRow>

        {/* 약관 동의 */}
        <div className="!mt-6 pt-5 border-t border-bg-subtle">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-body font-semibold text-ink">약관 동의</h3>
            <button
              type="button"
              onClick={toggleAll}
              className="text-caption font-medium text-brand-600 hover:text-brand-700"
            >
              {allChecked ? '전체 해제' : '전체 동의'}
            </button>
          </div>
          <div className="space-y-2.5">
            <ConsentRow
              required
              checked={agPrivacy}
              onChange={setAgPrivacy}
              label="개인정보 수집 및 이용 동의"
              detail="수집항목: 이메일, 이름, 휴대폰, 회사명, 직책, 아이디 · 목적: 서비스 제공 / 본인 확인 · 보유: 회원 탈퇴 시까지"
            />
            <ConsentRow
              required
              checked={agTerms}
              onChange={setAgTerms}
              label="서비스 이용약관 동의"
              detail="타지역서비스 네이버 실시간 노출 관리 솔루션 이용에 관한 권리·의무·책임 사항"
            />
            <ConsentRow
              required={false}
              checked={agMarketing}
              onChange={setAgMarketing}
              label="마케팅 정보 수신 동의"
              detail="신규 기능, 이벤트, 프로모션 안내 (이메일/SMS) · 거부 시에도 서비스 이용 가능"
            />
          </div>
          {submitted && !requiredAgreementsOk && (
            <div className="mt-3 text-caption text-red-600 flex items-center gap-1.5">
              <AlertCircle size={12} /> 필수 약관에 동의해주세요
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={signup.isPending}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
        >
          {signup.isPending ? (
            <>
              <Loader2 className="animate-spin" size={18} /> 가입 중…
            </>
          ) : (
            <>
              <CheckCircle2 size={18} /> 회원가입
            </>
          )}
        </button>
        <p className="text-center text-caption text-ink-muted">
          이미 계정이 있으세요?{' '}
          <button
            type="button"
            onClick={() => setModalStep('login')}
            className="text-brand-600 hover:text-brand-700 font-semibold"
          >
            로그인하기
          </button>
        </p>
      </form>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Step: 아이디 찾기 (이메일 입력)
 * ═══════════════════════════════════════════════════════════════════ */
function ForgotIdStep() {
  const setModalStep = useAuthStore((s) => s.setModalStep)
  const forgotId = useForgotId()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const emailOk = /.+@.+\..+/.test(email)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setErrorMsg(null)
    if (!emailOk) return
    forgotId.mutate(
      { email: email.trim() },
      {
        onSuccess: () => setDone(true),
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '요청 실패')
        },
      },
    )
  }

  return (
    <>
      <CloseButton />
      <button
        onClick={() => setModalStep('login')}
        className="absolute top-4 left-4 w-9 h-9 rounded-full hover:bg-bg-subtle flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
        aria-label="로그인으로"
      >
        <ArrowLeft size={18} />
      </button>
      <ModalHeader
        icon={<Mail className="text-white" size={24} />}
        title="아이디 찾기"
        subtitle="가입 시 등록한 이메일로 아이디를 보내드립니다"
      />

      {done ? (
        <SuccessPanel
          title="아이디 안내 메일을 발송했습니다"
          description={
            <>
              입력하신 이메일로 가입된 계정이 있다면 <b>아이디</b>를 보내드렸습니다.
              <br />
              메일이 보이지 않으면 스팸함도 확인해주세요.
            </>
          }
          onPrimary={() => setModalStep('login')}
          primaryLabel="로그인으로"
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldRow
            icon={<Mail size={14} />}
            label="가입 이메일"
            required
            error={submitted && !emailOk ? '이메일 형식이 올바르지 않습니다' : null}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              autoFocus
              className="rm-field-input"
            />
          </FieldRow>

          {errorMsg && (
            <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={forgotId.isPending}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
          >
            {forgotId.isPending ? (
              <>
                <Loader2 className="animate-spin" size={18} /> 발송 중…
              </>
            ) : (
              <>
                <Send size={18} /> 아이디 안내 메일 받기
              </>
            )}
          </button>

          <div className="text-center text-caption">
            <button
              type="button"
              onClick={() => setModalStep('forgot-pw')}
              className="text-ink-muted hover:text-ink"
            >
              비밀번호도 모르세요? <span className="text-brand-600 font-semibold">비밀번호 찾기</span>
            </button>
          </div>
        </form>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Step: 비밀번호 찾기 (재설정 링크 발송)
 * ═══════════════════════════════════════════════════════════════════ */
function ForgotPasswordStep() {
  const setModalStep = useAuthStore((s) => s.setModalStep)
  const forgotPw = useForgotPassword()
  const [ident, setIdent] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const identOk = ident.trim().length >= 3

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setErrorMsg(null)
    if (!identOk) return

    const value = ident.trim()
    const isEmail = /.+@.+\..+/.test(value)
    forgotPw.mutate(
      isEmail ? { email: value } : { username: value },
      {
        onSuccess: () => setDone(true),
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '요청 실패')
        },
      },
    )
  }

  return (
    <>
      <CloseButton />
      <button
        onClick={() => setModalStep('login')}
        className="absolute top-4 left-4 w-9 h-9 rounded-full hover:bg-bg-subtle flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
        aria-label="로그인으로"
      >
        <ArrowLeft size={18} />
      </button>
      <ModalHeader
        icon={<KeyRound className="text-white" size={24} />}
        title="비밀번호 찾기"
        subtitle="가입 이메일로 재설정 링크(1시간 유효)를 보내드립니다"
      />

      {done ? (
        <SuccessPanel
          title="비밀번호 재설정 메일을 발송했습니다"
          description={
            <>
              입력하신 정보로 가입된 계정이 있다면 등록 이메일로 <b>재설정 링크</b>를 보내드렸습니다.
              <br />
              <span className="text-amber-700 font-semibold">1시간 안에</span> 링크를 눌러 새 비밀번호를 설정해주세요.
            </>
          }
          onPrimary={() => setModalStep('login')}
          primaryLabel="로그인으로"
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FieldRow
            icon={<AtSign size={14} />}
            label="아이디 또는 이메일"
            required
            error={submitted && !identOk ? '아이디 또는 이메일을 입력해주세요' : null}
          >
            <input
              type="text"
              value={ident}
              onChange={(e) => setIdent(e.target.value)}
              placeholder="masol_shop 또는 you@email.com"
              autoComplete="username"
              autoFocus
              className="rm-field-input"
            />
          </FieldRow>

          {errorMsg && (
            <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={forgotPw.isPending}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
          >
            {forgotPw.isPending ? (
              <>
                <Loader2 className="animate-spin" size={18} /> 발송 중…
              </>
            ) : (
              <>
                <Send size={18} /> 재설정 링크 받기
              </>
            )}
          </button>

          <div className="text-center text-caption">
            <button
              type="button"
              onClick={() => setModalStep('forgot-id')}
              className="text-ink-muted hover:text-ink"
            >
              아이디를 모르세요? <span className="text-brand-600 font-semibold">아이디 찾기</span>
            </button>
          </div>
        </form>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════
 *   Step: Google 로그인 후 추가정보 (구 흐름 — 호환 유지)
 * ═══════════════════════════════════════════════════════════════════ */
function ProfileStep() {
  const user = useAuthStore((s) => s.user)
  const redirectAfterLogin = useAuthStore((s) => s.redirectAfterLogin)
  const navigate = useNavigate()
  const completeProfile = useCompleteProfile()

  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [company, setCompany] = useState(user?.company ?? '')
  const [jobTitle, setJobTitle] = useState(user?.job_title ?? '')

  const [agPrivacy, setAgPrivacy] = useState(false)
  const [agTerms, setAgTerms] = useState(false)
  const [agMarketing, setAgMarketing] = useState(false)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const nameOk = name.trim().length >= 1
  const phoneOk = PHONE_REGEX.test(phone.trim())
  const companyOk = company.trim().length >= 1
  const requiredAgreementsOk = agPrivacy && agTerms
  const formValid = nameOk && phoneOk && companyOk && requiredAgreementsOk

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setErrorMsg(null)
    if (!formValid) return

    completeProfile.mutate(
      {
        name: name.trim(),
        phone: phone.trim(),
        company: company.trim(),
        job_title: jobTitle.trim() || null,
        agreements: { privacy: agPrivacy, terms: agTerms, marketing: agMarketing },
      },
      {
        onSuccess: () => {
          if (redirectAfterLogin) navigate(redirectAfterLogin)
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(`저장 실패: ${msg}`)
        },
      },
    )
  }

  const allChecked = agPrivacy && agTerms && agMarketing
  const toggleAll = () => {
    const next = !allChecked
    setAgPrivacy(next)
    setAgTerms(next)
    setAgMarketing(next)
  }

  return (
    <>
      <ModalHeader
        icon={<UserIcon className="text-white" size={24} />}
        title="가입 정보 입력"
        subtitle="서비스 이용을 위해 아래 정보를 확인해주세요"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-caption font-semibold text-ink mb-1.5">이메일</label>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full px-3.5 py-2.5 rounded-xl bg-bg-subtle border border-bg-subtle text-ink-muted text-body-sm cursor-not-allowed"
          />
        </div>

        <FieldRow
          icon={<UserIcon size={14} />}
          label="이름"
          required
          error={submitted && !nameOk ? '이름을 입력해주세요' : null}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="rm-field-input"
            autoFocus
          />
        </FieldRow>

        <FieldRow
          icon={<Phone size={14} />}
          label="휴대폰 번호"
          required
          error={submitted && !phoneOk ? '010-0000-0000 형식으로 입력해주세요' : null}
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="010-0000-0000"
            inputMode="numeric"
            maxLength={13}
            className="rm-field-input"
          />
        </FieldRow>

        <FieldRow
          icon={<Building2 size={14} />}
          label="회사명"
          required
          error={submitted && !companyOk ? '회사명을 입력해주세요' : null}
        >
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="(주)마솔샵"
            className="rm-field-input"
          />
        </FieldRow>

        <FieldRow icon={<BriefcaseBusiness size={14} />} label="직책" hint="선택사항">
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="대표 / 마케터 / 점주 등"
            className="rm-field-input"
          />
        </FieldRow>

        <div className="!mt-6 pt-5 border-t border-bg-subtle">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-body font-semibold text-ink">약관 동의</h3>
            <button
              type="button"
              onClick={toggleAll}
              className="text-caption font-medium text-brand-600 hover:text-brand-700"
            >
              {allChecked ? '전체 해제' : '전체 동의'}
            </button>
          </div>
          <div className="space-y-2.5">
            <ConsentRow
              required
              checked={agPrivacy}
              onChange={setAgPrivacy}
              label="개인정보 수집 및 이용 동의"
              detail="수집항목: 이메일, 이름, 휴대폰, 회사명, 직책 · 목적: 서비스 제공 · 보유기간: 회원 탈퇴 시까지"
            />
            <ConsentRow
              required
              checked={agTerms}
              onChange={setAgTerms}
              label="서비스 이용약관 동의"
              detail="타지역서비스 네이버 실시간 노출 관리 솔루션 이용에 관한 권리·의무·책임 사항"
            />
            <ConsentRow
              required={false}
              checked={agMarketing}
              onChange={setAgMarketing}
              label="마케팅 정보 수신 동의"
              detail="신규 기능, 이벤트, 프로모션 안내 (이메일/SMS) · 거부 시에도 서비스 이용 가능"
            />
          </div>
          {submitted && !requiredAgreementsOk && (
            <div className="mt-3 text-caption text-red-600 flex items-center gap-1.5">
              <AlertCircle size={12} /> 필수 약관에 동의해주세요
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-caption text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={completeProfile.isPending}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
        >
          {completeProfile.isPending ? (
            <>
              <Loader2 className="animate-spin" size={18} /> 저장 중…
            </>
          ) : (
            <>
              <CheckCircle2 size={18} /> 동의하고 가입 완료
            </>
          )}
        </button>

        <p className="text-center text-caption text-ink-muted">
          가입 완료 후에는 마이페이지에서 정보를 수정할 수 있습니다.
        </p>
      </form>
    </>
  )
}

/* ─────────────── 보조 컴포넌트 ─────────────── */

interface FieldRowProps {
  icon: React.ReactNode
  label: string
  required?: boolean
  hint?: string
  error?: string | null
  children: React.ReactNode
}
function FieldRow({ icon, label, required, hint, error, children }: FieldRowProps) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-caption font-semibold text-ink mb-1.5">
        <span className="text-ink-muted">{icon}</span>
        <span>{label}</span>
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-ink-muted font-normal">· {hint}</span>}
      </label>
      {children}
      {error && (
        <div className="mt-1 text-caption text-red-600 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </div>
      )}
    </div>
  )
}

interface ConsentRowProps {
  required: boolean
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  detail: string
}
function ConsentRow({ required, checked, onChange, label, detail }: ConsentRowProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-xl border border-bg-subtle p-3 hover:border-brand-200 transition-colors">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-2 border-ink-muted text-brand-500 focus:ring-brand-300 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-caption font-bold px-1.5 py-0.5 rounded ${
                required ? 'bg-red-50 text-red-600' : 'bg-bg-subtle text-ink-muted'
              }`}
            >
              {required ? '필수' : '선택'}
            </span>
            <span className="text-body-sm font-medium text-ink">{label}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              setExpanded((v) => !v)
            }}
            className="mt-1 text-caption text-brand-600 hover:underline"
          >
            {expanded ? '내용 접기' : '내용 보기'}
          </button>
          {expanded && (
            <p className="mt-1.5 text-caption text-ink-muted leading-relaxed">{detail}</p>
          )}
        </div>
      </label>
    </div>
  )
}

interface SuccessPanelProps {
  title: string
  description: React.ReactNode
  onPrimary: () => void
  primaryLabel: string
}
function SuccessPanel({ title, description, onPrimary, primaryLabel }: SuccessPanelProps) {
  return (
    <div className="text-center py-2">
      <div className="inline-flex w-14 h-14 rounded-full bg-emerald-50 items-center justify-center mb-4">
        <CheckCircle2 className="text-emerald-600" size={28} />
      </div>
      <h3 className="text-body font-bold text-ink mb-2">{title}</h3>
      <p className="text-caption text-ink-muted leading-relaxed mb-6">{description}</p>
      <button
        onClick={onPrimary}
        className="w-full py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors"
      >
        {primaryLabel}
      </button>
    </div>
  )
}
