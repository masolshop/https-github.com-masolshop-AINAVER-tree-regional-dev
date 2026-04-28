/**
 * 앱 라우팅 + 인증 부트스트랩
 *
 * - configureAuth(): API client에 토큰 게터 + 401 핸들러 주입 (1회)
 * - useMe()       : 토큰이 있으면 자동으로 /auth/me 호출 → 만료 시 logout
 * - ProtectedRoute: isAuthenticated=false 면 로그인 모달 + / 로 리다이렉트
 * - AdminRoute   : 슈퍼어드민(is_superadmin)만 통과
 */
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AppLayout } from '@/components/layout/AppLayout'
import { InAppBrowserGuard } from '@/components/InAppBrowserGuard'
import { useAuthStore } from '@/store/auth'
import { configureAuth } from '@/api/client'
import { useMe } from '@/hooks/useAuth'

import Home from '@/pages/Home'
import Intro from '@/pages/Intro'
import Monitor from '@/pages/Monitor'
import History from '@/pages/History'
import Admin from '@/pages/Admin'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * client.ts ↔ auth store 연결.
 * 컴포넌트 트리 바깥(모듈 import 시점)에서 한 번만 설정한다.
 * 401 응답 시 자동 로그아웃 + 로그인 모달 노출.
 */
configureAuth({
  getToken: () => useAuthStore.getState().accessToken,
  onUnauthorized: () => {
    const s = useAuthStore.getState()
    s.logout()
    s.openLoginModal()
  },
})

function ProtectedRoute({
  children,
  redirectTo,
}: {
  children: React.ReactNode
  redirectTo: string
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

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

/**
 * 슈퍼어드민 전용 라우트.
 *  · 미인증     → 로그인 모달 + / 리다이렉트
 *  · 비-어드민  → / 리다이렉트 (조용히)
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isSuperadmin = useAuthStore((s) => !!s.user?.is_superadmin)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  useEffect(() => {
    if (!isAuthenticated) {
      openLoginModal('/admin')
    }
  }, [isAuthenticated, openLoginModal])

  if (!isAuthenticated) return <Navigate to="/" replace />
  if (!isSuperadmin) return <Navigate to="/" replace />
  return <>{children}</>
}

/** 토큰 검증 자동 실행용 컴포넌트 (앱 마운트 시 1회) */
function AuthBootstrap() {
  useMe()
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 인앱 브라우저(카톡 등) 감지 → 외부 브라우저 자동 열기. 모든 라우트보다 먼저 검사 */}
      <InAppBrowserGuard />
      <BrowserRouter>
        <AuthBootstrap />
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
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <Admin />
                </AdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
