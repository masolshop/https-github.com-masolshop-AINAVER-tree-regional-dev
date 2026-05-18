/**
 * 외부 공개 데모 게스트 세션 전용 상단 띠 배너.
 *
 * useAuthStore.isDemo === true 일 때만 렌더링.
 * 모든 페이지(AppLayout 내부) 최상단에 sticky 로 노출되어
 * 사용자가 데모 모드임을 항상 인지하게 한다.
 *
 * 디자인:
 *   - 호박색(amber) gradient — 경고 톤이 아닌 "공지" 톤
 *   - 좌측: 🎁 아이콘 + 메시지
 *   - 우측: [회원가입] CTA 버튼 (홈으로 이동 후 가입 모달 오픈)
 */
import { useAuthStore } from '@/store/auth'
import { Sparkles, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function DemoBanner() {
  const isDemo = useAuthStore((s) => s.isDemo)
  const openSignupModal = useAuthStore((s) => s.openSignupModal)
  const navigate = useNavigate()

  if (!isDemo) return null

  const handleSignup = () => {
    // 가입 모달은 홈에서 열리도록 통일 (다른 페이지에서 즉시 열어도 되지만,
    // 데모 세션 토큰이 남아있어 회원가입 직후 충돌 가능성 있어 안전 경로로)
    navigate('/')
    setTimeout(() => openSignupModal(), 80)
  }

  return (
    <div className="sticky top-0 z-40 w-full bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 border-b border-amber-200">
      <div className="max-w-[1280px] mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-amber-900">
          <Sparkles size={14} className="flex-shrink-0" />
          <p className="text-[12px] sm:text-[13px] font-semibold leading-tight truncate sm:whitespace-normal">
            <span className="hidden sm:inline">🎁 </span>
            외부 공개 데모 — 자유롭게 클릭/탐색은 가능하나, 실제 기능 사용은 회원가입 후 이용 가능합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignup}
          className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 transition-colors shadow-sm"
        >
          회원가입
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}
