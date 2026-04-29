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
import { useAuthStore } from '@/store/auth'
import { configureAuth } from '@/api/client'
import { useMe } from '@/hooks/useAuth'

import Home from '@/pages/Home'
import Intro from '@/pages/Intro'
import Monitor from '@/pages/Monitor'
import History from '@/pages/History'
import Admin from '@/pages/Admin'
import ResetPassword from '@/pages/ResetPassword'

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
 * /monitor 진입 시 슈퍼어드민이면 /admin/monitor 로 자동 리다이렉트.
 * 슈퍼어드민은 본인 업체를 등록하지 않으므로 회원 모니터링 페이지를 보여준다.
 * 일반 회원은 평소대로 Monitor 페이지로 진입.
 */
function MonitorRedirectGate({ children }: { children: React.ReactNode }) {
  const isSuperadmin = useAuthStore((s) => !!s.user?.is_superadmin)
  if (isSuperadmin) {
    return <Navigate to="/admin/monitor" replace />
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
      {/* 인앱 브라우저 가드 제거 (2026-04): Google 로그인이 제거되어 더 이상 필요없음.
          휴대폰/이메일+비밀번호 로그인은 카톡 인앱 브라우저에서도 정상 작동함. */}
      <BrowserRouter>
        <AuthBootstrap />
        <Routes>
          {/* 비밀번호 재설정 — 인증 없이 접근, AppLayout 외부 */}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/intro" element={<Intro />} />
            <Route
              path="/monitor"
              element={
                <ProtectedRoute redirectTo="/monitor">
                  <MonitorRedirectGate>
                    <Monitor />
                  </MonitorRedirectGate>
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
            <Route
              path="/admin/monitor"
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
