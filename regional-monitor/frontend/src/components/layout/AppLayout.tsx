/**
 * 앱 전체 레이아웃 (사이드바 + 메인 콘텐츠 + 로그인 모달)
 */
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { LoginModal } from '@/components/auth/LoginModal'

export function AppLayout() {
  return (
    <div className="min-h-screen bg-bg flex">
      <Sidebar />

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 min-w-0 px-8 py-6">
        <div className="max-w-[1280px] mx-auto">
          <Outlet />
        </div>
      </main>

      {/* 로그인 모달 (전역) */}
      <LoginModal />
    </div>
  )
}
