/**
 * SPA 라우트 변경 시 GA4 page_view 이벤트를 자동 송신하는 훅.
 * App 최상위에서 한 번만 호출.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { initGa, isGaEnabled, trackPageView } from '@/utils/ga'

export function useGaPageView() {
  const location = useLocation()

  // GA 스크립트 1회 초기화
  useEffect(() => {
    initGa()
  }, [])

  // 라우트 변경마다 page_view 송신
  useEffect(() => {
    if (!isGaEnabled()) return
    const path = location.pathname + location.search
    // document.title 업데이트가 끝난 다음 송신
    const id = window.requestAnimationFrame(() => {
      trackPageView(path)
    })
    return () => window.cancelAnimationFrame(id)
  }, [location.pathname, location.search])
}
