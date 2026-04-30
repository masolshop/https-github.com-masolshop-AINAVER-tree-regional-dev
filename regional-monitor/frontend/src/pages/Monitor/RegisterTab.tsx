/**
 * Monitor — Tab 1: 등록 관리 (실 API 연동)
 *
 *  ┌─ 메인: 엑셀/CSV 일괄 업로드 (POST /api/v1/places/bulk, 동시 10건 추출, 500건씩 청크 분할)
 *  └─ 하단: 등록 리스트 테이블
 *           · 검색 / 재검증 / 단건 삭제
 *           · 체크박스 다중 선택 + 선택 일괄 삭제 + 전체 삭제
 *
 * 단건 등록 폼은 제거됨 (대량 등록 워크플로우가 메인).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import type { RegisteredPlace } from './types'
import {
  useDeletePlace,
  useBulkDeletePlaces,
  usePlacesList,
} from '@/hooks/usePlaces'
import { useLiveCheck } from '@/hooks/useLiveCheck'
import { ApiError } from '@/api/client'

// xlsx 라이브러리(~370KB)를 지연 로드해서 초기 번들 크기 절감
const BulkUpload = lazy(() =>
  import('./BulkUpload').then((m) => ({ default: m.BulkUpload })),
)
// 대용량 검증 진행률 모달
import { VerifyJobModal } from './VerifyJobModal'
import { formatKSTDateTime, formatKSTRelative, todayKST } from '@/utils/datetime'
import {
  FileSpreadsheet,
  Search,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckSquare,
  Square,
  Trash,
  FileDown,
  Zap,
} from 'lucide-react'

/* ─────────── 불일치 판별 ─────────── */
/**
 * "불일치"로 간주할 verdict 집합.
 * - OK / PENDING / CHECKING 은 제외 (정상이거나 아직 미검증)
 * - PHONE/DONG/NAME_MISMATCH (warning)
 * - REGION_MISMATCH / DEAD (danger)
 */
const MISMATCH_VERDICTS = new Set([
  'PHONE_MISMATCH',
  'DONG_MISMATCH',
  'NAME_MISMATCH',
  'REGION_MISMATCH',
  'DEAD',
])

/* ─────────── 상태 필터 (요약 카드 클릭) ─────────── */
type StatusFilter = 'all' | 'ok' | 'warning' | 'danger'

const WARNING_VERDICTS = new Set(['PHONE_MISMATCH', 'DONG_MISMATCH', 'NAME_MISMATCH'])
const DANGER_VERDICTS = new Set(['REGION_MISMATCH', 'DEAD'])

/** 상태 필터에 해당하는 등록만 추출. */
function matchStatusFilter(p: RegisteredPlace, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'ok') return p.current_verdict === 'OK'
  if (filter === 'warning') return WARNING_VERDICTS.has(p.current_verdict)
  if (filter === 'danger') return DANGER_VERDICTS.has(p.current_verdict)
  return true
}

/* ko-KR 라벨 (xlsx 시트용) */
const VERDICT_LABEL_KO: Record<string, string> = {
  OK: '정상 노출',
  PHONE_MISMATCH: '전화 불일치',
  DONG_MISMATCH: '동 불일치',
  NAME_MISMATCH: '상호 불일치',
  REGION_MISMATCH: '지역 불일치',
  DEAD: '페이지 삭제',
  PENDING: '검증 대기',
  CHECKING: '검증 중',
}

