/**
 * 로그인 모달
 * - 구글 OAuth 로 로그인 (추후 백엔드 연동)
 * - 핵심 메뉴 클릭 시 자동 노출
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

export function LoginModal() {
  const navigate = useNavigate()
  const { loginModalOpen, closeLoginModal, redirectAfterLogin, setUser } = useAuthStore()

  // ESC로 닫기
  useEffect(() => {
    if (!loginModalOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLoginModal()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [loginModalOpen, closeLoginModal])

  if (!loginModalOpen) return null

  // ⚠️ TODO: 실제 Google OAuth 연동 (백엔드 /api/auth/google 호출)
  // 지금은 UI 검증을 위한 임시 처리
  const handleGoogleLogin = () => {
    // 임시: Mock 사용자로 즉시 로그인
    setUser({
      id: 'mock-user-001',
      email: 'tester@regionwatch.kr',
      name: '테스트 사용자',
      picture: undefined,
      plan: 'FREE',
    })
    if (redirectAfterLogin) {
      navigate(redirectAfterLogin)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-950/40 backdrop-blur-sm"
      onClick={closeLoginModal}
    >
      <div
        className="w-full max-w-md bg-white rounded-card-lg shadow-card-hover p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 닫기 버튼 */}
        <button
          aria-label="닫기"
          onClick={closeLoginModal}
          className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-bg-subtle flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
        >
          <X size={18} />
        </button>

        {/* 헤더 */}
        <div className="text-center mb-7">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-brand-500 items-center justify-center mb-4 shadow-card">
            <ShieldCheck className="text-white" size={24} />
          </div>
          <h2 className="text-h2 text-ink mb-2">로그인이 필요합니다</h2>
          <p className="text-body-sm text-ink-muted">
            실시간 노출 관리 기능을 사용하려면 로그인 해주세요
          </p>
        </div>

        {/* 구글 로그인 버튼 */}
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl bg-white border-2 border-bg-subtle hover:border-brand-200 hover:bg-bg-subtle transition-all font-semibold text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Google 계정으로 계속하기
        </button>

        {/* 구분선 */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-bg-subtle"></div>
          <span className="text-caption text-ink-soft">또는</span>
          <div className="flex-1 h-px bg-bg-subtle"></div>
        </div>

        {/* 안내 문구 */}
        <div className="text-center text-caption text-ink-muted leading-relaxed">
          로그인 시 <span className="text-ink font-medium">이용약관</span> 및{' '}
          <span className="text-ink font-medium">개인정보 처리방침</span>에<br />
          동의하신 것으로 간주됩니다.
        </div>

        {/* 임시: 개발용 표시 */}
        <div className="mt-6 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-caption text-amber-800 text-center">
          ⚠️ 현재 개발 모드 — 클릭 시 테스트 계정으로 자동 로그인됩니다
        </div>
      </div>
    </div>
  )
}
