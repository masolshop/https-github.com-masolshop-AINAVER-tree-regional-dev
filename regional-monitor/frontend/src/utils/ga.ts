/**
 * Google Analytics 4 (gtag.js) 헬퍼.
 *
 * - GA 측정 ID는 빌드시 환경변수 `VITE_GA_MEASUREMENT_ID` 로 주입.
 * - 미설정 시 모든 함수가 no-op (개발/로컬 안전).
 * - SPA 라우트 변경 시 page_view 수동 송신 (`useGaPageView` 훅 사용).
 */

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    __GA_MEASUREMENT_ID__?: string
  }
}

let _initialized = false

/** 빌드시 주입된 GA 측정 ID. 미설정이면 빈 문자열. */
export function getGaMeasurementId(): string {
  const fromVite = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || ''
  const fromRuntime = (typeof window !== 'undefined' && window.__GA_MEASUREMENT_ID__) || ''
  return (fromVite || fromRuntime || '').trim()
}

/** GA 활성화 여부 (측정 ID 존재). */
export function isGaEnabled(): boolean {
  return getGaMeasurementId().length > 0
}

/**
 * gtag.js 스크립트를 동적으로 로드하고 초기화.
 * 한 번만 실행되며, 측정 ID가 없으면 즉시 반환.
 */
export function initGa(): void {
  if (_initialized) return
  if (typeof window === 'undefined') return
  const id = getGaMeasurementId()
  if (!id) return

  // dataLayer / gtag stub은 index.html에서 이미 정의됨 — 안전장치로 한번 더.
  window.dataLayer = window.dataLayer || []
  if (typeof window.gtag !== 'function') {
    window.gtag = function (...args: unknown[]) {
      ;(window.dataLayer as unknown[]).push(args)
    }
  }

  // <script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)

  // 'js' / 'config' 초기화. SPA에서는 자동 page_view를 끄고 수동 송신.
  window.gtag?.('js', new Date())
  window.gtag?.('config', id, {
    send_page_view: false,
    anonymize_ip: true,
  })

  _initialized = true
}

/** 페이지 조회 이벤트 송신. */
export function trackPageView(path: string, title?: string): void {
  if (!isGaEnabled() || typeof window === 'undefined') return
  const id = getGaMeasurementId()
  window.gtag?.('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: title || document.title,
    send_to: id,
  })
}

/** 사용자 정의 이벤트 송신. */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!isGaEnabled() || typeof window === 'undefined') return
  window.gtag?.('event', name, params || {})
}
