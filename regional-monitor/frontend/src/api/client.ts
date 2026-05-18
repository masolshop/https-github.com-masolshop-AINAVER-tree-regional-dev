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
  // 'same-origin' 또는 '' 인 경우 → API 경로는 path 부분만 사용 (nginx 가 /api/* 를 백엔드로 프록시).
  if (envBase !== undefined) {
    const trimmed = envBase.replace(/\/$/, '')
    if (trimmed === '' || trimmed === 'same-origin') return ''
    // 사용자가 '/api/v1' 같이 prefix 를 넣어두면, path 가 이미 '/api/v1/...' 로 시작하므로
    // prefix 와 경로가 중복된다. 그런 경우엔 안전하게 '' 로 강등 (same-origin) 한다.
    if (trimmed.startsWith('/api')) return ''
    return trimmed
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    if (hostname.includes('.sandbox.novita.ai')) {
      const swapped = hostname.replace(/^5173-/, '8000-')
      return `${protocol}//${swapped}`
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000'
    }
    // 운영 빌드에서 호스트가 그 외(예: AWS Lightsail IP, 도메인) 이면 same-origin.
    return ''
  }
  return 'http://127.0.0.1:8000'
}

export const API_BASE: string = resolveApiBase()

/** 외부에서 absolute URL 만들 때 사용 (e.g. file download). */
export function getApiBase(): string {
  return API_BASE
}

/* ─────────── 인증 토큰 게터 (auth store 와 연결) ─────────── */
// auth store가 client를 import 하면 순환참조가 생기므로 setter로 주입한다.
type TokenGetter = () => string | null
type UnauthorizedHandler = () => void

let getToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

/** 현재 토큰이 있으면 Bearer 헤더를 반환 (fetch 직접 호출 시 사용). */
export function getAuthHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

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

interface RequestOpts extends Omit<RequestInit, 'body' | 'signal'> {
  body?: unknown
  timeoutMs?: number
  /** true면 401 시 onUnauthorized 호출하지 않음 (예: /auth/me 폴백 등) */
  skipUnauthorizedHandler?: boolean
  /**
   * 외부에서 주입하는 AbortSignal — 사용자가 ‘취소’ 를 눌렀을 때 진행 중인
   * fetch 도 즉시 중단되도록 한다 (LiveCheck 청크 호출 등에서 사용).
   */
  signal?: AbortSignal
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const {
    body,
    timeoutMs = 30_000,
    headers,
    skipUnauthorizedHandler = false,
    signal: externalSignal,
    ...rest
  } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 외부 signal 이 abort 되면 우리 controller 도 abort
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

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
      // FastAPI Pydantic 검증 오류는 detail 이 [{loc, msg, type}, ...] 배열
      // 일반 HTTPException 은 detail 이 문자열
      // 둘 다 사람이 읽을 수 있는 한 줄로 변환
      const formatDetail = (d: unknown): string => {
        if (typeof d === 'string') return d
        if (Array.isArray(d)) {
          return d
            .map((item) => {
              if (item && typeof item === 'object') {
                const it = item as { msg?: string; loc?: unknown[]; type?: string }
                const where = Array.isArray(it.loc) ? it.loc.slice(1).join('.') : ''
                return where ? `[${where}] ${it.msg ?? ''}` : (it.msg ?? JSON.stringify(item))
              }
              return String(item)
            })
            .join('; ')
        }
        if (d && typeof d === 'object') {
          // {detail: ...} wrapper 또는 임의 객체
          const obj = d as Record<string, unknown>
          if ('msg' in obj && typeof obj.msg === 'string') return obj.msg
          try {
            return JSON.stringify(obj)
          } catch {
            return '(unparseable error)'
          }
        }
        return String(d ?? '')
      }
      const rawDetail =
        typeof detail === 'object' && detail !== null && 'detail' in detail
          ? (detail as { detail: unknown }).detail
          : detail
      const msg = formatDetail(rawDetail) || `${res.status} ${res.statusText}`

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
      // 외부 signal 로 인한 사용자 취소 vs 자체 timeout 구분
      if (externalSignal?.aborted) {
        throw new ApiError('aborted by user', 0)
      }
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
