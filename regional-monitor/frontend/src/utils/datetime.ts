/**
 * 한국 시간(KST, UTC+9) 강제 시간 표시 유틸리티.
 *
 * 모든 시간 표시는 반드시 이 모듈을 통해야 함.
 * - 브라우저 타임존 무관, 항상 'Asia/Seoul' 로 표시
 * - 백엔드 API 가 ISO 8601 + offset 으로 보내므로 그대로 파싱
 *
 * 원칙:
 *   ❌ new Date(iso).toLocaleString('ko-KR', {...})           // 브라우저 TZ 의존
 *   ✅ formatKST(iso, { dateStyle: 'medium', ... })            // 항상 KST
 *   ✅ formatKSTDate(iso)        // YYYY-MM-DD
 *   ✅ formatKSTDateTime(iso)    // YYYY-MM-DD HH:mm
 *   ✅ formatKSTRelative(iso)    // "3분 전", "어제 14:30"
 */

const KST_TZ = 'Asia/Seoul'

/**
 * ISO 문자열을 받아 Date 객체로 파싱.
 * undefined / null / 빈 문자열은 null 반환.
 */
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 임의 옵션으로 KST 강제 포맷.
 */
export function formatKST(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
  fallback = '-',
): string {
  const d = parseIso(iso)
  if (!d) return fallback
  return d.toLocaleString('ko-KR', { timeZone: KST_TZ, ...options })
}

/**
 * YYYY-MM-DD (KST 기준).
 */
export function formatKSTDate(iso: string | null | undefined, fallback = '-'): string {
  const d = parseIso(iso)
  if (!d) return fallback
  // sv-SE 는 ISO 형식(YYYY-MM-DD HH:mm:ss)을 사용 → 안전하게 슬라이싱
  return d.toLocaleString('sv-SE', { timeZone: KST_TZ }).slice(0, 10)
}

/**
 * YYYY-MM-DD HH:mm (KST 기준, 24시간제).
 */
export function formatKSTDateTime(
  iso: string | null | undefined,
  fallback = '-',
): string {
  const d = parseIso(iso)
  if (!d) return fallback
  return d.toLocaleString('sv-SE', { timeZone: KST_TZ }).slice(0, 16)
}

/**
 * HH:mm (KST 기준, 24시간제).
 */
export function formatKSTTime(iso: string | null | undefined, fallback = '-'): string {
  const d = parseIso(iso)
  if (!d) return fallback
  return d.toLocaleTimeString('ko-KR', {
    timeZone: KST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * 한국식 친근 표시 — '방금 전', 'N분 전', 'N시간 전', '어제 14:30', 'YYYY-MM-DD'.
 */
export function formatKSTRelative(iso: string | null | undefined, fallback = '-'): string {
  const d = parseIso(iso)
  if (!d) return fallback

  const now = Date.now()
  const diffSec = Math.floor((now - d.getTime()) / 1000)

  if (diffSec < 0) {
    // 미래 시각 — 날짜+시간 표기
    return formatKSTDateTime(iso, fallback)
  }
  if (diffSec < 30) return '방금 전'
  if (diffSec < 60) return `${diffSec}초 전`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}시간 전`

  // 오늘 KST 기준 0시
  const todayKey = formatKSTDate(new Date().toISOString())
  const targetKey = formatKSTDate(iso)
  const yesterdayKey = formatKSTDate(new Date(now - 86_400_000).toISOString())

  if (targetKey === todayKey) {
    return `오늘 ${formatKSTTime(iso)}`
  }
  if (targetKey === yesterdayKey) {
    return `어제 ${formatKSTTime(iso)}`
  }
  if (diffSec < 7 * 86_400) {
    return `${Math.floor(diffSec / 86_400)}일 전`
  }
  return targetKey // YYYY-MM-DD
}

/**
 * 현재 한국 시각의 YYYY-MM-DD (파일명·기본값 등에 사용).
 */
export function todayKST(): string {
  return formatKSTDate(new Date().toISOString())
}

/**
 * 디버그용 — 현재 KST 시각 ISO 문자열.
 */
export function nowKSTIso(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: KST_TZ }).replace(' ', 'T') + '+09:00'
}
