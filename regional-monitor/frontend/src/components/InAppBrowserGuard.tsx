/**
 * 인앱 브라우저(카카오톡, 네이버, 인스타, 페이스북) 감지 → 외부 브라우저 자동 열기
 *
 * 문제:
 *   - 카톡방 링크 클릭 시 카카오톡 인앱 WebView로 열림
 *   - Google OAuth가 인앱 WebView에서 차단됨 (disallowed_useragent)
 *   - 일부 쿠키/스토리지 동작 비정상
 *
 * 해결:
 *   1) Android: kakaotalk://web/openExternal?url=... 인텐트로 외부 브라우저 자동 호출
 *   2) iOS: 자동 호출 불가 → "Safari로 열기" 안내 화면 표시
 *   3) 그 외 인앱(naver, instagram, line, fb) 도 동일 안내
 *
 * 적용 위치: App.tsx 최상단 (어떤 라우트보다 먼저 검사)
 */
import { useEffect, useState } from 'react'
import { ExternalLink, Copy, Check, Smartphone } from 'lucide-react'

/** 인앱 브라우저 종류 식별 */
type InAppType = 'kakaotalk' | 'naver' | 'instagram' | 'facebook' | 'line' | 'other' | null

function detectInApp(ua: string): InAppType {
  const u = ua.toLowerCase()
  if (u.includes('kakaotalk')) return 'kakaotalk'
  if (u.includes('naver') || u.includes('inapp')) return 'naver'
  if (u.includes('instagram')) return 'instagram'
  if (u.includes('fbav') || u.includes('fban') || u.includes('fb_iab')) return 'facebook'
  if (u.includes('line/')) return 'line'
  // 일반적인 WebView 패턴 (구글이 차단하는 형태)
  if (u.includes('; wv)') || u.includes('webview')) return 'other'
  return null
}

function isIOS(ua: string): boolean {
  const u = ua.toLowerCase()
  return /iphone|ipad|ipod/.test(u)
}

/**
 * 카카오톡 Android 인앱에서 외부 브라우저로 즉시 점프.
 * iOS 카톡은 외부 브라우저로 자동 점프할 수 있는 공식 스킴이 없음 → 안내만.
 */
function tryEscapeKakaoAndroid(currentUrl: string): boolean {
  try {
    // 카카오톡 공식 외부 브라우저 인텐트
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`
    return true
  } catch {
    return false
  }
}

export function InAppBrowserGuard() {
  const [inApp, setInApp] = useState<InAppType>(null)
  const [ios, setIos] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    const detected = detectInApp(ua)
    if (!detected) return

    const ios = isIOS(ua)
    setIos(ios)
    setInApp(detected)

    // Android 카카오톡 → 즉시 외부 브라우저 자동 호출
    if (!ios && detected === 'kakaotalk') {
      const ok = tryEscapeKakaoAndroid(window.location.href)
      if (ok) {
        // 1초 후에도 같은 페이지에 남아있으면 안내 화면 유지 (실패 케이스)
        setTimeout(() => {
          // noop: 안내 화면은 이미 setInApp 으로 표시 중
        }, 1000)
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: textarea 트릭
      const ta = document.createElement('textarea')
      ta.value = window.location.href
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenExternal = () => {
    if (inApp === 'kakaotalk' && !ios) {
      tryEscapeKakaoAndroid(window.location.href)
      return
    }
    // iOS / 기타 인앱 → 새 창으로 시도 (대부분 인앱 안에서만 열림)
    window.open(window.location.href, '_blank', 'noopener')
  }

  if (!inApp) return null

  const appName = (() => {
    switch (inApp) {
      case 'kakaotalk': return '카카오톡'
      case 'naver': return '네이버'
      case 'instagram': return '인스타그램'
      case 'facebook': return '페이스북'
      case 'line': return '라인'
      default: return '인앱 브라우저'
    }
  })()

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center px-6 py-8">
      <div className="max-w-md w-full text-center">
        {/* 아이콘 */}
        <div className="w-20 h-20 rounded-3xl bg-brand-100 flex items-center justify-center mx-auto mb-6">
          <Smartphone className="text-brand-600" size={40} />
        </div>

        {/* 제목 */}
        <h1 className="text-2xl font-bold text-ink mb-3">
          외부 브라우저로 열어주세요
        </h1>

        {/* 설명 */}
        <p className="text-body-sm text-ink-muted leading-relaxed mb-6">
          현재 <b className="text-ink">{appName}</b> 인앱 브라우저에서 접속하셨습니다.<br />
          원활한 로그인을 위해 <b className="text-ink">Chrome / Safari</b> 등<br />
          외부 브라우저로 열어주세요.
        </p>

        {/* iOS 안내 */}
        {ios && (
          <div className="bg-bg-subtle rounded-card p-4 mb-4 text-left">
            <div className="text-body-sm font-semibold text-ink mb-2">📱 Safari로 여는 방법</div>
            <ol className="text-caption text-ink-muted space-y-1.5 list-decimal list-inside">
              <li>오른쪽 상단 <b>⋯</b> 메뉴 클릭</li>
              <li><b>"Safari로 열기"</b> 또는 <b>"기본 브라우저로 열기"</b> 선택</li>
            </ol>
          </div>
        )}

        {/* Android 안내 */}
        {!ios && inApp === 'kakaotalk' && (
          <div className="bg-bg-subtle rounded-card p-4 mb-4 text-left">
            <div className="text-body-sm font-semibold text-ink mb-2">📱 Chrome으로 여는 방법</div>
            <ol className="text-caption text-ink-muted space-y-1.5 list-decimal list-inside">
              <li>아래 <b>"외부 브라우저로 열기"</b> 버튼 클릭</li>
              <li>자동 이동되지 않으면 우측 상단 <b>⋮</b> 메뉴 → <b>"다른 브라우저로 열기"</b></li>
            </ol>
          </div>
        )}

        {!ios && inApp !== 'kakaotalk' && (
          <div className="bg-bg-subtle rounded-card p-4 mb-4 text-left">
            <div className="text-body-sm font-semibold text-ink mb-2">📱 Chrome으로 여는 방법</div>
            <ol className="text-caption text-ink-muted space-y-1.5 list-decimal list-inside">
              <li>우측 상단 <b>⋮</b> 메뉴 클릭</li>
              <li><b>"다른 브라우저로 열기"</b> 또는 URL 복사 후 Chrome에 붙여넣기</li>
            </ol>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="space-y-2">
          <button
            onClick={handleOpenExternal}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-card bg-brand-500 text-white font-semibold hover:bg-brand-600 active:bg-brand-700 transition-colors"
          >
            <ExternalLink size={18} />
            외부 브라우저로 열기
          </button>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-card bg-white border border-bg-subtle text-ink font-semibold hover:bg-bg-subtle transition-colors"
          >
            {copied ? (
              <>
                <Check size={18} className="text-status-success" />
                URL이 복사되었습니다
              </>
            ) : (
              <>
                <Copy size={18} />
                URL 복사하기
              </>
            )}
          </button>
        </div>

        {/* URL 표시 */}
        <div className="mt-6 px-3 py-2 bg-bg-subtle rounded-lg">
          <div className="text-[10px] text-ink-soft mb-0.5">현재 주소</div>
          <div className="text-caption text-ink font-mono truncate">
            {window.location.href}
          </div>
        </div>
      </div>
    </div>
  )
}