export default function RegisterTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [downloading, setDownloading] = useState(false)
  // 대량 검증 모달
  const [verifyJobOpen, setVerifyJobOpen] = useState(false)
  const [verifyJobIds, setVerifyJobIds] = useState<number[] | undefined>(undefined)
  const { data, isLoading, isError, error, refetch, isFetching } = usePlacesList()
  const deleteMut = useDeletePlace()
  const bulkDeleteMut = useBulkDeletePlaces()
  const liveCheck = useLiveCheck()

  const summary = data?.summary ?? { total: 0, ok: 0, warning: 0, danger: 0, pending: 0 }
  const places = data?.items ?? []

  /** 불일치 항목만 추출 (warning + danger). OK / PENDING / CHECKING 제외. */
  const mismatchedPlaces = useMemo(
    () => places.filter((p) => MISMATCH_VERDICTS.has(p.current_verdict)),
    [places],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = places
    // 상태 필터 (요약 카드 클릭)
    if (statusFilter !== 'all') {
      list = list.filter((p) => matchStatusFilter(p, statusFilter))
    }
    if (!q) return list
    return list.filter(
      (p) =>
        p.phone.toLowerCase().includes(q) ||
        (p.business_name?.toLowerCase().includes(q) ?? false) ||
        (p.registered_dong?.toLowerCase().includes(q) ?? false) ||
        (p.place_id?.includes(q) ?? false),
    )
  }, [places, search, statusFilter])

  // 데이터가 바뀌었을 때 더 이상 존재하지 않는 id 는 선택 해제
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(places.map((p) => p.id))
      const next = new Set<number>()
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [places])

  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered])
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const someFilteredSelected =
    !allFilteredSelected && filteredIds.some((id) => selectedIds.has(id))

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        // 현재 보이는 항목 모두 해제
        filteredIds.forEach((id) => next.delete(id))
      } else {
        // 현재 보이는 항목 모두 선택
        filteredIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleDelete = async (id: number, phone: string) => {
    if (!confirm(`${phone} 등록을 삭제하시겠습니까?`)) return
    try {
      await deleteMut.mutateAsync(id)
    } catch (e) {
      alert(`삭제 실패: ${formatApiError(e)}`)
    }
  }

  const handleReverify = async (id: number, phone: string) => {
    try {
      const res = await liveCheck.mutateAsync({ place_ids: [id] })
      const r = res.results[0]
      if (r) alert(`${phone} 재검증 완료: ${r.verdict} (${r.response_ms}ms)`)
    } catch (e) {
      alert(`재검증 실패: ${formatApiError(e)}`)
    }
  }

  const handleBulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (
      !confirm(
        `선택된 ${ids.length}건의 등록을 삭제하시겠습니까?\n\n삭제된 데이터는 복구할 수 없습니다 (관련 검증 이력·변경 이벤트 포함).`,
      )
    )
      return
    try {
      const res = await bulkDeleteMut.mutateAsync({ ids, all: false })
      alert(
        `삭제 완료: ${res.deleted}건${
          res.not_found > 0 ? ` (찾을 수 없음 ${res.not_found}건)` : ''
        } · ${res.elapsed_ms}ms`,
      )
      clearSelection()
    } catch (e) {
      alert(`일괄 삭제 실패: ${formatApiError(e)}`)
    }
  }

  const handleDeleteAll = async () => {
    if (places.length === 0) return
    if (
      !confirm(
        `등록된 ${places.length}건 전체를 삭제하시겠습니까?\n\n⚠️ 모든 070 등록과 관련된 검증 이력·변경 이벤트가 함께 삭제됩니다. 복구할 수 없습니다.`,
      )
    )
      return
    if (
      !confirm(
        `정말 전체 삭제할까요? 이 작업은 되돌릴 수 없습니다.\n\n계속하려면 "확인"을 누르세요.`,
      )
    )
      return
    try {
      const res = await bulkDeleteMut.mutateAsync({ ids: [], all: true })
      alert(`전체 삭제 완료: ${res.deleted}건 · ${res.elapsed_ms}ms`)
      clearSelection()
    } catch (e) {
      alert(`전체 삭제 실패: ${formatApiError(e)}`)
    }
  }

  /** 불일치 명단을 .xlsx 로 다운로드. */
  const handleDownloadMismatch = async () => {
    if (mismatchedPlaces.length === 0) {
      alert('불일치 항목이 없습니다. (OK / 검증 대기 / 검증 중 제외)')
      return
    }
    setDownloading(true)
    try {
      // xlsx 라이브러리는 BulkUpload 청크에 이미 포함되어 있으므로
      // 동일한 청크가 재사용된다(추가 다운로드 거의 없음).
      const XLSX = await import('xlsx')

      const rows = mismatchedPlaces.map((p, idx) => ({
        '순번': idx + 1,
        '070 번호': p.phone,
        'Place ID': p.place_id,
        '등록 동': p.registered_dong,
        '상호': p.business_name,
        '검증 상태': VERDICT_LABEL_KO[p.current_verdict] ?? p.current_verdict,
        '검증 코드': p.current_verdict,
        '최근 점검': formatKSTDateTime(p.last_checked_at, ''),
      }))

      const ws = XLSX.utils.json_to_sheet(rows)
      // 컬럼 폭 자동
      ws['!cols'] = [
        { wch: 6 },   // 순번
        { wch: 16 },  // 070
        { wch: 14 },  // Place ID
        { wch: 18 },  // 동
        { wch: 28 },  // 상호
        { wch: 14 },  // 상태
        { wch: 18 },  // 코드
        { wch: 18 },  // 최근 점검
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '불일치 명단')

      const today = todayKST() // YYYY-MM-DD (KST)
      const filename = `타지역서비스_불일치명단_${today}_${mismatchedPlaces.length}건.xlsx`
      XLSX.writeFile(wb, filename)
    } catch (e) {
      alert(`다운로드 실패: ${formatApiError(e)}`)
    } finally {
      setDownloading(false)
    }
  }


  const bulkBusy = bulkDeleteMut.isPending

  return (
    <div className="space-y-6">
      {/* ───── 요약 카운트 4개 (클릭 시 해당 상태로 리스트 필터) ───── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryPill
          label="전체 등록"
          value={summary.total}
          tone="info"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <SummaryPill
          label="정상 노출"
          value={summary.ok}
          tone="success"
          active={statusFilter === 'ok'}
          onClick={() =>
            setStatusFilter((f) => (f === 'ok' ? 'all' : 'ok'))
          }
        />
        <SummaryPill
          label="주의 (불일치)"
          value={summary.warning}
          tone="warning"
          active={statusFilter === 'warning'}
          onClick={() =>
            setStatusFilter((f) => (f === 'warning' ? 'all' : 'warning'))
          }
        />
        <SummaryPill
          label="심각 (지역/삭제)"
          value={summary.danger}
          tone="danger"
          active={statusFilter === 'danger'}
          onClick={() =>
            setStatusFilter((f) => (f === 'danger' ? 'all' : 'danger'))
          }
        />
      </div>

      {/* ───── 메인 등록 패널 — 엑셀/CSV 일괄 업로드 ───── */}
      <Card variant="white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <FileSpreadsheet size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-h3 text-ink">엑셀 / CSV 대량 등록</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              엑셀에서 070 번호 열을 복사·붙여넣기 하거나 CSV·TXT 파일을 업로드하세요.
              <span className="text-brand-600 font-semibold"> 1회 최대 10,000건</span>,
              자동으로 <span className="text-brand-600 font-semibold">500건씩 청크로 나눠 즉시 등록</span>됩니다 (네이버 호출 없음 — 1500건 ~3초).
              <br />
              <span className="text-ink-muted">등록 후 <b>실시간 노출 확인 → 지금 검증 시작</b>을 누르면 4중 검증이 청크로 진행됩니다.</span>
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="rounded-card border-2 border-dashed border-ink-watermark/40 bg-bg-subtle p-8 text-center text-body-sm text-ink-muted">
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
              {statusFilter !== 'all' && (
                <span
                  className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    statusFilter === 'ok'
                      ? 'bg-green-50 text-status-success'
                      : statusFilter === 'warning'
                      ? 'bg-amber-50 text-status-warning'
                      : 'bg-red-50 text-status-danger'
                  }`}
                >
                  {statusFilter === 'ok' && '정상 노출만 보기'}
                  {statusFilter === 'warning' && '주의(불일치)만 보기'}
                  {statusFilter === 'danger' && '심각(지역/삭제)만 보기'}
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="ml-1 hover:opacity-70"
                    title="필터 해제"
                  >
                    ✕
                  </button>
                </span>
              )}
              {selectedIds.size > 0 && (
                <span className="text-brand-600 font-semibold ml-2">
                  · 선택 {selectedIds.size}건
                </span>
              )}
              {isFetching && !isLoading && (
                <span className="text-brand-600 ml-2">(갱신 중…)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

            {/* 대량 검증 시작 (전체 또는 선택) */}
            <button
              type="button"
              disabled={places.length === 0}
              onClick={() => {
                const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined
                setVerifyJobIds(ids)
                setVerifyJobOpen(true)
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-blue-50 text-blue-700 font-semibold text-body-sm hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title={
                selectedIds.size > 0
                  ? `선택한 ${selectedIds.size}건을 500건 청크로 검증 (사용자당 동시 1개)`
                  : `등록 전체(${places.length}건)를 500건 청크로 검증 (플랜 한도 적용)`
              }
            >
              <Zap size={14} />
              {selectedIds.size > 0
                ? `선택 검증 (${selectedIds.size})`
                : `전체 검증`}
            </button>

            {/* 불일치 명단 다운로드 (.xlsx) */}
            <button
              type="button"
              disabled={mismatchedPlaces.length === 0 || downloading}
              onClick={handleDownloadMismatch}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-amber-50 text-amber-700 font-semibold text-body-sm hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title={
                mismatchedPlaces.length === 0
                  ? '다운로드할 불일치 항목이 없습니다'
                  : `검증 결과 불일치(전화/동/상호/지역 불일치, 페이지 삭제) ${mismatchedPlaces.length}건을 .xlsx 로 저장`
              }
            >
              {downloading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileDown size={14} />
              )}
              불일치 다운로드
              {mismatchedPlaces.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold tabular-nums">
                  {mismatchedPlaces.length}
                </span>
              )}
            </button>

            {/* 선택 일괄 삭제 */}
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={handleBulkDeleteSelected}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-red-50 text-status-danger font-semibold text-body-sm hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title="체크박스로 선택한 항목 일괄 삭제"
            >
              {bulkBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              선택 삭제
              {selectedIds.size > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-status-danger text-white text-[10px] font-bold tabular-nums">
                  {selectedIds.size}
                </span>
              )}
            </button>

            {/* 전체 삭제 */}
            <button
              type="button"
              disabled={places.length === 0 || bulkBusy}
              onClick={handleDeleteAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-pill bg-white border border-red-200 text-status-danger font-semibold text-body-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title="등록된 모든 070 번호 삭제"
            >
              <Trash size={14} />
              전체 삭제
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                <th className="pl-card-sm pr-2 py-3 w-10">
                  <CheckboxButton
                    state={
                      allFilteredSelected
                        ? 'checked'
                        : someFilteredSelected
                        ? 'indeterminate'
                        : 'unchecked'
                    }
                    onClick={toggleAllVisible}
                    disabled={filteredIds.length === 0}
                    title={allFilteredSelected ? '전체 해제' : '현재 보이는 항목 전체 선택'}
                  />
                </th>
                <th className="px-3 py-3 font-semibold">070 번호</th>
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
                      : statusFilter === 'warning'
                      ? '주의(불일치) 항목이 없습니다.'
                      : statusFilter === 'danger'
                      ? '심각(지역/삭제) 항목이 없습니다.'
                      : statusFilter === 'ok'
                      ? '정상 노출 항목이 없습니다.'
                      : '등록된 번호가 없습니다. 위에서 엑셀·CSV로 일괄 등록해 보세요.'}
                    {statusFilter !== 'all' && !search && (
                      <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className="ml-2 underline text-brand-600 font-semibold"
                      >
                        전체 보기
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((p: RegisteredPlace) => {
                const checked = selectedIds.has(p.id)
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-bg-subtle/60 transition-colors ${
                      checked ? 'bg-brand-50/40' : 'hover:bg-bg-subtle/40'
                    }`}
                  >
                    <td className="pl-card-sm pr-2 py-3">
                      <CheckboxButton
                        state={checked ? 'checked' : 'unchecked'}
                        onClick={() => toggleOne(p.id)}
                      />
                    </td>
                    <td className="px-3 py-3 text-ink font-semibold tabular-nums">
                      {p.phone}
                    </td>
                    <td className="px-3 py-3 text-ink-muted tabular-nums font-mono text-caption">
                      {p.place_id ?? <span className="text-ink-soft italic">—</span>}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {p.registered_dong ?? <span className="text-ink-soft italic">—</span>}
                    </td>
                    <td
                      className="px-3 py-3 text-ink truncate max-w-[200px]"
                      title={p.business_name ?? undefined}
                    >
                      {p.business_name ?? <span className="text-ink-soft italic">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <VerdictBadge verdict={p.current_verdict} />
                    </td>
                    <td className="px-3 py-3 text-caption text-ink-muted">
                      {formatKSTRelative(p.last_checked_at, '—')}
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
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 대량 검증 진행률 모달 */}
      <VerifyJobModal
        open={verifyJobOpen}
        placeIds={verifyJobIds}
        onClose={() => setVerifyJobOpen(false)}
        autoDownload={true}
      />
    </div>
  )
}

