/**
 * 사용자 설정 API — /api/v1/settings
 */
import { api } from './client'
import type { SettingsOut, SettingsPatch } from './types'

export const settingsApi = {
  /** 현재 설정 조회 */
  get: () => api.get<SettingsOut>('/api/v1/settings'),

  /** 부분 업데이트 (보낸 필드만 반영) */
  update: (patch: SettingsPatch) =>
    api.patch<SettingsOut>('/api/v1/settings', patch),
}
