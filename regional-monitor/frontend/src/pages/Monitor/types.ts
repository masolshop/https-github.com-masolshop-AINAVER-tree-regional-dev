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
  PHONE_MISMATCH: '전화 불일치',
  DONG_MISMATCH: '동 불일치',
  NAME_MISMATCH: '상호 불일치',
  REGION_MISMATCH: '지역 불일치',
  DEAD: '네이버 미노출',
  PENDING: '검증 대기',
  CHECKING: '검증 중',
}

/**
 * 톤 매핑 — 용어 통일 정책에 따라:
 * - 주의(불일치): PHONE/DONG/NAME/REGION 모든 불일치 → warning
 * - 네이버 미노출: DEAD (페이지 삭제) → danger
 */
export const VERDICT_TONE: Record<
  Verdict,
  'success' | 'warning' | 'danger' | 'neutral' | 'info'
> = {
  OK: 'success',
  PHONE_MISMATCH: 'warning',
  DONG_MISMATCH: 'warning',
  NAME_MISMATCH: 'warning',
  REGION_MISMATCH: 'warning',
  DEAD: 'danger',
  PENDING: 'neutral',
  CHECKING: 'info',
}
