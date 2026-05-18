/**
 * SPA 라우트 변경 시 네이버 프리미엄 로그분석(wcslog) 페이지 추적을 자동 송신하는 훅.
 *
 * - 정적 index.html 의 wcslog.js 가 1회 로드되어 window.wcs / wcs_add / _nasa 가 준비됨.
 * - SPA에서는 페이지 이동 시 index.html 이 다시 로드되지 않으므로,
 *   라우트 변경마다 wcs.inflow() + wcs_do() 를 다시 호출해야 정확한 페이지뷰가 잡힌다.
 * - App 최상위에서 한 번만 호출 (NaverWcsTracker 컴포넌트로 래핑됨).
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wcs?: { inflow: (host?: string) => void } & Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wcs_add?: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _nasa?: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wcs_do?: (nasa?: Record<string, any>) => void
  }
}

export function useNaverWcsPageView() {
  const location = useLocation()

  useEffect(() => {
    // index.html 에서 wcslog.js 로드 실패 시 (광고차단 / 네트워크 오류) 무시.
    if (typeof window === 'undefined') return
    if (!window.wcs || !window.wcs_do) return

    // 라우트 변경마다 _nasa 를 새 객체로 초기화해 직전 페이지의 잔존 값이 섞이지 않게 함.
    window._nasa = {}

    // 동기 호출 시 React 라우팅 직후 document.title 이 갱신되기 전이라 부정확.
    // requestAnimationFrame 으로 한 프레임 양보 후 발화.
    const id = window.requestAnimationFrame(() => {
      try {
        window.wcs?.inflow('taziyuk.com')
        window.wcs_do?.(window._nasa)
      } catch (_e) {
        // best-effort: 로그 분석 실패가 사용자 경험을 막지 않도록 조용히 무시
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [location.pathname, location.search])
}
