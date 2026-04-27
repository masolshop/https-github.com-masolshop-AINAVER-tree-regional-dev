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
  PlaceBulkRequest,
  PlaceBulkResponse,
  PlaceBulkDeleteRequest,
  PlaceBulkDeleteResponse,
  PlaceCreate,
  PlaceCreateAuto,
  PlaceListOut,
  PlaceOut,
  PlaceSummary,
  PlaceUpdate,
  VerifyJob,
  VerifyJobCancelResponse,
  VerifyJobCreateRequest,
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

/** 일괄 등록 (Excel/CSV에서 추출한 번호 리스트). 백엔드는 동시 10개로 추출 처리.
 *  클라이언트는 500건씩 청크로 나눠 호출하므로 타임아웃은 청크 1개 기준.
 *  500건 × 평균 1.5s ÷ 동시10 ≈ 75초, 여유 240초.
 */
export const bulkCreatePlaces = (req: PlaceBulkRequest) =>
  api.post<PlaceBulkResponse>('/api/v1/places/bulk', req, {
    timeoutMs: 240_000,
  })

export const updatePlace = (id: number, req: PlaceUpdate) =>
  api.patch<PlaceOut>(`/api/v1/places/${id}`, req)

export const deletePlace = (id: number) =>
  api.del<MessageResponse>(`/api/v1/places/${id}`)

/** 일괄 삭제 — ids 배열 또는 all=true. 본인 소유만 삭제됨. */
export const bulkDeletePlaces = (req: PlaceBulkDeleteRequest) =>
  api.post<PlaceBulkDeleteResponse>('/api/v1/places/bulk-delete', req, {
    timeoutMs: 60_000,
  })

/* ─────────── Live Verification ─────────── */
export const runLiveCheck = (req: LiveCheckRequest = {}) =>
  api.post<LiveCheckResponse>('/api/v1/verify/live', req, { timeoutMs: 60_000 })

/* ─────────── Bulk Verification (대용량 청크 작업) ─────────── */
/** 새 검증 작업 생성 (사용자당 동시 1개). place_ids 비우면 전체. */
export const createVerifyJob = (req: VerifyJobCreateRequest = {}) =>
  api.post<VerifyJob>('/api/v1/verify/job', req, { timeoutMs: 15_000 })

export const getVerifyJob = (id: number) =>
  api.get<VerifyJob>(`/api/v1/verify/job/${id}`)

export const cancelVerifyJob = (id: number) =>
  api.post<VerifyJobCancelResponse>(`/api/v1/verify/job/${id}/cancel`, {})

/** 작업 완료 후 불일치 명단 .xlsx URL — fetch 로 직접 다운로드. */
export const verifyJobMismatchesUrl = (id: number) =>
  `/api/v1/verify/job/${id}/mismatches.xlsx`
