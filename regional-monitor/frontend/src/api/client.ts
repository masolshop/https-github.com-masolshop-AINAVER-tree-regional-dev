/**
 * API 클라이언트 — fetch 래퍼
 *
 * 기본 URL은 환경변수 VITE_API_BASE 우선, 없으면 sandbox 백엔드 URL.
 * 타임아웃·에러 표준화·JSON 파싱·CORS 정책을 한 곳에서 관리한다.
 */

const DEFAULT_API_BASE =
  'https://8000-inw0qfytlerazc1omo3uw-5634da27.sandbox.novita.ai'

export const API_BASE: string =
  // Vite 환경변수 (build 시 주입)
  (import.meta.env.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE

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
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { body, timeoutMs = 30_000, headers, ...rest } = opts

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(headers as Record<string, string> | undefined),
      },
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
