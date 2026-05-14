/**
 * /demo?t=<token> — 외부 공개 데모 진입 페이지.
 *
 * 흐름:
 *   1) 마운트 시 URL 쿼리에서 t 추출
 *   2) POST /api/v1/auth/demo-login { token } 호출
 *   3) 응답의 access_token + user(is_demo=true) 를 AuthStore 에 저장
 *   4) /monitor 로 자동 리다이렉트 → 게스트는 모든 솔루션 탐색 가능 (mutation 차단)
 *
 * 실패 케이스:
 *   - t 누락 → 안내 + 홈으로 가기 버튼
 *   - 401 (토큰 불일치) → 만료/오류 안내
 *   - 503 (데모 비활성) → 운영 점검 안내
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Loader2, AlertTriangle, Sparkles } from 'lucide-react'

import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth'
import PageSeo from '@/components/seo/PageSeo'

type Status = 'idle' | 'loading' | 'error'

export default function Demo() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)

  const [status, setStatus] = useState<Status>('idle')
  const [errMsg, setErrMsg] = useState<string>('')

  useEffect(() => {
    const token = (params.get('t') || params.get('token') || '').trim()
    if (!token) {
      setStatus('error')
      setErrMsg(
        '접근 토큰이 없습니다. 공유받은 데모 링크가 올바른지 확인해주세요.',
      )
      return
    }

    let cancelled = false
    ;(async () => {
      setStatus('loading')
      try {
        const resp = await authApi.demoLogin({ token })
        if (cancelled) return
        setSession(resp.access_token, resp.user)
        // 데모 게스트는 monitor 부터 — 5대 솔루션 진입의 자연스러운 시작점
        navigate('/monitor', { replace: true })
      } catch (e) {
        if (cancelled) return
        const msg =
          (e as Error)?.message ||
          '데모 진입에 실패했습니다. 잠시 후 다시 시도해주세요.'
        setStatus('error')
        setErrMsg(msg)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [params, navigate, setSession])

  return (
    <>
      <PageSeo
        title="외부 공개 데모 — 타지역서비스 5대 솔루션"
        description="회원가입 없이 타지역서비스의 5대 솔루션을 둘러볼 수 있는 외부 공개 데모입니다. 실제 기능 사용은 회원가입 후 가능합니다."
        path="/demo"
        noindex
      />
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {status === 'idle' || status === 'loading' ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50">
                <Sparkles className="text-blue-600" size={26} />
              </div>
              <h1 className="text-lg font-bold text-ink">
                외부 공개 데모 진입 중…
              </h1>
              <p className="text-sm text-ink-2 leading-relaxed">
                타지역서비스 5대 솔루션을 둘러보실 수 있도록
                <br />
                게스트 세션을 준비하고 있습니다.
              </p>
              <div className="flex items-center justify-center gap-2 text-ink-muted pt-2">
                <Loader2 className="animate-spin" size={16} />
                <span className="text-xs">잠시만 기다려주세요</span>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-50">
                <AlertTriangle className="text-amber-600" size={26} />
              </div>
              <h1 className="text-lg font-bold text-ink">데모 진입 실패</h1>
              <p className="text-sm text-ink-2 leading-relaxed break-keep">
                {errMsg}
              </p>
              <div className="pt-4 flex flex-col gap-2">
                <Link
                  to="/"
                  className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  홈으로 가기
                </Link>
                <Link
                  to="/intro"
                  className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-md bg-slate-100 text-ink text-sm font-semibold hover:bg-slate-200 transition-colors"
                >
                  5대 솔루션 소개 보기
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
