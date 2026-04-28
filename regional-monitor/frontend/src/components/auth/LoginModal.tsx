/**
 * 로그인 / 회원가입 / 아이디·비밀번호 찾기 모달
 *
 * 모달 단계 (store/auth.ts 의 LoginModalStep):
 *   - 'login'      : 일반 사용자 (휴대폰 + 비밀번호) / 어드민 (이메일 + 비밀번호) 탭 로그인
 *   - 'signup'     : 회원가입 (휴대폰=아이디 + 비밀번호 + 이메일/이름/회사 + 약관)
 *   - 'forgot-id'  : 아이디(=가입 휴대폰번호) 찾기 (가입 이메일 입력 → 이메일로 발송)
 *   - 'forgot-pw'  : 비밀번호 재설정 링크 발송 (휴대폰/이메일/아이디 입력)
 *   - 'profile'    : (legacy) 기존 Google 가입자 추가정보 입력 - UI 트리거 없음, 호환만 유지
 *
 * 핵심 정책 (요구사항 반영):
 *   - Google 로그인 완전 제거 (탭/버튼/스크립트 전부)
 *   - 일반 사용자 ID = 휴대폰 번호 (가입 시 자동으로 username = 숫자만 추출한 휴대폰)
 *   - 어드민 로그인 = 별도 탭, 이메일 + 비밀번호 (슈퍼어드민 / 직원 계정)
 */
import { useEffect, useState } from 'react'
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
  useCompleteProfile,
  usePasswordLogin,
  useSignup,
  useForgotId,
  useForgotPassword,
} from '@/hooks/useAuth'
import { ApiError } from '@/api/client'

/** 010-XXXX-XXXX 자동 포맷 */
function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11)
  if (digits.length < 4) return digits
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

const PHONE_REGEX = /^010-\d{4}-\d{4}$/

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
 *   Step: 로그인 (일반 사용자 = 휴대폰 / 어드민 = 이메일)
 * ═══════════════════════════════════════════════════════════════════ */
