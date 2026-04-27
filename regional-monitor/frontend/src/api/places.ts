/**
 * Places & Extract & Verify API 함수
 *
 * 모든 엔드포인트는 백엔드 FastAPI(/api/v1/...)와 1:1 매칭.
 * React Query hooks(`src/hooks/usePlaces.ts`)에서 호출한다.
 */
import { api } from './client'
import type {
  ExtractRequest,
  ExtractResponse,
  LiveCheckRequest,
  LiveCheckResponse,
  MessageResponse,
  PlaceCreate,
  PlaceCreateAuto,
  PlaceListOut,
  PlaceOut,
  PlaceSummary,
  PlaceUpdate,
} from './types'

/* ─────────── Extract ─────────── */
export const extractPhone = (req: ExtractRequest) =>
  api.post<ExtractResponse>('/api/v1/extract/phone', req, { timeoutMs: 15_000 })

/* ─────────── Places CRUD ─────────── */
export const listPlaces = () => api.get<PlaceListOut>('/api/v1/places')

export const getPlacesSummary = () =>
  api.get<PlaceSummary>('/api/v1/places/summary')

export const createPlace = (req: PlaceCreate) =>
  api.post<PlaceOut>('/api/v1/places', req)

export const createPlaceAuto = (req: PlaceCreateAuto) =>
  api.post<PlaceOut>('/api/v1/places/auto', req, { timeoutMs: 15_000 })

export const updatePlace = (id: number, req: PlaceUpdate) =>
  api.patch<PlaceOut>(`/api/v1/places/${id}`, req)

export const deletePlace = (id: number) =>
  api.del<MessageResponse>(`/api/v1/places/${id}`)

/* ─────────── Live Verification ─────────── */
export const runLiveCheck = (req: LiveCheckRequest = {}) =>
  api.post<LiveCheckResponse>('/api/v1/verify/live', req, { timeoutMs: 60_000 })
