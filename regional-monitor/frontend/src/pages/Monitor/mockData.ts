/**
 * Monitor 페이지용 임시 mock 데이터
 * 백엔드(Step B/D) 완료 시 Zustand/Query로 교체 예정
 */
import type { RegisteredPlace } from './types'

export const MOCK_PLACES: RegisteredPlace[] = [
  {
    id: 'p1',
    phone: '070-4534-9862',
    placeId: '1620925992',
    registeredDong: '서울 종로구 종로1가',
    businessName: '바비네',
    currentVerdict: 'DONG_MISMATCH',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-15T10:21:00+09:00',
  },
  {
    id: 'p2',
    phone: '070-4534-7941',
    placeId: '1358095142',
    registeredDong: '서울 강남구 역삼동',
    businessName: '대구방충망',
    currentVerdict: 'REGION_MISMATCH',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-15T10:25:00+09:00',
  },
  {
    id: 'p3',
    phone: '070-4534-2010',
    placeId: '1273908924',
    registeredDong: '서울 마포구 망원동',
    businessName: '청결한방충망',
    currentVerdict: 'REGION_MISMATCH',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-15T11:02:00+09:00',
  },
  {
    id: 'p4',
    phone: '070-4534-4274',
    placeId: '1852876162',
    registeredDong: '서울 서초구 서초동',
    businessName: '서초안마',
    currentVerdict: 'REGION_MISMATCH',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-16T09:14:00+09:00',
  },
  {
    id: 'p5',
    phone: '070-4534-5117',
    placeId: '1082735804',
    registeredDong: '서울 광진구 자양동',
    businessName: '자양세탁',
    currentVerdict: 'DONG_MISMATCH',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-16T09:30:00+09:00',
  },
  {
    id: 'p6',
    phone: '070-4534-1234',
    placeId: '1731920485',
    registeredDong: '서울 마포구 합정동',
    businessName: '합정카페',
    currentVerdict: 'OK',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-17T14:00:00+09:00',
  },
  {
    id: 'p7',
    phone: '070-4534-8821',
    placeId: '1550023741',
    registeredDong: '서울 강서구 화곡동',
    businessName: '화곡세차',
    currentVerdict: 'OK',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-18T10:45:00+09:00',
  },
  {
    id: 'p8',
    phone: '070-9999-9999',
    placeId: '9999999999',
    registeredDong: '서울 강남구 삼성동',
    businessName: '테스트업체',
    currentVerdict: 'DEAD',
    lastCheckedAt: '2026-04-27T03:00:00+09:00',
    createdAt: '2026-04-20T15:30:00+09:00',
  },
]

/* 요약 카운트 */
export function summarizePlaces(places: RegisteredPlace[]) {
  return {
    total: places.length,
    ok: places.filter((p) => p.currentVerdict === 'OK').length,
    warning: places.filter((p) =>
      ['PHONE_MISMATCH', 'DONG_MISMATCH', 'NAME_MISMATCH'].includes(p.currentVerdict),
    ).length,
    danger: places.filter((p) =>
      ['REGION_MISMATCH', 'DEAD'].includes(p.currentVerdict),
    ).length,
    pending: places.filter((p) =>
      ['PENDING', 'CHECKING'].includes(p.currentVerdict),
    ).length,
  }
}
