/**
 * React Query hooks — 등록 플레이스(Place) 도메인
 *
 * - usePlaces()           : 전체 목록 (자동 갱신)
 * - usePlacesSummary()    : 요약 카운트만 가볍게 (Home KPI용)
 * - useCreatePlaceAuto()  : 070만 입력 → 자동 추출 → 등록
 * - useCreatePlace()      : 수동 등록(엑셀 업로드 등)
 * - useUpdatePlace()      : 동/상호 수정
 * - useDeletePlace()      : 삭제
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createPlace,
  createPlaceAuto,
  deletePlace,
  getPlacesSummary,
  listPlaces,
  updatePlace,
} from '../api/places'
import type {
  PlaceCreate,
  PlaceCreateAuto,
  PlaceUpdate,
} from '../api/types'

/* ─────────── Query keys ─────────── */
export const placeKeys = {
  all: ['places'] as const,
  list: () => [...placeKeys.all, 'list'] as const,
  summary: () => [...placeKeys.all, 'summary'] as const,
}

/* ─────────── Queries ─────────── */
export function usePlaces() {
  return useQuery({
    queryKey: placeKeys.list(),
    queryFn: listPlaces,
    staleTime: 15_000,
  })
}

/** alias — 의미를 더 명확히 (목록 전용) */
export const usePlacesList = usePlaces

export function usePlacesSummary() {
  return useQuery({
    queryKey: placeKeys.summary(),
    queryFn: getPlacesSummary,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

/* ─────────── Mutations ─────────── */
function useInvalidatePlaces() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: placeKeys.all })
  }
}

export function useCreatePlaceAuto() {
  const invalidate = useInvalidatePlaces()
  return useMutation({
    mutationFn: (req: PlaceCreateAuto) => createPlaceAuto(req),
    onSuccess: invalidate,
  })
}

export function useCreatePlace() {
  const invalidate = useInvalidatePlaces()
  return useMutation({
    mutationFn: (req: PlaceCreate) => createPlace(req),
    onSuccess: invalidate,
  })
}

export function useUpdatePlace() {
  const invalidate = useInvalidatePlaces()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PlaceUpdate }) =>
      updatePlace(id, body),
    onSuccess: invalidate,
  })
}

export function useDeletePlace() {
  const invalidate = useInvalidatePlaces()
  return useMutation({
    mutationFn: (id: number) => deletePlace(id),
    onSuccess: invalidate,
  })
}
