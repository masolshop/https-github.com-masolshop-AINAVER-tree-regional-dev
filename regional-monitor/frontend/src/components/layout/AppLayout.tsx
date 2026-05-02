/**
 * 앱 전체 레이아웃 (반응형: 데스크탑 사이드바 / 모바일 햄버거 Drawer)
 *
 * 데스크탑(≥lg, 1024px 이상): 좌측 고정 사이드바 + 메인 콘텐츠
 * 모바일(<lg): 상단 모바일 헤더(로고 + 햄버거) + 풀스크린 콘텐츠
 *              햄버거 클릭 시 좌측에서 슬라이드되는 Drawer Sidebar 노출
 */
import { useEffect, useState } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { LoginModal } from '@/components/auth/LoginModal'

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // 라우트 변경 시 Drawer 자동 닫기
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Drawer 열린 동안 body 스크롤 잠금
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  // ESC로 Drawer 닫기
  useEffect(() => {
    if (!drawerOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [drawerOpen])

  return (
    <div className="min-h-screen bg-bg lg:flex">
      {/* ───── 모바일 전용 상단 헤더 (햄버거 + 로고) ───── */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-bg-subtle">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            type="button"
            aria-label="메뉴 열기"
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-ink hover:bg-bg-subtle active:bg-bg-subtle transition-colors"
          >
            <Menu size={22} />
          </button>

          <Link to="/" className="flex items-center gap-2" aria-label="타지역닷컴 홈">
            <img
              src="/logo.png"
              alt="타지역닷컴 로고 - 타지역서비스 네이버 노출 자동체크 솔루션"
              className="h-8 w-auto select-none"
              draggable={false}
            />
          </Link>

          {/* 우측 자리 채움 (균형) */}
          <div className="w-10" />
        </div>
      </header>

      {/* ───── 데스크탑 전용 사이드바 (≥lg) ───── */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* ───── 모바일 Drawer (사이드바를 슬라이드) ───── */}
      {/* 백드롭 */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      {/* 슬라이드 패널 */}
      <div
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-[85%] max-w-[320px] bg-bg shadow-2xl transition-transform duration-200 ease-out ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="사이드 메뉴"
      >
        <div className="relative h-full overflow-y-auto">
          {/* 닫기 버튼 (Drawer 내부 우상단) */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setDrawerOpen(false)}
            className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-xl bg-white/80 text-ink hover:bg-white shadow-card transition-colors"
          >
            <X size={18} />
          </button>
          <Sidebar onItemClick={() => setDrawerOpen(false)} />
        </div>
      </div>

      {/* ───── 메인 콘텐츠 ───── */}
      <main className="flex-1 min-w-0 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
        <div className="max-w-[1280px] mx-auto">
          <Outlet />
        </div>
      </main>

      {/* 로그인 모달 (전역) */}
      <LoginModal />
    </div>
  )
}
