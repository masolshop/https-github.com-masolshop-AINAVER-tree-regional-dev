/**
 * 앱 라우팅 + 인증 부트스트랩
 *
 * - configureAuth(): API client에 토큰 게터 + 401 핸들러 주입 (1회)
 * - useMe()       : 토큰이 있으면 자동으로 /auth/me 호출 → 만료 시 logout
 * - ProtectedRoute: isAuthenticated=false 면 로그인 모달 + / 로 리다이렉트
 * - AdminRoute   : 슈퍼어드민(is_superadmin)만 통과
 *
 * 라우트 코드 스플리팅(2026-05 v2):
 *   · 홈(Home) + ResetPassword + Intro만 즉시 로드 (첫 화면 LCP 최적화)
 *   · About 4개 페이지(WhatIs/EssentialCategories/KeywordLogic/ExposureManagement)는 lazy
 *   · Solutions 인트로 4개(KeywordDna/KeywordDiscover/Competition/Monitor Intro)는 lazy
 *   · 보호된 도구 페이지(Monitor, Keyword, Competition, KeywordDna, Admin)는 lazy
 *     → 메인 번들 582KB → 300KB 이하 목표 (LCP 개선)
 */
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { AppLayout } from '@/components/layout/AppLayout'
import { useAuthStore } from '@/store/auth'
import { configureAuth } from '@/api/client'
import { useMe } from '@/hooks/useAuth'
import { useGaPageView } from '@/hooks/useGaPageView'
import { useNaverWcsPageView } from '@/hooks/useNaverWcs'

// ── 즉시 로드 (첫 화면 LCP 최적화) ────────────────────
import Home from '@/pages/Home'
import ResetPassword from '@/pages/ResetPassword'

// ── 외부 공개 데모 진입 (lazy) ──────────────────────
const Demo = lazy(() => import('@/pages/Demo'))

// ── 소개/Intro 페이지 (lazy) ─────────────────────────
const Intro = lazy(() => import('@/pages/Intro'))
const KeywordDnaIntro = lazy(() => import('@/pages/Solutions/KeywordDnaIntro'))
const KeywordDiscoverIntro = lazy(() => import('@/pages/Solutions/KeywordDiscoverIntro'))
const CompetitionIntro = lazy(() => import('@/pages/Solutions/CompetitionIntro'))
const MonitorIntro = lazy(() => import('@/pages/Solutions/MonitorIntro'))
const RankTrackerIntro = lazy(() => import('@/pages/Solutions/RankTrackerIntro'))

// ── About 페이지 (lazy) ─────────────────────────────
const WhatIs = lazy(() => import('@/pages/About/WhatIs'))
const EssentialCategories = lazy(() => import('@/pages/About/EssentialCategories'))
const KeywordLogic = lazy(() => import('@/pages/About/KeywordLogic'))
const ExposureManagement = lazy(() => import('@/pages/About/ExposureManagement'))

// ── 요금제 페이지 (lazy) ─────────────────────────────
const Pricing = lazy(() => import('@/pages/Pricing'))

// ── 로그인/권한 필요 페이지 (lazy) ──────────────────────
const Monitor = lazy(() => import('@/pages/Monitor'))
const KeywordDiscover = lazy(() => import('@/pages/Keyword/Discover'))
const Competition = lazy(() => import('@/pages/Competition'))
const KeywordDna = lazy(() => import('@/pages/KeywordDna'))
const RankTracker = lazy(() => import('@/pages/RankTracker'))
const Admin = lazy(() => import('@/pages/Admin'))

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

/** SPA 라우트 변경 시 GA4 page_view 자동 송신 */
function GaTracker() {
  useGaPageView()
  return null
}

/** SPA 라우트 변경 시 네이버 프리미엄 로그분석/전환추적 페이지뷰 자동 송신 */
function NaverWcsTracker() {
  useNaverWcsPageView()
  return null
}

/** lazy 페이지 로딩 중 스피너 */
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-ink-muted">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">페이지 로드 중…</span>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 인앱 브라우저 가드 제거 (2026-04): Google 로그인이 제거되어 더 이상 필요없음.
          휴대폰/이메일+비밀번호 로그인은 카톡 인앱 브라우저에서도 정상 작동함. */}
      <BrowserRouter>
        <AuthBootstrap />
        <GaTracker />
        <NaverWcsTracker />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* 비밀번호 재설정 — 인증 없이 접근, AppLayout 외부 */}
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Home />} />
              {/* 외부 공개 데모 진입 — /demo?t=<token> */}
              <Route path="/demo" element={<Demo />} />
              <Route path="/intro" element={<Intro />} />
              <Route path="/intro/keyword-dna" element={<KeywordDnaIntro />} />
              <Route path="/intro/keyword-discover" element={<KeywordDiscoverIntro />} />
              <Route path="/intro/competition" element={<CompetitionIntro />} />
              <Route path="/intro/monitor" element={<MonitorIntro />} />
              <Route path="/intro/rank-tracker" element={<RankTrackerIntro />} />
              <Route path="/about/what-is" element={<WhatIs />} />
              <Route path="/about/essential-categories" element={<EssentialCategories />} />
              <Route path="/about/keyword-logic" element={<KeywordLogic />} />
              <Route path="/about/exposure-management" element={<ExposureManagement />} />
              <Route path="/pricing" element={<Pricing />} />
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
              {/* /history 는 /monitor?tab=history 로 리다이렉트 (2026-05 통합) */}
              <Route path="/history" element={<Navigate to="/monitor?tab=history" replace />} />
              <Route
                path="/keyword"
                element={
                  <ProtectedRoute redirectTo="/keyword">
                    <KeywordDiscover />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/competition"
                element={
                  <ProtectedRoute redirectTo="/competition">
                    <Competition />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/keyword-dna"
                element={
                  <ProtectedRoute redirectTo="/keyword-dna">
                    <KeywordDna />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/auto-rank-check"
                element={
                  <ProtectedRoute redirectTo="/auto-rank-check">
                    <RankTracker />
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
              <Route
                path="/admin/schedule"
                element={
                  <AdminRoute>
                    <Admin />
                  </AdminRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
