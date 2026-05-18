/**
 * xlsx 동적 로더 — 메인 번들에서 xlsx(~700KB)를 분리한다.
 *
 * 모든 페이지에서 `import * as XLSX from 'xlsx'` 대신 본 헬퍼를 사용:
 *   import { loadXLSX, downloadXlsx, parseXlsxFile } from '@/utils/xlsx'
 *
 *   const XLSX = await loadXLSX()              // 모듈 자체가 필요할 때
 *   await downloadXlsx(rows, 'export.xlsx')    // 워크시트 → 다운로드
 *   const rows = await parseXlsxFile(file)     // 파일 입력 파싱
 *
 * Vite 가 dynamic import 만 사용된 경로로 분리해 별도 청크로 코드 스플리팅한다.
 */

let _xlsxPromise: Promise<typeof import('xlsx')> | null = null

/** xlsx 모듈을 1회만 로드(이후 캐시). */
export function loadXLSX(): Promise<typeof import('xlsx')> {
  if (!_xlsxPromise) {
    _xlsxPromise = import('xlsx')
  }
  return _xlsxPromise
}

/**
 * 행 배열을 xlsx 파일로 다운로드.
 * @param rows         배열의 객체(첫 행이 헤더)
 * @param filename     파일명 (기본 export.xlsx)
 * @param sheetName    시트명 (기본 Sheet1)
 */
export async function downloadXlsx(
  rows: Record<string, unknown>[],
  filename = 'export.xlsx',
  sheetName = 'Sheet1',
): Promise<void> {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

/**
 * 사용자가 업로드한 File 객체를 첫 시트의 객체 배열로 파싱.
 * @param file   <input type=file>의 File
 * @param opts   { sheetIndex?: number, header?: 'A' | 1 | string[] }
 */
export async function parseXlsxFile<T = Record<string, unknown>>(
  file: File,
  opts: { sheetIndex?: number; header?: 'A' | 1 | string[] } = {},
): Promise<T[]> {
  const XLSX = await loadXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[opts.sheetIndex ?? 0]
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  return XLSX.utils.sheet_to_json<T>(ws, { defval: '', header: opts.header })
}

/**
 * 시트 데이터(2D 배열)를 xlsx 파일로 다운로드.
 * 헤더 행이 별도 처리되어야 할 때 사용.
 */
export async function downloadXlsxAoa(
  aoa: unknown[][],
  filename = 'export.xlsx',
  sheetName = 'Sheet1',
): Promise<void> {
  const XLSX = await loadXLSX()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
