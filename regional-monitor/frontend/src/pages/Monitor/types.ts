/**
 * Monitor 페이지 공통 타입 정의
 * 백엔드 연동 시 그대로 API 스키마로 사용 예정
 */

export type Verdict =
  | 'OK'                  // 4중 검증 모두 통과 (정상 노출)
  | 'PHONE_MISMATCH'      // 등록 070과 실제 표시 전화 불일치
  | 'DONG_MISMATCH'       // 등록 동과 실제 동 불일치
  | 'NAME_MISMATCH'       // 등록 상호와 실제 상호 불일치
  | 'REGION_MISMATCH'     // 시/도 단위 불일치 (가장 심각한 동 오류)
  | 'DEAD'                // 플레이스 페이지 자체가 사라짐 (404)
  | 'PENDING'             // 아직 검증 전
  | 'CHECKING'            // 검증 진행 중

export interface RegisteredPlace {
  id: string
  phone: string                  // 070-XXXX-XXXX
  placeId: string                // 네이버 플레이스 ID
  registeredDong: string         // 등록 시점 동 (예: '서울 종로구 종로1가')
  businessName: string           // 등록 상호
  currentVerdict: Verdict
  lastCheckedAt: string | null   // ISO datetime
  createdAt: string
}

export interface VerdictDetail {
  alive: boolean        // 페이지 살아있음
  phoneMatch: boolean   // 전화 일치
  dongMatch: boolean    // 동 일치
  nameMatch: boolean    // 상호 일치
  actualPhone?: string
  actualDong?: string
  actualName?: string
}

/* ─────────── UI 표기 매핑 ─────────── */
export const VERDICT_LABEL: Record<Verdict, string> = {
  OK: '정상 노출',
  PHONE_MISMATCH: '전화 불일치',
  DONG_MISMATCH: '동 불일치',
  NAME_MISMATCH: '상호 불일치',
  REGION_MISMATCH: '지역 불일치',
  DEAD: '페이지 삭제',
  PENDING: '검증 대기',
  CHECKING: '검증 중',
}

export const VERDICT_TONE: Record<Verdict, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  OK: 'success',
  PHONE_MISMATCH: 'warning',
  DONG_MISMATCH: 'warning',
  NAME_MISMATCH: 'warning',
  REGION_MISMATCH: 'danger',
  DEAD: 'danger',
  PENDING: 'neutral',
  CHECKING: 'info',
}
