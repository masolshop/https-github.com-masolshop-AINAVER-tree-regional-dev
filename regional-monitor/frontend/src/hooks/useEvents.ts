/**
 * 변경 이벤트 React Query 훅
 *
 *  - useEvents(limit)      : 변경 이력 조회 (auto refresh 60s)
 *  - useUnreadCount()      : 미열람 카운트 (TopBar 종 배지, 30s polling)
 *  - useMarkEventsRead()   : 모두 읽음 처리
 *  - useSchedulerStatus()  : 다음 자동 검증 시각 (KST)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { eventsApi } from '@/api/events'
import { useAuthStore } from '@/store/auth'

export const eventKeys = {
  all: ['events'] as const,
  list: (limit: number) => ['events', 'list', limit] as const,
  unread: ['events', 'unread'] as const,
  scheduler: ['scheduler', 'status'] as const,
}

/** 변경 이력 — Monitor/History 페이지에서 사용 */
export function useEvents(limit = 50) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: eventKeys.list(limit),
    queryFn: () => eventsApi.list(limit),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,           // 1분마다 백그라운드 갱신
    refetchOnWindowFocus: true,
  })
}

/** TopBar 종 배지 — 미열람 카운트 (30s polling) */
export function useUnreadCount() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: eventKeys.unread,
    queryFn: () => eventsApi.unread(),
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** 모두 읽음 처리 → unread/list 캐시 무효화 */
export function useMarkEventsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => eventsApi.markRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventKeys.all })
    },
  })
}

/** 자동 검증 스케줄러 상태 (Home / 마이페이지 노출용) */
export function useSchedulerStatus() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: eventKeys.scheduler,
    queryFn: () => eventsApi.schedulerStatus(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,             // 5분
  })
}
