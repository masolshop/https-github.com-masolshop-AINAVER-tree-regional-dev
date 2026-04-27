/**
 * BulkUpload — 엑셀(.xlsx/.xls) / CSV 일괄 등록 컴포넌트
 *
 * 흐름:
 *   1) 파일 드롭/선택
 *   2) 클라이언트에서 파싱 (xlsx for binary, 자체 CSV 파서)
 *      - 첫 행이 헤더로 보이면 자동 감지하여 'phone' / '070' / '전화' 컬럼 인식
 *      - 헤더 없으면 첫 컬럼을 phone 으로 사용
 *   3) 추출된 phone 미리보기 (최대 10개)
 *   4) "업로드 시작" → POST /api/v1/places/bulk
 *   5) 행별 결과 테이블 (status: created/duplicate/invalid_phone/extract_failed/quota_exceeded)
 *
 * 백엔드 제한: rows 1~100건. 100건 초과 시 클라이언트에서 자동 분할(미구현 — 100건 안내).
 */
import { useRef, useState } from 'react'
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  FileWarning,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import clsx from 'clsx'

import { useBulkCreatePlaces } from '@/hooks/usePlaces'
import { ApiError } from '@/api/client'
import type { PlaceBulkResponse, BulkRowStatusKey } from '@/api/types'

const MAX_ROWS = 100
const HEADER_PHONE_KEYS = ['phone', '070', '전화', '전화번호', '번호']
const HEADER_DONG_KEYS = ['dong', '동', '등록동', '주소', 'address']
const HEADER_NAME_KEYS = ['name', '상호', '상호명', '업체명', 'business']

interface ParsedRow {
  phone: string
  dong?: string
  name?: string
  source_row: number              // 1-based 원본 엑셀 행 번호
}

