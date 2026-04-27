/**
 * 로그인 필요 페이지 가드
 * 비로그인 상태에서 접근 시 → 홈으로 리다이렉트 + 로그인 모달 자동 오픈
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)
  const location = useLocation()

  useEffect(() => {
    if (!isAuthenticated) {
      openLoginModal(location.pathname)
    }
  }, [isAuthenticated, location.pathname, openLoginModal])

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
