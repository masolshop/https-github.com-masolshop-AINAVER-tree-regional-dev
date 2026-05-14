/**
 * 외부 공개 데모 세션 전용 — 카카오톡 상담 플로팅 버튼.
 *
 * useAuthStore.isDemo === true 일 때만 렌더링.
 * 화면 우하단에 fixed 로 항상 떠 있어, 데모 게스트가 어느 페이지를 보든
 * 1탭 거리에 카톡 상담 채널이 열린다.
 *
 * 디자인:
 *   - 카카오 옐로(#FEE500) 원형 버튼
 *   - "카톡상담" 라벨 (sm 이상에서만 표시, 모바일은 아이콘만)
 *   - 우하단 24px 마진, hover 살짝 떠오름
 *   - z-50 — 다른 모달 아래, sticky 배너 위
 *
 * URL: utils/contact.ts 의 KAKAO_CHAT_URL 단일 진입점 재사용.
 */
import { useAuthStore } from '@/store/auth'
import { KAKAO_CHAT_URL, EXTERNAL_LINK_PROPS } from '@/utils/contact'
import { MessageCircle } from 'lucide-react'

export function DemoKakaoFab() {
  const isDemo = useAuthStore((s) => s.isDemo)
  if (!isDemo) return null

  return (
    <a
      href={KAKAO_CHAT_URL}
      {...EXTERNAL_LINK_PROPS}
      aria-label="카카오톡 상담 — 타지역서비스 5대 솔루션 무료 상담"
      className="fixed z-50 bottom-5 right-5 sm:bottom-6 sm:right-6 inline-flex items-center gap-2 px-4 py-3 sm:px-5 sm:py-3.5 rounded-full bg-[#FEE500] text-[#3C1E1E] font-bold text-sm shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150 select-none"
      style={{
        // 모바일 safe-area (iOS 노치/홈 인디케이터) 대응
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
      }}
    >
      <MessageCircle size={18} className="flex-shrink-0" />
      <span className="hidden sm:inline">카톡상담</span>
      <span className="sm:hidden text-[13px]">상담</span>
    </a>
  )
}
