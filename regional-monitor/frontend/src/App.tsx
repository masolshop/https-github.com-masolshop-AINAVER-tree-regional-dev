/**
 * 앱 라우팅
 * - 비로그인: 홈, 솔루션 소개 자유 접근
 * - 로그인 필요: 실시간 노출 관리, 실시간 노출 이력 → 모달 자동 노출
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuthStore } from '@/store/auth'
import Home from '@/pages/Home'
import Intro from '@/pages/Intro'
import Monitor from '@/pages/Monitor'
import History from '@/pages/History'
import { useEffect } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * 라우트 가드 - 비로그인 시 홈으로 리다이렉트 + 로그인 모달 자동 노출
 * 사용자가 직접 URL로 접근한 경우에도 안전하게 차단
 */
function ProtectedRoute({ children, redirectTo }: { children: React.ReactNode; redirectTo: string }) {
  const { isAuthenticated, openLoginModal } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      openLoginModal(redirectTo)
    }
  }, [isAuthenticated, openLoginModal, redirectTo])

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/intro" element={<Intro />} />
            <Route
              path="/monitor"
              element={
                <ProtectedRoute redirectTo="/monitor">
                  <Monitor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute redirectTo="/history">
                  <History />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
