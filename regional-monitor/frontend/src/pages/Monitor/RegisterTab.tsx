/**
 * Monitor — Tab 1: 등록 관리 (실 API 연동)
 *  ┌─ 좌: 070 단건 등록 폼 (자동 추출 → 등록)
 *  ├─ 우: 엑셀/CSV 일괄 업로드 (POST /api/v1/places/bulk, 동시 5건 추출, 1회 100건)
 *  └─ 하: 등록 리스트 테이블 (검색·필터·삭제·재검증)
 */
import { lazy, Suspense, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import type { RegisteredPlace } from './types'
import {
  useCreatePlaceAuto,
  useDeletePlace,
  usePlacesList,
} from '@/hooks/usePlaces'
import { useExtractPhone } from '@/hooks/useExtract'
import { useLiveCheck } from '@/hooks/useLiveCheck'
import { ApiError } from '@/api/client'

// xlsx 라이브러리(~370KB)를 지연 로드해서 초기 번들 크기 절감
const BulkUpload = lazy(() =>
  import('./BulkUpload').then((m) => ({ default: m.BulkUpload })),
)
import {
  Phone,
  MapPin,
  Building2,
  Sparkles,
  FileSpreadsheet,
  Search,
  Trash2,
  RefreshCw,
  Plus,
  AlertTriangle,
  Loader2,
} from 'lucide-react'

export default function RegisterTab() {
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, error, refetch, isFetching } = usePlacesList()
  const deleteMut = useDeletePlace()
  const liveCheck = useLiveCheck()

  const summary = data?.summary ?? { total: 0, ok: 0, warning: 0, danger: 0, pending: 0 }
  const places = data?.items ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return places
    return places.filter(
      (p) =>
        p.phone.toLowerCase().includes(q) ||
        p.business_name.toLowerCase().includes(q) ||
        p.registered_dong.toLowerCase().includes(q) ||
        p.place_id.includes(q),
    )
  }, [places, search])

  const handleDelete = async (id: number, phone: string) => {
    if (!confirm(`${phone} 등록을 삭제하시겠습니까?`)) return
    try {
      await deleteMut.mutateAsync(id)
    } catch (e) {
      alert(`삭제 실패: ${(e as Error).message}`)
    }
  }

  const handleReverify = async (id: number, phone: string) => {
    try {
      const res = await liveCheck.mutateAsync({ place_ids: [id] })
      const r = res.results[0]
      if (r) alert(`${phone} 재검증 완료: ${r.verdict} (${r.response_ms}ms)`)
    } catch (e) {
      alert(`재검증 실패: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-6">
      {/* ───── 요약 카운트 4개 ───── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryPill label="전체 등록" value={summary.total} tone="info" />
        <SummaryPill label="정상 노출" value={summary.ok} tone="success" />
        <SummaryPill label="주의 (불일치)" value={summary.warning} tone="warning" />
        <SummaryPill label="심각 (지역/삭제)" value={summary.danger} tone="danger" />
      </div>

      {/* ───── 등록 패널 (단건 + 일괄) ───── */}
      <div className="grid grid-cols-12 gap-4">
        <Card variant="white" className="col-span-12 lg:col-span-7">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="text-h3 text-ink">단건 등록</h3>
              <p className="text-caption text-ink-muted">
                070 입력 → 자동 추출(Place ID/동/상호) → 확인 후 저장
              </p>
            </div>
          </div>

          <SingleRegisterForm />
        </Card>

        <Card variant="subtle" className="col-span-12 lg:col-span-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-2xl bg-white text-brand-600 flex items-center justify-center">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h3 className="text-h3 text-ink">엑셀/CSV 일괄 업로드</h3>
              <p className="text-caption text-ink-muted">
                CSV·TXT 파일 또는 Excel 복사·붙여넣기 (1회 최대 100건)
              </p>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="rounded-card border-2 border-dashed border-ink-watermark/40 bg-white p-6 text-center text-caption text-ink-muted">
                <Loader2 size={20} className="inline animate-spin mr-2" />
                업로드 모듈 로드 중…
              </div>
            }
          >
            <BulkUpload />
          </Suspense>
        </Card>
      </div>

      {/* ───── 등록 리스트 ───── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between gap-3 p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">등록된 070 번호</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              총 {places.length}건 등록 · 검색 결과 {filtered.length}건
              {isFetching && !isLoading && (
                <span className="text-brand-600 ml-2">(갱신 중…)</span>
              )}
            </p>
          </div>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="070 / 상호 / 동 / Place ID 검색"
              className="w-72 pl-9 pr-3 py-2 rounded-pill bg-bg-subtle/70 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                <th className="px-card-sm py-3 font-semibold">070 번호</th>
                <th className="px-3 py-3 font-semibold">Place ID</th>
                <th className="px-3 py-3 font-semibold">등록 동</th>
                <th className="px-3 py-3 font-semibold">상호</th>
                <th className="px-3 py-3 font-semibold">검증 상태</th>
                <th className="px-3 py-3 font-semibold">최근 점검</th>
                <th className="px-card-sm py-3 font-semibold text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted">
                    <Loader2 size={18} className="inline animate-spin mr-2" />
                    등록 목록 로드 중…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-card bg-red-50 text-status-danger">
                      <AlertTriangle size={14} />
                      백엔드 연결 실패: {(error as Error).message}
                      <button
                        type="button"
                        className="ml-2 underline font-semibold"
                        onClick={() => refetch()}
                      >
                        다시 시도
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted text-body-sm">
                    {search
                      ? '검색 결과가 없습니다.'
                      : '등록된 번호가 없습니다. 위에서 070을 등록해 보세요.'}
                  </td>
                </tr>
              )}
              {filtered.map((p: RegisteredPlace) => (
                <tr
                  key={p.id}
                  className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors"
                >
                  <td className="px-card-sm py-3 text-ink font-semibold tabular-nums">
                    {p.phone}
                  </td>
                  <td className="px-3 py-3 text-ink-muted tabular-nums font-mono text-caption">
                    {p.place_id}
                  </td>
                  <td className="px-3 py-3 text-ink">{p.registered_dong}</td>
                  <td
                    className="px-3 py-3 text-ink truncate max-w-[200px]"
                    title={p.business_name}
                  >
                    {p.business_name}
                  </td>
                  <td className="px-3 py-3">
                    <VerdictBadge verdict={p.current_verdict} />
                  </td>
                  <td className="px-3 py-3 text-caption text-ink-muted">
                    {p.last_checked_at
                      ? new Date(p.last_checked_at).toLocaleString('ko-KR', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-card-sm py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        title="재검증"
                        disabled={liveCheck.isPending}
                        className="w-8 h-8 rounded-xl text-ink-muted hover:bg-brand-50 hover:text-brand-600 disabled:opacity-40 transition-colors flex items-center justify-center"
                        onClick={() => handleReverify(p.id, p.phone)}
                      >
                        <RefreshCw
                          size={14}
                          className={liveCheck.isPending ? 'animate-spin' : ''}
                        />
                      </button>
                      <button
                        type="button"
                        title="삭제"
                        disabled={deleteMut.isPending}
                        className="w-8 h-8 rounded-xl text-ink-muted hover:bg-red-50 hover:text-status-danger disabled:opacity-40 transition-colors flex items-center justify-center"
                        onClick={() => handleDelete(p.id, p.phone)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ────────────── 서브 컴포넌트 ────────────── */

interface SummaryPillProps {
  label: string
  value: number
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function SummaryPill({ label, value, tone }: SummaryPillProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  return (
    <Card variant="white" className="!py-4 !px-5 flex items-center justify-between">
      <div>
        <div className="text-caption text-ink-muted mb-1">{label}</div>
        <div className="text-h2 text-ink tabular-nums leading-none">{value}</div>
      </div>
      <div className={`w-9 h-9 rounded-2xl ${toneClass} flex items-center justify-center`}>
        <span className="text-body-sm font-bold tabular-nums">{value}</span>
      </div>
    </Card>
  )
}

/**
 * 단건 등록 폼 — 070 → 자동 추출 → 확인 후 저장
 */
function SingleRegisterForm() {
  const [phone, setPhone] = useState('')
  const [dong, setDong] = useState('')
  const [name, setName] = useState('')
  const [placeId, setPlaceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [extractMs, setExtractMs] = useState<number | null>(null)

  const extractMut = useExtractPhone()
  const createMut = useCreatePlaceAuto()

  const handleAutoExtract = async () => {
    setError(null)
    if (!phone.match(/^070-?\d{3,4}-?\d{4}$/)) {
      setError('올바른 070 형식이 아닙니다. 예: 070-1234-5678')
      return
    }
    try {
      const res = await extractMut.mutateAsync({ phone })
      setExtractMs(res.response_ms)
      if (!res.success) {
        setError(`추출 실패: ${res.error ?? '알 수 없는 오류'}`)
        return
      }
      setPlaceId(res.place_id ?? '')
      // 사용자가 미리 입력한 값이 없을 때만 자동 채움
      setDong((prev) => prev || res.address || res.dong || '')
      setName((prev) => prev || res.name || '')
    } catch (e) {
      setError(formatApiError(e))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!phone) {
      setError('070 번호는 필수입니다.')
      return
    }
    try {
      await createMut.mutateAsync({
        phone,
        registered_dong_override: dong || null,
        business_name_override: name || null,
      })
      // 폼 리셋
      setPhone('')
      setDong('')
      setName('')
      setPlaceId('')
      setExtractMs(null)
    } catch (e) {
      setError(formatApiError(e))
    }
  }

  const extracting = extractMut.isPending
  const submitting = createMut.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 070 + 자동 추출 */}
      <div className="flex gap-2">
        <FieldInput
          icon={<Phone size={14} />}
          placeholder="070-1234-5678"
          value={phone}
          onChange={setPhone}
          className="flex-1"
        />
        <button
          type="button"
          onClick={handleAutoExtract}
          disabled={extracting || !phone}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill bg-brand-50 text-brand-700 font-semibold text-body-sm hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          <Sparkles size={14} className={extracting ? 'animate-spin' : ''} />
          {extracting ? '추출 중…' : '자동 추출'}
        </button>
      </div>

      {/* 등록 동 + 상호 */}
      <div className="grid grid-cols-2 gap-2">
        <FieldInput
          icon={<MapPin size={14} />}
          placeholder="등록 동 (자동 추출 또는 직접 입력)"
          value={dong}
          onChange={setDong}
        />
        <FieldInput
          icon={<Building2 size={14} />}
          placeholder="상호 (자동 추출 또는 직접 입력)"
          value={name}
          onChange={setName}
        />
      </div>

      {/* Place ID 자동 표시 */}
      {placeId && (
        <div className="text-caption text-ink-muted px-3 py-2 rounded-xl bg-brand-50/60 border border-brand-100 flex items-center gap-2">
          <Sparkles size={12} className="text-brand-500" />
          자동 추출 Place ID:{' '}
          <span className="font-mono font-bold text-brand-700">{placeId}</span>
          {extractMs !== null && (
            <span className="text-ink-soft">· {extractMs}ms</span>
          )}
        </div>
      )}

      {/* 에러 표시 */}
      {error && (
        <div className="text-caption text-status-danger px-3 py-2 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={submitting || !phone}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 size={14} className="animate-spin" /> 등록 중…
            </>
          ) : (
            <>
              <Plus size={14} /> 등록하기
            </>
          )}
        </button>
      </div>
    </form>
  )
}

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `네트워크 오류 (백엔드 연결 확인): ${e.message}`
    return `API ${e.status}: ${e.message}`
  }
  return (e as Error).message ?? '알 수 없는 오류'
}

interface FieldInputProps {
  icon: React.ReactNode
  placeholder: string
  value: string
  onChange: (v: string) => void
  className?: string
}

function FieldInput({ icon, placeholder, value, onChange, className }: FieldInputProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        {icon}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
      />
    </div>
  )
}

