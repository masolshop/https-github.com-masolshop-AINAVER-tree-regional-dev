/**
 * React Query hook — 4단계 실시간 검증
 *
 * - useRunLiveCheck() : 등록된 플레이스 일괄(또는 선택) 검증
 *   onSuccess 시 Places 캐시 무효화(verdict 갱신 반영).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { runLiveCheck } from '../api/places'
import type { LiveCheckRequest } from '../api/types'
import { placeKeys } from './usePlaces'

export function useRunLiveCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: LiveCheckRequest = {}) => runLiveCheck(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: placeKeys.all })
    },
  })
}

/** alias — 짧은 이름 */
export const useLiveCheck = useRunLiveCheck
