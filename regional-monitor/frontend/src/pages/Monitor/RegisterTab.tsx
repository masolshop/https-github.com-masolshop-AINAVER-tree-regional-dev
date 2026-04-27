/**
 * Monitor — Tab 1: 등록 관리 (실 API 연동)
 *  ┌─ 상: 엑셀/CSV 일괄 업로드 (메인 등록 방식)
 *  │       POST /api/v1/places/bulk · 동시 5건 추출 · 1회 100건
 *  └─ 하: 등록 리스트 테이블 (체크박스 다중 선택 → 선택 삭제 / 모두 삭제 / 재검증)
 *
 *  ※ 단건 등록 폼은 v2 에서 제거됨 (대량 등록 워크플로우로 일원화)
 */
import { lazy, Suspense, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import type { RegisteredPlace } from './types'
import {
  useBulkDeletePlaces,
  useDeletePlace,
  usePlacesList,
} from '@/hooks/usePlaces'
import { useLiveCheck } from '@/hooks/useLiveCheck'

// xlsx 라이브러리(~370KB)를 지연 로드해서 초기 번들 크기 절감
const BulkUpload = lazy(() =>
  import('./BulkUpload').then((m) => ({ default: m.BulkUpload })),
)
import {
  FileSpreadsheet,
  Search,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckSquare,
  Square,
  XCircle,
} from 'lucide-react'

export default function RegisterTab() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const { data, isLoading, isError, error, refetch, isFetching } = usePlacesList()
  const deleteMut = useDeletePlace()
  const bulkDeleteMut = useBulkDeletePlaces()
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

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id))
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((p) => selected.has(p.id))

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        // 현재 보이는 것만 모두 해제
        filtered.forEach((p) => next.delete(p.id))
      } else {
        // 현재 보이는 것 모두 선택
        filtered.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const handleDelete = async (id: number, phone: string) => {
    if (!confirm(`${phone} 등록을 삭제하시겠습니까?`)) return
    try {
      await deleteMut.mutateAsync(id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (e) {
      alert(`삭제 실패: ${(e as Error).message}`)
    }
  }

  const handleBulkDeleteSelected = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (
      !confirm(
        `선택한 ${ids.length}건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      )
    )
      return
    try {
      const res = await bulkDeleteMut.mutateAsync({ ids })
      clearSelection()
      alert(
        `✅ 일괄 삭제 완료\n` +
          `요청: ${res.requested}건\n` +
          `삭제: ${res.deleted}건` +
          (res.not_found ? `\n찾을 수 없음: ${res.not_found}건` : '') +
          `\n소요: ${res.elapsed_ms}ms`,
      )
    } catch (e) {
      alert(`일괄 삭제 실패: ${(e as Error).message}`)
    }
  }

  const handleDeleteAll = async () => {
    const total = places.length
    if (total === 0) return
    const first = confirm(
      `⚠️ 등록된 모든 070 번호 ${total}건을 삭제합니다.\n이 작업은 되돌릴 수 없습니다.\n\n계속하시겠습니까?`,
    )
    if (!first) return
    const text = prompt(
      `최종 확인을 위해 "DELETE ALL" 을 정확히 입력해주세요.`,
      '',
    )
    if (text !== 'DELETE ALL') {
      if (text !== null) alert('확인 문구가 일치하지 않아 취소되었습니다.')
      return
    }
    try {
      const res = await bulkDeleteMut.mutateAsync({ all: true })
      clearSelection()
      alert(
        `✅ 모두 삭제 완료\n삭제: ${res.deleted}건\n소요: ${res.elapsed_ms}ms`,
      )
    } catch (e) {
      alert(`전체 삭제 실패: ${(e as Error).message}`)
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

      {/* ───── 등록 패널 (엑셀/CSV 일괄 업로드 — 메인) ───── */}
      <Card variant="white">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <FileSpreadsheet size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-h3 text-ink">엑셀 / CSV 대량 등록</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              엑셀에서 070 번호 열을 복사·붙여넣기 하거나 CSV·TXT 파일을 업로드하세요. 한 번에
              최대 100건 · 동시 5건 자동 추출(Place ID/동/상호) → 일괄 저장.
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="rounded-card border-2 border-dashed border-ink-watermark/40 bg-bg-subtle/40 p-8 text-center text-caption text-ink-muted">
              <Loader2 size={20} className="inline animate-spin mr-2" />
              업로드 모듈 로드 중…
            </div>
          }
        >
          <BulkUpload />
        </Suspense>
      </Card>

      {/* ───── 등록 리스트 ───── */}
      <Card variant="white" noPadding>
        <div className="flex flex-wrap items-center justify-between gap-3 p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">등록된 070 번호</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              총 {places.length}건 등록 · 검색 결과 {filtered.length}건
              {selected.size > 0 && (
                <span className="text-brand-700 ml-2 font-semibold">
                  · {selected.size}건 선택됨
                </span>
              )}
              {isFetching && !isLoading && (
                <span className="text-brand-600 ml-2">(갱신 중…)</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* 일괄 삭제 액션 (선택 있음 / 없음에 따라 노출) */}
            {selected.size > 0 ? (
              <>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-pill bg-bg-subtle text-ink-muted hover:text-ink hover:bg-bg-subtle/80 text-caption font-semibold transition-colors"
                >
                  <XCircle size={14} />
                  선택 해제
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteSelected}
                  disabled={bulkDeleteMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-pill bg-red-50 text-status-danger hover:bg-red-100 disabled:opacity-50 text-caption font-bold transition-colors"
                >
                  {bulkDeleteMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  선택 {selected.size}건 삭제
                </button>
              </>
            ) : (
              places.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  disabled={bulkDeleteMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-pill bg-bg-subtle text-ink-muted hover:bg-red-50 hover:text-status-danger disabled:opacity-50 text-caption font-semibold transition-colors"
                  title="등록된 모든 070 번호를 삭제합니다 (확인 다이얼로그 포함)"
                >
                  <Trash2 size={14} />
                  전체 삭제
                </button>
              )
            )}

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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                <th className="pl-card-sm pr-2 py-3 font-semibold w-10">
                  <button
                    type="button"
                    onClick={toggleAllFiltered}
                    disabled={filtered.length === 0}
                    className="text-ink-muted hover:text-brand-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title={
                      allFilteredSelected ? '현재 목록 모두 해제' : '현재 목록 모두 선택'
                    }
                  >
                    {allFilteredSelected ? (
                      <CheckSquare size={16} className="text-brand-600" />
                    ) : someFilteredSelected ? (
                      <CheckSquare size={16} className="text-brand-300" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th className="px-2 py-3 font-semibold">070 번호</th>
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
                  <td colSpan={8} className="text-center py-12 text-ink-muted">
                    <Loader2 size={18} className="inline animate-spin mr-2" />
                    등록 목록 로드 중…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={8} className="text-center py-12">
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
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-body-sm">
                    {search
                      ? '검색 결과가 없습니다.'
                      : '등록된 번호가 없습니다. 위에서 엑셀/CSV로 대량 등록해 보세요.'}
                  </td>
                </tr>
              )}
              {filtered.map((p: RegisteredPlace) => {
                const checked = selected.has(p.id)
                return (
                  <tr
                    key={p.id}
                    onClick={() => toggleOne(p.id)}
                    className={`border-b border-bg-subtle/60 cursor-pointer transition-colors ${
                      checked
                        ? 'bg-brand-50/60 hover:bg-brand-50'
                        : 'hover:bg-bg-subtle/40'
                    }`}
                  >
                    <td className="pl-card-sm pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => toggleOne(p.id)}
                        className="text-ink-muted hover:text-brand-600 transition-colors"
                      >
                        {checked ? (
                          <CheckSquare size={16} className="text-brand-600" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-3 text-ink font-semibold tabular-nums">
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
                    <td
                      className="px-card-sm py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                )
              })}
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