function LoginStep() {
  const setModalStep = useAuthStore((s) => s.setModalStep)
  const passwordLogin = usePasswordLogin()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 'user' = 일반 사용자 (휴대폰 + 비밀번호)  /  'admin' = 어드민 (이메일·아이디 + 비밀번호)
  const [tab, setTab] = useState<'user' | 'admin'>('user')

  // 일반 사용자 (휴대폰)
  const [phone, setPhone] = useState('')
  const [phonePassword, setPhonePassword] = useState('')

  // 어드민 (이메일/아이디)
  const [adminIdent, setAdminIdent] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  const handleUserSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    const trimmed = phone.trim()
    if (!trimmed || !phonePassword) {
      setErrorMsg('휴대폰 번호와 비밀번호를 입력해주세요.')
      return
    }
    if (!PHONE_REGEX.test(trimmed)) {
      setErrorMsg('휴대폰 번호 형식이 올바르지 않습니다. 예: 010-0000-0000')
      return
    }
    // 백엔드(/auth/login)는 email 필드에 username/email/phone 모두 허용한다.
    // 가입 시 username 으로 숫자만 추출한 휴대폰번호(예: 01012345678)를 저장하므로 그 값으로 로그인.
    const ident = trimmed.replace(/\D/g, '')
    passwordLogin.mutate(
      { email: ident, password: phonePassword },
      {
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : (err as Error).message
          setErrorMsg(msg || '로그인 실패')
        },
      },
    )
  }

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!adminIdent.trim() || !adminPassword) {
      setErrorMsg('이메일(또는 아이디)과 비밀번호를 입력해주세요.')
      return
    }
    passwordLogin.mutate(
      { email: adminIdent.trim(), password: adminPassword },
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
          tab === 'user' ? '휴대폰 번호로 로그인' : '어드민 계정 (이메일·아이디) 로그인'
        }
      />

      {/* 탭 */}
      <div className="flex gap-1 p-1 bg-bg-subtle rounded-xl mb-5">
        <button
          type="button"
          onClick={() => {
            setTab('user')
            setErrorMsg(null)
          }}
          className={`flex-1 py-2 rounded-lg text-caption font-semibold transition-colors ${
            tab === 'user' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          일반 사용자
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('admin')
            setErrorMsg(null)
          }}
          className={`flex-1 py-2 rounded-lg text-caption font-semibold transition-colors ${
            tab === 'admin' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          }`}
        >
          어드민 로그인
        </button>
      </div>

      {tab === 'user' && (
        <form onSubmit={handleUserSubmit} className="space-y-3.5">
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">
              <Phone size={12} className="inline mr-1 -mt-0.5" /> 휴대폰 번호 (아이디)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="010-0000-0000"
              inputMode="numeric"
              maxLength={13}
              autoComplete="tel"
              autoFocus
              className="rm-field-input"
            />
          </div>
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">
              <Lock size={12} className="inline mr-1 -mt-0.5" /> 비밀번호
            </label>
            <input
              type="password"
              value={phonePassword}
              onChange={(e) => setPhonePassword(e.target.value)}
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

      {tab === 'admin' && (
        <form onSubmit={handleAdminSubmit} className="space-y-3.5">
          <div className="px-3 py-2 mb-1 rounded-xl bg-bg-subtle/60 border border-bg-subtle text-caption text-ink-muted flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-brand-600" />
            <span>슈퍼어드민 / 직원 계정 전용 입구입니다.</span>
          </div>
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">
              <AtSign size={12} className="inline mr-1 -mt-0.5" /> 이메일 또는 아이디
            </label>
            <input
              type="text"
              value={adminIdent}
              onChange={(e) => setAdminIdent(e.target.value)}
              placeholder="admin@taziyuk.com 또는 admin_id"
              autoComplete="username"
              autoFocus
              className="rm-field-input"
            />
          </div>
          <div>
            <label className="block text-caption font-semibold text-ink mb-1.5">
              <Lock size={12} className="inline mr-1 -mt-0.5" /> 비밀번호
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="rm-field-input"
            />
          </div>
          <button
            type="submit"
            disabled={passwordLogin.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-ink hover:bg-ink/90 disabled:opacity-60 disabled:cursor-wait text-white font-semibold transition-colors"
          >
            {passwordLogin.isPending ? (
              <>
                <Loader2 className="animate-spin" size={16} /> 로그인 중…
              </>
            ) : (
              <>
                <ShieldCheck size={16} /> 어드민 로그인
              </>
            )}
          </button>
        </form>
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

  // 휴대폰 번호 = 아이디 (별도 username 입력 없이 휴대폰의 숫자만 추출하여 username 으로 사용)
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

  const passwordOk = password.length >= 8
  const passwordMatch = password === passwordConfirm && passwordConfirm.length > 0
  const emailOk = /.+@.+\..+/.test(email)
  const nameOk = name.trim().length >= 1
  const phoneOk = PHONE_REGEX.test(phone.trim())
  const companyOk = company.trim().length >= 1
  const requiredAgreementsOk = agPrivacy && agTerms
  const formValid =
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

    // 휴대폰 010-1234-5678 → username "01012345678" (숫자 11자리)
    const phoneTrim = phone.trim()
    const username = phoneTrim.replace(/\D/g, '')

    signup.mutate(
      {
        username,
        password,
        email: email.trim(),
        name: name.trim(),
        phone: phoneTrim,
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
        subtitle="휴대폰 번호가 곧 아이디입니다"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 휴대폰 = 아이디 */}
        <FieldRow
          icon={<Phone size={14} />}
          label="휴대폰 번호 (아이디)"
          required
          hint="가입 후 이 번호로 로그인합니다"
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
        subtitle="가입 이메일로 아이디(휴대폰 번호)를 보내드립니다"
      />

      {done ? (
        <SuccessPanel
          title="아이디 안내 메일을 발송했습니다"
          description={
            <>
              입력하신 이메일로 가입된 계정이 있다면 <b>가입 휴대폰 번호(=아이디)</b>를 보내드렸습니다.
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
            icon={<Phone size={14} />}
            label="휴대폰 번호 또는 이메일"
            required
            error={submitted && !identOk ? '휴대폰 번호 또는 이메일을 입력해주세요' : null}
          >
            <input
              type="text"
              value={ident}
              onChange={(e) => setIdent(e.target.value)}
              placeholder="010-1234-5678 또는 you@email.com"
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
