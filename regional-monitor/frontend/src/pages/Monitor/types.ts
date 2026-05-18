/**
 * Monitor 페이지 공통 타입 + UI 매핑
 * 백엔드 스키마(VerdictType, PlaceOut 등)와 1:1 호환되도록 정의.
 */
import type { ApiVerdict, PlaceOut } from '@/api/types'

/* 백엔드 ApiVerdict을 그대로 재노출 (이전 코드 호환) */
export type Verdict = ApiVerdict

/* 등록 정보 = 백엔드 PlaceOut 전체. 컴포넌트 내부에서 직접 사용 */
export type RegisteredPlace = PlaceOut

/* 4중 검증 상세 (UI에서만 사용 — 별도 컴포넌트로 변환 시 활용) */
export interface VerdictDetail {
  alive: boolean
  phoneMatch: boolean
  dongMatch: boolean
  nameMatch: boolean
  actualPhone?: string | null
  actualDong?: string | null
  actualName?: string | null
  actualAddress?: string | null
}

/* ─────────── UI 표기 매핑 ─────────── */
export const VERDICT_LABEL: Record<Verdict, string> = {
  OK: '정상 노출',
  // 변경 노출 (정상): 처음 등록 후 재노출 과정에서 발생하는 데이터 변경
  // 네이버 플레이스 ID 가 살아있으므로 정상 노출의 일종
  PHONE_MISMATCH: '변경 노출',
  DONG_MISMATCH: '변경 노출',
  REGION_MISMATCH: '변경 노출',
  // 상호는 실제 업체 변경 가능성이 있어 별도 분류 유지
  NAME_MISMATCH: '상호 불일치',
  DEAD: '네이버 미노출',
  PENDING: '검증 대기',
  CHECKING: '검증 중',
}

/**
 * 톤 매핑 — 용어 통일 정책 (변경 노출 정책):
 * - 정상 노출: OK
 * - 변경 노출 (info, 정상의 일종): PHONE/DONG/REGION 변경
 *   → Place ID 가 살아있으므로 네이버 노출 자체는 정상
 * - 상호 불일치 (warning): NAME 변경만 별도 — 실제 업체 변경 가능성
 * - 네이버 미노출 (danger): DEAD (페이지 삭제)
 */
export const VERDICT_TONE: Record<
  Verdict,
  'success' | 'warning' | 'danger' | 'neutral' | 'info'
> = {
  OK: 'success',
  PHONE_MISMATCH: 'info',
  DONG_MISMATCH: 'info',
  REGION_MISMATCH: 'info',
  NAME_MISMATCH: 'warning',
  DEAD: 'danger',
  PENDING: 'neutral',
  CHECKING: 'info',
}
