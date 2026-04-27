/**
 * 변경 이벤트 API — /api/v1/events/*, /api/v1/scheduler/*
 */
import { api } from './client'
import type {
  EventListOut,
  UnreadCountOut,
  SchedulerStatusOut,
  MessageResponse,
} from './types'

export const eventsApi = {
  /** 내 변경 이력 (최신순, limit ≤ 200) */
  list: (limit = 50) =>
    api.get<EventListOut>(`/api/v1/events?limit=${limit}`),

  /** 미열람 카운트 (TopBar 종 배지) */
  unread: () => api.get<UnreadCountOut>('/api/v1/events/unread'),

  /** 모두 읽음 처리 */
  markRead: () => api.post<MessageResponse>('/api/v1/events/mark-read'),

  /** 내 검증 슬롯 + 다음 실행 시각 */
  schedulerStatus: () =>
    api.get<SchedulerStatusOut>('/api/v1/scheduler/status'),
}