/* ────────────── 서브 컴포넌트 ────────────── */

interface SummaryPillProps {
  label: string
  value: number
  tone: 'success' | 'warning' | 'danger' | 'info'
  active?: boolean
  onClick?: () => void
}

function SummaryPill({ label, value, tone, active = false, onClick }: SummaryPillProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  const ringClass = {
    success: 'ring-status-success',
    warning: 'ring-status-warning',
    danger: 'ring-status-danger',
    info: 'ring-brand-500',
  }[tone]

  const clickable = !!onClick
  const Wrapper = clickable ? 'button' : 'div'

  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={clickable ? active : undefined}
      title={
        clickable
          ? active
            ? `${label} 필터 해제 (전체 보기)`
            : `${label} 항목만 보기`
          : undefined
      }
      className={`text-left w-full transition-all ${
        clickable ? 'cursor-pointer hover:-translate-y-0.5' : ''
      } ${active ? `ring-2 ${ringClass} rounded-card` : ''}`}
    >
      <Card variant="white" className="!py-4 !px-5 flex items-center justify-between">
        <div>
          <div className="text-caption text-ink-muted mb-1">{label}</div>
          <div className="text-h2 text-ink tabular-nums leading-none">{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-2xl ${toneClass} flex items-center justify-center`}>
          <span className="text-body-sm font-bold tabular-nums">{value}</span>
        </div>
      </Card>
    </Wrapper>
  )
}

/** 3‑state 체크박스 버튼 — checked / indeterminate / unchecked. */
interface CheckboxButtonProps {
  state: 'checked' | 'indeterminate' | 'unchecked'
  onClick: () => void
  disabled?: boolean
  title?: string
}

function CheckboxButton({ state, onClick, disabled, title }: CheckboxButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : 'hover:bg-brand-50 cursor-pointer'
      } ${state === 'checked' ? 'text-brand-600' : 'text-ink-muted'}`}
      aria-checked={state === 'checked'}
      role="checkbox"
    >
      {state === 'checked' ? (
        <CheckSquare size={18} strokeWidth={2.2} />
      ) : state === 'indeterminate' ? (
        <span className="relative inline-flex w-[18px] h-[18px] items-center justify-center">
          <Square size={18} strokeWidth={2.2} />
          <span className="absolute w-2.5 h-0.5 bg-brand-600 rounded-full" />
        </span>
      ) : (
        <Square size={18} strokeWidth={1.8} />
      )}
    </button>
  )
}

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `네트워크 오류 (백엔드 연결 확인): ${e.message}`
    return `API ${e.status}: ${e.message}`
  }
  return (e as Error).message ?? '알 수 없는 오류'
}
