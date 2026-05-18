/**
 * 사용자 설정 React Query 훅
 *
 * - useSettings()       : GET /api/v1/settings (5분 캐시)
 * - useUpdateSettings() : PATCH /api/v1/settings → 캐시 자동 갱신
 *
 * 플랜 게이팅은 응답의 available_channels 로 판단한다.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { settingsApi } from '@/api/settings'
import { useAuthStore } from '@/store/auth'
import type { SettingsPatch, SettingsOut } from '@/api/types'

export const settingsKeys = {
  all: ['settings'] as const,
  detail: ['settings', 'me'] as const,
}

/** 현재 사용자 설정 조회 */
export function useSettings() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery<SettingsOut>({
    queryKey: settingsKeys.detail,
    queryFn: () => settingsApi.get(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}

/** 부분 업데이트 + 캐시 동기화 */
export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation<SettingsOut, Error, SettingsPatch>({
    mutationFn: (patch) => settingsApi.update(patch),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.detail, data)
    },
  })
}
