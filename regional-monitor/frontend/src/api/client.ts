/**
 * API 클라이언트 — fetch 래퍼
 *
 * - API_BASE: VITE_API_BASE > sandbox 호스트(5173→8000) > localhost:8000
 * - Authorization: Bearer <jwt> 헤더 자동 주입 (auth store 토큰)
 * - 401 응답 시 자동 로그아웃 + 로그인 모달 트리거
 * - 타임아웃·에러 표준화·JSON 파싱
 */

/**
 * API_BASE 결정
 *  1) VITE_API_BASE 환경변수 (build 시 주입)
 *  2) 현재 호스트가 *.sandbox.novita.ai 면 포트만 5173 → 8000 치환
 *  3) localhost 개발 시 http://127.0.0.1:8000
 */
function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined
  if (envBase) return envBase.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    if (hostname.includes('.sandbox.novita.ai')) {
      const swapped = hostname.replace(/^5173-/, '8000-')
      return `${protocol}//${swapped}`
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000'
    }
  }
  return 'http://127.0.0.1:8000'
}

export const API_BASE: string = resolveApiBase()

/* ─────────── 인증 토큰 게터 (auth store 와 연결) ─────────── */
// auth store가 client를 import 하면 순환참조가 생기므로 setter로 주입한다.
type TokenGetter = () => string | null
type UnauthorizedHandler = () => void

let getToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

export function configureAuth(opts: {
  getToken: TokenGetter
  onUnauthorized?: UnauthorizedHandler
}): void {
  getToken = opts.getToken
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized
}

/* ─────────── 에러 ─────────── */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOpts extends Omit<RequestInit, 'body'> {
  body?: unknown
  timeoutMs?: number
  /** true면 401 시 onUnauthorized 호출하지 않음 (예: /auth/me 폴백 등) */
  skipUnauthorizedHandler?: boolean
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const {
    body,
    timeoutMs = 30_000,
    headers,
    skipUnauthorizedHandler = false,
    ...rest
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // 인증 토큰 자동 주입
  const token = getToken()
  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  }
  if (token && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail: unknown
      try {
        detail = await res.json()
      } catch {
        detail = await res.text().catch(() => '')
      }
      const msg =
        (typeof detail === 'object' && detail !== null && 'detail' in detail
          ? String((detail as { detail: unknown }).detail)
          : null) ?? `${res.status} ${res.statusText}`

      // 401: 토큰 만료/무효 → 자동 로그아웃 + 로그인 모달
      if (res.status === 401 && !skipUnauthorizedHandler) {
        onUnauthorized()
      }

      throw new ApiError(msg, res.status, detail)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('request timeout', 0)
    }
    if (err instanceof ApiError) throw err
    throw new ApiError((err as Error).message ?? 'network error', 0)
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  get: <T>(path: string, opts: RequestOpts = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: RequestOpts = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts: RequestOpts = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts: RequestOpts = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
}