export function BulkUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [response, setResponse] = useState<PlaceBulkResponse | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const bulkMut = useBulkCreatePlaces()

  // ─────────────── 파싱 ───────────────
  const handleFile = async (f: File) => {
    setFile(f)
    setRows([])
    setParseError(null)
    setResponse(null)
    setSubmitError(null)
    try {
      const parsed = await parseFile(f)
      if (parsed.length === 0) {
        setParseError('파일에서 070 번호를 찾을 수 없습니다. phone / 070 / 전화 컬럼을 확인해주세요.')
        return
      }
      if (parsed.length > MAX_ROWS) {
        setParseError(
          `한 번에 최대 ${MAX_ROWS}건까지만 업로드할 수 있습니다 (입력: ${parsed.length}건). 파일을 분할해주세요.`,
        )
        return
      }
      setRows(parsed)
    } catch (e) {
      setParseError(`파일 파싱 실패: ${(e as Error).message}`)
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (rows.length === 0) return
    try {
      const res = await bulkMut.mutateAsync({
        rows: rows.map((r) => ({
          phone: r.phone,
          registered_dong_override: r.dong || null,
          business_name_override: r.name || null,
        })),
      })
      setResponse(res)
    } catch (e) {
      if (e instanceof ApiError) setSubmitError(`${e.status}: ${e.message}`)
      else setSubmitError((e as Error).message)
    }
  }

  const reset = () => {
    setFile(null)
    setRows([])
    setParseError(null)
    setResponse(null)
    setSubmitError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ─────────────── 렌더 ───────────────

  // 결과 화면
  if (response) {
    return <BulkResultPanel response={response} onClose={reset} />
  }

  return (
    <div className="space-y-3">
      {/* 드롭존 */}
      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) void handleFile(f)
          }}
          onClick={() => inputRef.current?.click()}
          className={clsx(
            'relative rounded-card border-2 border-dashed transition-all p-6 text-center cursor-pointer',
            dragOver
              ? 'border-brand-500 bg-brand-50/50'
              : 'border-ink-watermark/50 bg-white hover:border-brand-300',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <div className="w-12 h-12 mx-auto rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
            <Upload size={20} />
          </div>
          <div className="text-body-sm text-ink font-semibold">
            엑셀(.xlsx / .xls) 또는 CSV 파일을 드롭하거나 클릭
          </div>
          <div className="text-caption text-ink-muted mt-1">
            phone(070) 컬럼 필수 · 등록동/상호 컬럼은 선택 · 최대 {MAX_ROWS}건
          </div>
        </div>
      )}

      {/* 파일 선택 후 */}
      {file && !response && (
        <div className="rounded-card bg-white border border-bg-subtle p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-ink truncate">
                  {file.name}
                </div>
                <div className="text-caption text-ink-muted">
                  {(file.size / 1024).toFixed(1)} KB · {rows.length}건 추출됨
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="w-8 h-8 rounded-xl text-ink-muted hover:bg-bg-subtle"
              title="초기화"
            >
              <X size={14} className="mx-auto" />
            </button>
          </div>

          {parseError && (
            <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-status-danger text-caption flex items-center gap-2">
              <FileWarning size={12} />
              {parseError}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="rounded-xl bg-bg-subtle/40 p-3 max-h-48 overflow-y-auto mb-3">
                <table className="w-full text-caption">
                  <thead>
                    <tr className="text-ink-muted">
                      <th className="text-left font-semibold pb-1.5">#</th>
                      <th className="text-left font-semibold pb-1.5">phone</th>
                      <th className="text-left font-semibold pb-1.5">dong</th>
                      <th className="text-left font-semibold pb-1.5">name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r) => (
                      <tr key={r.source_row} className="border-t border-bg-subtle/60">
                        <td className="py-1 text-ink-muted">{r.source_row}</td>
                        <td className="py-1 font-mono text-ink">{r.phone}</td>
                        <td className="py-1 text-ink-muted truncate max-w-[120px]">
                          {r.dong || '—'}
                        </td>
                        <td className="py-1 text-ink-muted truncate max-w-[160px]">
                          {r.name || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 10 && (
                  <div className="text-caption text-ink-muted mt-2 text-center">
                    … 및 {rows.length - 10}건 더
                  </div>
                )}
              </div>

              {submitError && (
                <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-status-danger text-caption flex items-center gap-2">
                  <AlertTriangle size={12} />
                  {submitError}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={bulkMut.isPending}
                className="w-full btn-primary justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkMut.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {rows.length}건 처리 중… (예상 {Math.ceil(rows.length * 0.4)}초)
                  </>
                ) : (
                  <>
                    <Upload size={14} /> {rows.length}건 일괄 등록 시작
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}

      {/* 푸터 */}
      <div className="flex items-center justify-between text-caption">
        <span className="text-ink-muted">
          컬럼: phone(필수) / dong / name — 헤더 자동 인식
        </span>
        <button
          type="button"
          onClick={downloadSample}
          className="inline-flex items-center gap-1.5 text-brand-600 font-semibold hover:underline"
        >
          <Download size={12} /> 샘플 CSV 다운로드
        </button>
      </div>
    </div>
  )
}

/* ─────────────── 결과 패널 ─────────────── */

function BulkResultPanel({
  response,
  onClose,
}: {
  response: PlaceBulkResponse
  onClose: () => void
}) {
  const tones: Record<BulkRowStatusKey, string> = {
    created: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    duplicate: 'bg-amber-50 text-amber-700 border-amber-200',
    invalid_phone: 'bg-red-50 text-red-700 border-red-200',
    extract_failed: 'bg-red-50 text-red-700 border-red-200',
    quota_exceeded: 'bg-amber-50 text-amber-700 border-amber-200',
  }
  const labels: Record<BulkRowStatusKey, string> = {
    created: '등록됨',
    duplicate: '중복',
    invalid_phone: '형식 오류',
    extract_failed: '추출 실패',
    quota_exceeded: '한도 초과',
  }

  return (
    <div className="rounded-card bg-white border border-bg-subtle p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 size={16} />
          </div>
          <div>
            <div className="text-body font-bold text-ink">일괄 등록 완료</div>
            <div className="text-caption text-ink-muted">
              요청 {response.requested}건 · 처리 {response.elapsed_ms}ms · 남은 한도{' '}
              {response.quota_remaining}건
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-pill bg-bg-subtle hover:bg-brand-100 text-body-sm font-semibold text-ink"
        >
          새 파일 업로드
        </button>
      </div>

      {/* 합계 칩 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <StatChip label="등록됨" count={response.created} icon={<CheckCircle2 size={12} />} tone="success" />
        <StatChip label="중복" count={response.duplicate} icon={<AlertCircle size={12} />} tone="warning" />
        <StatChip label="형식 오류" count={response.invalid_phone} icon={<XCircle size={12} />} tone="danger" />
        <StatChip label="추출 실패" count={response.extract_failed} icon={<XCircle size={12} />} tone="danger" />
        <StatChip label="한도 초과" count={response.quota_exceeded} icon={<AlertCircle size={12} />} tone="warning" />
      </div>

      {/* 행별 결과 */}
      <div className="rounded-xl bg-bg-subtle/40 max-h-[300px] overflow-y-auto">
        <table className="w-full text-caption">
          <thead className="sticky top-0 bg-bg-subtle/90 backdrop-blur">
            <tr className="text-ink-muted">
              <th className="text-left font-semibold py-2 px-3">#</th>
              <th className="text-left font-semibold py-2 px-3">phone</th>
              <th className="text-left font-semibold py-2 px-3">결과</th>
              <th className="text-left font-semibold py-2 px-3">상호 / 사유</th>
            </tr>
          </thead>
          <tbody>
            {response.rows.map((r, i) => (
              <tr key={i} className="border-t border-bg-subtle/60">
                <td className="py-2 px-3 text-ink-muted">{i + 1}</td>
                <td className="py-2 px-3 font-mono text-ink">{r.phone}</td>
                <td className="py-2 px-3">
                  <span
                    className={clsx(
                      'inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border',
                      tones[r.status],
                    )}
                  >
                    {labels[r.status] ?? r.status}
                  </span>
                </td>
                <td className="py-2 px-3 text-ink-muted truncate max-w-[260px]">
                  {r.business_name || r.error || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatChip({
  label,
  count,
  icon,
  tone,
}: {
  label: string
  count: number
  icon: React.ReactNode
  tone: 'success' | 'warning' | 'danger'
}) {
  const cls = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  }[tone]
  return (
    <div className={clsx('rounded-xl px-3 py-2 flex items-center gap-2', cls)}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold opacity-75 truncate">{label}</div>
        <div className="text-body font-extrabold tabular-nums leading-none">{count}</div>
      </div>
    </div>
  )
}

/* ─────────────── 파싱 유틸 ─────────────── */

async function parseFile(file: File): Promise<ParsedRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'csv') {
    const text = await file.text()
    return parseCSV(text)
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer()
    return parseXLSX(buf)
  }
  throw new Error('지원하지 않는 파일 형식입니다. .xlsx, .xls, .csv 만 가능합니다.')
}

/** 간단한 RFC 4180 CSV 파서 (큰따옴표 escape 지원). */
function parseCSV(text: string): ParsedRow[] {
  const lines = splitCSVLines(text).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []

  const cells = lines.map(splitCSVRow)
  return rowsToParsed(cells)
}

function splitCSVLines(text: string): string[] {
  // 큰따옴표 안의 줄바꿈은 무시하고 행 단위로 자른다.
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuote = !inQuote
      cur += ch
      continue
    }
    if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur) out.push(cur)
      cur = ''
      // \r\n 처리
      if (ch === '\r' && text[i + 1] === '\n') i++
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function splitCSVRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'                       // escaped quote
        i++
        continue
      }
      inQuote = !inQuote
      continue
    }
    if (ch === ',' && !inQuote) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** xlsx 라이브러리로 파싱 → 첫 시트의 cell 배열을 ParsedRow 로 변환 */
function parseXLSX(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const cells = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
  })
  return rowsToParsed(cells.map((row) => row.map((c) => String(c ?? '').trim())))
}

/** 헤더 인식 → ParsedRow 배열 변환 */
function rowsToParsed(cells: string[][]): ParsedRow[] {
  if (cells.length === 0) return []

  const first = cells[0].map((c) => c.toLowerCase())
  const headerHasPhone = first.some((c) => HEADER_PHONE_KEYS.some((k) => c.includes(k)))

  let phoneIdx = 0
  let dongIdx = -1
  let nameIdx = -1
  let dataRows: string[][]

  if (headerHasPhone) {
    phoneIdx = first.findIndex((c) => HEADER_PHONE_KEYS.some((k) => c.includes(k)))
    dongIdx = first.findIndex((c) => HEADER_DONG_KEYS.some((k) => c.includes(k)))
    nameIdx = first.findIndex((c) => HEADER_NAME_KEYS.some((k) => c.includes(k)))
    dataRows = cells.slice(1)
  } else {
    // 헤더 없음 → 첫 컬럼이 phone, 둘째 dong, 셋째 name 으로 가정
    phoneIdx = 0
    dongIdx = cells[0].length > 1 ? 1 : -1
    nameIdx = cells[0].length > 2 ? 2 : -1
    dataRows = cells
  }

  const out: ParsedRow[] = []
  dataRows.forEach((row, i) => {
    const phone = (row[phoneIdx] ?? '').trim()
    if (!phone) return
    out.push({
      phone,
      dong: dongIdx >= 0 ? (row[dongIdx] ?? '').trim() || undefined : undefined,
      name: nameIdx >= 0 ? (row[nameIdx] ?? '').trim() || undefined : undefined,
      source_row: headerHasPhone ? i + 2 : i + 1,
    })
  })
  return out
}

function downloadSample() {
  const csv = [
    'phone,dong,name',
    '070-4534-9862,서울 종로구 홍지동,바비네',
    '070-1234-5678,경기 분당,홍길동가구',
    '070-9876-5432,,             ',
  ].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'regional-monitor-bulk-sample.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
