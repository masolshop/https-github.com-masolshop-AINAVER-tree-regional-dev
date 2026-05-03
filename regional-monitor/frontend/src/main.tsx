import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import './index.css'
import App from './App.tsx'

// ─────────────────────────────────────────────────────────────
// 새 배포 후 이전 청크 파일이 사라져 동적 import가 실패할 때
// (ChunkLoadError / Failed to fetch dynamically imported module)
// 자동으로 강제 새로고침하여 최신 index.html을 받아오도록 처리
// ─────────────────────────────────────────────────────────────
const CHUNK_RELOAD_KEY = '__chunk_reload_at__'

function isChunkLoadError(message: string): boolean {
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message)
  )
}

function handleChunkLoadFailure() {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0')
    const now = Date.now()
    // 10초 이내 중복 새로고침은 무시 (무한 루프 방지)
    if (now - last < 10_000) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // sessionStorage 사용 불가 환경은 그대로 진행
  }
  // 캐시를 우회하여 최신 index.html을 받아오도록 강제 새로고침
  window.location.reload()
}

window.addEventListener('error', (event) => {
  const msg = (event?.message || '') + ' ' + (event?.error?.message || '')
  if (isChunkLoadError(msg)) handleChunkLoadFailure()
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: any = event?.reason
  const msg = typeof reason === 'string' ? reason : (reason?.message || '')
  if (isChunkLoadError(msg)) handleChunkLoadFailure()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
)
