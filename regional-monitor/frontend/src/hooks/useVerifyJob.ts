/**
 * React Query hooks — 대용량 검증 작업 (VerifyJob).
 *
 * 사용 흐름:
 *   1) useCreateVerifyJob().mutateAsync({ place_ids? }) → 작업 생성 (status=queued)
 *   2) useVerifyJob(jobId, true) 로 폴링 (1.5초 간격, status가 진행 중일 때만)
 *   3) 완료되면 verifyJobMismatchesUrl(jobId) 로 .xlsx 다운로드
 *   4) 필요 시 useCancelVerifyJob().mutate(id) 로 취소
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createVerifyJob,
  getVerifyJob,
  cancelVerifyJob,
  verifyJobMismatchesUrl,
} from '../api/places'
import type { VerifyJob, VerifyJobCreateRequest } from '../api/types'
import { placeKeys } from './usePlaces'

export const verifyJobKeys = {
  all: ['verify-job'] as const,
  byId: (id: number) => ['verify-job', id] as const,
}

/** 작업 생성 — 사용자당 동시 1개 (서버에서 409로 가드). */
export function useCreateVerifyJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: VerifyJobCreateRequest = {}) => createVerifyJob(req),
    onSuccess: (job) => {
      qc.setQueryData(verifyJobKeys.byId(job.id), job)
    },
  })
}

/**
 * 작업 상태 폴링 — enabled=true 인 동안 1.5초마다 GET.
 * status 가 종료(완료/취소/실패) 되면 폴링 자동 중단 + Places 캐시 무효화.
 */
export function useVerifyJob(jobId: number | null, enabled = true) {
  const qc = useQueryClient()
  return useQuery<VerifyJob>({
    queryKey: jobId ? verifyJobKeys.byId(jobId) : ['verify-job', 'noop'],
    queryFn: () => getVerifyJob(jobId as number),
    enabled: !!jobId && enabled,
    refetchInterval: (q) => {
      const data = q.state.data as VerifyJob | undefined
      if (!data) return 1500
      if (['completed', 'cancelled', 'failed'].includes(data.status)) {
        // 종료 시 places 캐시 한 번만 무효화
        qc.invalidateQueries({ queryKey: placeKeys.all })
        return false
      }
      return 1500
    },
    staleTime: 0,
  })
}

/** 취소 요청 */
export function useCancelVerifyJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => cancelVerifyJob(id),
    onSuccess: (_resp, id) => {
      qc.invalidateQueries({ queryKey: verifyJobKeys.byId(id) })
    },
  })
}

/** .xlsx 다운로드 — 인증 헤더 필요해서 fetch + Blob */
export async function downloadJobMismatches(jobId: number, accessToken: string | null) {
  const url = verifyJobMismatchesUrl(jobId)
  // API_BASE 와 연계: client.ts 와 동일하게 상대경로 호출 가능 (vite proxy/nginx)
  const res = await fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`다운로드 실패 (${res.status}): ${text.slice(0, 200)}`)
  }
  const blob = await res.blob()
  // Content-Disposition 헤더에서 파일명 추출
  const cd = res.headers.get('content-disposition') || ''
  let filename = `타지역서비스_불일치명단_job${jobId}.xlsx`
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i)
  if (m && m[1]) {
    try {
      filename = decodeURIComponent(m[1])
    } catch {
      filename = m[1]
    }
  }
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
