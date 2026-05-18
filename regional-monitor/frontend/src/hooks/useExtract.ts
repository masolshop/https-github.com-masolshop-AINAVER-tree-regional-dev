/**
 * React Query hook — 070 → Place ID 자동 추출(검증 전 사전 미리보기용)
 *
 * RegisterTab의 "자동 추출" 버튼에서 사용.
 * 등록 자체는 useCreatePlaceAuto가 한 번에 추출 + 저장을 처리하지만,
 * 사용자가 등록 전에 추출 결과를 한 번 검토하고 싶을 때 이 훅을 사용한다.
 */
import { useMutation } from '@tanstack/react-query'

import { extractPhone } from '../api/places'
import type { ExtractRequest } from '../api/types'

export function useExtractPhone() {
  return useMutation({
    mutationFn: (req: ExtractRequest) => extractPhone(req),
  })
}
