/**
 * 타지역 순위 자동체크 솔루션 (솔루션 #5) — 풀 구현 페이지.
 *
 * 정책 (070+동 단일 매칭, 자동 확정):
 *  · 070 가상번호 = 본인 번호이므로 시스템이 자동으로 place_id 확정.
 *  · 사용자 개입은 "070 일치하지만 등록동≠실제 노출동(변경 노출)" 케이스만.
 *  · UI = 변경 노출 배너 + 등록동×키워드 매트릭스 1개 + 키워드별 30일 추이 그래프 N개.
 *
 * 구성:
 *  1) Excel 업로드 카드 (드래그&드롭 + 파일선택 + 템플릿 다운로드)
 *  2) 변경 노출 배너 (등록동≠실제 노출동인 케이스 N건 알림)
 *  3) 매칭 결과 요약 + 매칭 재실행 + 엑셀 다운로드
 *  4) 등록동 × 키워드 매트릭스 (현재 순위 한눈에)
 *  5) 키워드별 30일 순위 추이 SVG 라인차트 (Y축 반전)
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  TrendingUp,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  LineChart as LineChartIcon,
  Search,
  MapPin,
  Trash2,
  X,
  ExternalLink,
  Phone,
  Building2,
  Calendar,
  Plus,
  Tag,
  ArrowRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'

import { Card } from '@/components/ui/Card'
import { useBodyClass } from '@/hooks/useBodyClass'
import PageSeo from '@/components/seo/PageSeo'
import {
  listRankPlaces,
  listDongChanged,
  listLatestRanks,
  runMatch,
  getRankHistory,
  getRankProgress,
  resetAllRankData,
  getCompetition,
  updateKeywords,
  bulkApplyKeywords,
  triggerManualRankCheck,
  type RankPlaceOut,
  type RankPlaceListOut,
  type DongChangedListOut,
  type LatestRanksResponse,
  type RankCheckProgress,
  type RankHistoryResponse,
  type CompetitionResponse,
  type BulkKeywordsFilter,
  type BulkKeywordsResponse,
} from '@/api/rankTracker'
import { useAuthStore } from '@/store/auth'

/* ────────────────────────────────────────────────────────────
 * 유틸: 날짜
 * ──────────────────────────────────────────────────────────── */
function todayKst(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

/* ────────────────────────────────────────────────────────────
 * 페이지 본체
 * ──────────────────────────────────────────────────────────── */
export default function RankTracker() {
  useBodyClass('solution-tool-page')

  // 데이터
  const [list, setList] = useState<RankPlaceListOut | null>(null)
  const [dongChanged, setDongChanged] = useState<DongChangedListOut | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 진행 상태 (업로드 후 자동 매칭+순위체크 폴링)
  const [progress, setProgress] = useState<RankCheckProgress | null>(null)
  // 매트릭스 reload 트리거 (progress 폴링이 1단계 증가시키면 RankMatrix가 reload)
  const [matrixReloadTick, setMatrixReloadTick] = useState(0)
  // 전체 초기화 모달
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  // 플레이스 상세 모달 (매트릭스 행 클릭)
  const [detailPlace, setDetailPlace] = useState<RankPlaceOut | null>(null)
  // 데모 게스트 여부 (POST mutation 차단 — 일괄 적용 버튼 비활성화)
  const isDemo = useAuthStore((s) => s.isDemo)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  /* ── 목록 fetch ── */
  const fetchAll = useCallback(async () => {
    setLoadingList(true)
    try {
      const [r1, r2] = await Promise.all([listRankPlaces(), listDongChanged()])
      setList(r1)
      setDongChanged(r2)
    } catch (e) {
      console.error('fetch failed', e)
      showToast('목록 조회 실패')
    } finally {
      setLoadingList(false)
    }
  }, [showToast])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 진행 상태 fetch
  const fetchProgress = useCallback(async () => {
    try {
      const p = await getRankProgress()
      setProgress(p)
      return p
    } catch (e) {
      console.error('progress fetch failed', e)
      return null
    }
  }, [])

  useEffect(() => {
    fetchProgress()
  }, [fetchProgress])

  // 업로드 후 또는 매칭 대기/순위 채워지지 않은 셀이 남아 있으면 5초 폴링
  // - 매칭 진행 중: 목록(/places) 도 함께 갱신해서 SummaryBar 가 변함
  // - 순위 채우기 중: 매트릭스만 reload tick 증가시켜 새 셀 채우기
  const inProgress = progress?.in_progress ?? false
  useEffect(() => {
    if (!inProgress) return
    const t = window.setInterval(async () => {
      const p = await fetchProgress()
      // 매칭이 아직 진행 중이면 places/dong-changed도 다시 가져옴
      if (p && p.pending_match > 0) {
        await fetchAll()
      }
      // 매트릭스 reload 트리거
      setMatrixReloadTick((n) => n + 1)
    }, 5000)
    return () => window.clearInterval(t)
  }, [inProgress, fetchProgress, fetchAll])

  /* ── 추적 키워드 인라인 업데이트 (2단계 UX) ── */
  const handleUpdateKeywords = useCallback(
    async (placePk: number, keywords: string[]) => {
      try {
        const resp = await updateKeywords(placePk, keywords)
        if (resp.auto_matched) {
          // 타지역 정책: 자동 순위 추적 비활성. 사용자가 "지금 검증"으로 명시 트리거해야 함.
          showToast('키워드 등록 완료 — 매트릭스의 "지금 검증" 버튼으로 순위를 확인하세요.')
        } else if (keywords.length === 0) {
          showToast('추적 키워드 해제 완료')
        } else {
          showToast('키워드 등록 완료 — 매칭 대기 중')
        }
        await fetchAll()
        await fetchProgress()
      } catch (e) {
        console.error('update keywords failed', e)
        showToast('키워드 등록 실패: ' + (e as Error).message)
      }
    },
    [fetchAll, fetchProgress, showToast],
  )

  /* ── 일괄 키워드 적용 — A안: 5개 키워드 입력 + 필터 + 한 번에 적용 ── */
  const handleBulkApply = useCallback(
    async (
      keywords: string[],
      mode: 'replace' | 'append',
      filter: BulkKeywordsFilter,
    ): Promise<BulkKeywordsResponse> => {
      const resp = await bulkApplyKeywords({
        tracking_keywords: keywords,
        mode,
        filter,
      })
      showToast(
        `일괄 적용 완료 — 대상 ${resp.total_matched}건 · 갱신 ${resp.updated}건 · ` +
          `자동매칭 ${resp.auto_matched}건 · 매칭대기 ${resp.pending_match}건` +
          (resp.skipped_no_change > 0 ? ` · 변경없음 ${resp.skipped_no_change}건` : ''),
      )
      await fetchAll()
      await fetchProgress()
      return resp
    },
    [fetchAll, fetchProgress, showToast],
  )

  /* ── 수동 순위 검증 트리거 (타지역 정책 — 자동 트리거 모두 비활성화) ── */
  const [manualChecking, setManualChecking] = useState(false)
  const handleManualRankCheck = useCallback(
    async (placeIds: number[] = []) => {
      setManualChecking(true)
      try {
        const resp = await triggerManualRankCheck(placeIds)
        if (resp.started > 0) {
          showToast(
            resp.message ??
              `${resp.started}개 업체 순위 검증을 시작했습니다. 잠시 후 매트릭스에 반영됩니다.`,
          )
          // 폴링 시작을 위해 progress 한 번 fetch
          await fetchProgress()
          // 매트릭스가 새 결과를 받도록 reload tick 증가
          window.setTimeout(() => {
            setMatrixReloadTick((n) => n + 1)
            fetchAll()
          }, 4000)
        } else {
          showToast(resp.message ?? '검증 가능한 업체가 없습니다.')
        }
      } catch (e) {
        console.error('manual rank check failed', e)
        showToast('수동 검증 실패: ' + (e as Error).message)
      } finally {
        setManualChecking(false)
      }
    },
    [fetchAll, fetchProgress, showToast],
  )

  /* ── 결과 Excel 다운로드 ── */
  const exportResults = useCallback(async () => {
    if (!list || list.items.length === 0) return
    const { loadXLSX } = await import('@/utils/xlsx')
    const XLSX = await loadXLSX()

    const summary = list.items.map((p) => ({
      상호: p.business_name ?? '',
      '070전번': p.phone,
      등록동: p.registered_dong ?? '',
      추적키워드: p.tracking_keywords.join(', '),
      매칭상태: p.match_status ?? 'PENDING_MATCH',
      변경노출: p.dong_changed ? 'Y' : 'N',
      실제노출동: p.actual_dong ?? '',
      매칭상호: p.matched?.name ?? '',
      매칭주소: p.matched?.address ?? '',
      place_id: p.place_id ?? '',
      매칭일시: p.matched_at ?? '',
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '매칭요약')
    XLSX.writeFile(wb, `타지역_순위자동체크_결과_${todayKst()}.xlsx`)
  }, [list])

  /* ── 매칭 재실행 ── */
  const handleRunMatch = useCallback(async () => {
    setRunning(true)
    try {
      const r = await runMatch({})
      showToast(`${r.requested}건 매칭 백그라운드 실행`)
      await fetchAll()
    } catch (e) {
      showToast('매칭 실행 실패: ' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [fetchAll, showToast])

  /* ── 전체 초기화 (재업로드 전) ── */
  const handleResetAll = useCallback(async () => {
    setResetting(true)
    try {
      const r = await resetAllRankData()
      showToast(r.message)
      setResetModalOpen(false)
      // 로컬 상태 즉시 비우기
      setList(null)
      setDongChanged(null)
      setProgress(null)
      setMatrixReloadTick(0)
      // 그 후 서버에서 새로 fetch (전부 0 으로 갱신)
      await fetchAll()
      await fetchProgress()
    } catch (e) {
      showToast('초기화 실패: ' + (e as Error).message)
    } finally {
      setResetting(false)
    }
  }, [fetchAll, fetchProgress, showToast])

  return (
    <div className="px-4 lg:px-8 py-6 max-w-7xl mx-auto space-y-6" data-page="solution-tool">
      <PageSeo
        title="타지역 순위 자동체크 솔루션"
        description="노출관리 자동체크와 한 세트 — monitor 에 등록된 업체에 추적 키워드만 추가하면 매일 동별 노출 순위를 자동 추적합니다."
        path="/auto-rank-check"
        keywords={[
          '타지역 순위 자동체크',
          '네이버 플레이스 순위',
          '동별 순위 추적',
          '070 가상번호 순위',
          '네이버 지도 순위',
          '타지역닷컴',
        ]}
      />

      {/* 헤더 */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="text-blue-600" size={24} />
          타지역 순위 자동체크 솔루션
        </h1>
        <p className="text-sm text-ink-2 mt-1">
          <strong>노출관리 자동체크</strong>에 등록된 업체를 그대로 가져와{' '}
          <strong>추적 키워드만 추가</strong>하면, 매일 자동체크로 동별 노출 순위를
          시계열 그래프로 추적합니다.
        </p>
      </div>

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* 0) 변경 노출 배너 — 등록동≠실제 노출동 케이스 알림 */}
      {dongChanged && dongChanged.count > 0 && (
        <DongChangedBanner data={dongChanged} />
      )}

      {/* 1) 추적 키워드 등록 — monitor 등록 업체에 키워드만 추가 (엑셀 업로드 대체) */}
      {list && (
        <KeywordRegistryCard
          list={list}
          onUpdateKeywords={handleUpdateKeywords}
          onBulkApply={handleBulkApply}
          isDemo={isDemo}
        />
      )}

      {/* 2) 요약 + 액션 */}
      {list && (
        <SummaryBar
          list={list}
          loading={loadingList}
          running={running}
          onRefresh={fetchAll}
          onRunMatch={handleRunMatch}
          onExport={exportResults}
          onReset={() => setResetModalOpen(true)}
        />
      )}

      {/* 진행 배너 — 매칭/순위체크 백그라운드 진행 중일 때 표시 */}
      {progress && progress.in_progress && (
        <ProgressBanner progress={progress} />
      )}

      {/* 수동확인 필요 — NEEDS_MANUAL 행 직접 해결
       *  정책: 백엔드가 070 매칭 0건 → 이름+동 폴백 매칭으로 자동 승격(false-positive 회피 위해
       *  단일 후보일 때만). 끝까지 못 잡힌 NEEDS_MANUAL 은 매트릭스에서 제외만 하고 사용자
       *  입력 강요는 하지 않는다. (이전 UI 의 NeedsManualPanel 은 표시하지 않음)
       */}

      {/* 3) 등록동 × 키워드 매트릭스 — 현재 순위 한눈에 */}
      {list && list.items.length > 0 && (
        <RankMatrix
          list={list}
          reloadTick={matrixReloadTick}
          onRowClick={(p) => setDetailPlace(p)}
          onManualCheck={handleManualRankCheck}
          manualChecking={manualChecking}
        />
      )}

      {/* 4) 키워드별 30일 추이 그래프 N개 */}
      {list && list.items.length > 0 && <KeywordGraphSection list={list} />}

      {/* 전체 초기화 확인 모달 */}
      {resetModalOpen && (
        <ResetConfirmModal
          totalPlaces={list?.total ?? 0}
          resetting={resetting}
          onCancel={() => setResetModalOpen(false)}
          onConfirm={handleResetAll}
        />
      )}

      {/* 플레이스 상세 모달 (매트릭스 행 클릭 시) */}
      {detailPlace && (
        <PlaceDetailModal
          place={detailPlace}
          onClose={() => setDetailPlace(null)}
        />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 전체 초기화 확인 모달
 *  - 사용자가 SummaryBar "전체 초기화" 버튼 누르면 표시
 *  - 두 번 확인 (체크박스 + 확인 버튼) 방식으로 실수 방지
 * ──────────────────────────────────────────────────────────── */
function ResetConfirmModal(props: {
  totalPlaces: number
  resetting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { totalPlaces, resetting, onCancel, onConfirm } = props
  const [agree, setAgree] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !resetting) onCancel()
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
          <AlertTriangle className="text-rose-600" size={20} />
          <h3 className="text-base font-bold text-rose-900">전체 초기화</h3>
          <button
            onClick={onCancel}
            disabled={resetting}
            className="ml-auto p-1 rounded hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={16} className="text-ink-2" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          <p>
            현재 등록된 <strong className="text-rose-700">{totalPlaces}건</strong>의
            플레이스와 모든 키워드별 순위 이력이 <strong>영구 삭제</strong>됩니다.
          </p>
          <ul className="text-xs text-ink-2 space-y-1 bg-slate-50 rounded-lg px-3 py-2">
            <li>· 등록 플레이스 (070전번 / 등록동 / 상호 / 추적키워드)</li>
            <li>· 매칭 결과 (place_id, 매칭상태, 변경노출 플래그)</li>
            <li>· 키워드별 순위 이력 (30일 추이 그래프 데이터)</li>
          </ul>
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 ring-1 ring-amber-200">
            <strong>주의:</strong> 추적 키워드와 모든 순위 이력이 삭제됩니다.
            (monitor 에 등록된 업체 자체는 그대로 유지됩니다.)
          </p>

          <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              disabled={resetting}
              className="mt-0.5"
            />
            <span className="text-xs text-ink-1">
              위 내용을 확인했으며, 모든 데이터를 삭제하는 데 동의합니다.
            </span>
          </label>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50 rounded-b-xl">
          <button
            onClick={onCancel}
            disabled={resetting}
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md bg-white hover:bg-slate-100 ring-1 ring-slate-300 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={!agree || resetting}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resetting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            영구 삭제
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * (deprecated) NeedsManualPanel / NeedsManualRow 컴포넌트 제거됨.
 *  - 백엔드의 070 매칭 + 이름+동 폴백 매칭이 자동 처리하므로 더 이상 UI 노출 없음.
 *  - 끝까지 못 잡힌 NEEDS_MANUAL 케이스는 매트릭스에서 자동 제외만 함 — 사용자 입력 강요 없음.
 *  - 디버그 필요 시 git history 에서 복원 (commit a070626 참조).
 * ──────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 추적 키워드 등록 카드 (2단계 UX — 엑셀 업로드 대체)
 *
 *  · monitor (노출관리 자동체크) 에 이미 등록된 업체 목록을 그대로 표시
 *  · 070/등록동/상호는 monitor 가 채워둔 값을 그대로 사용 — 사용자는 키워드만 추가
 *  · 키워드 칩 추가/제거 후 즉시 PATCH /places/{pk}/keywords 호출
 *  · 빈 상태: monitor 에 업체 없으면 "노출관리에 먼저 등록" 안내 + 링크
 * ──────────────────────────────────────────────────────────── */
function KeywordRegistryCard(props: {
  list: RankPlaceListOut
  onUpdateKeywords: (placePk: number, keywords: string[]) => Promise<void>
  onBulkApply: (
    keywords: string[],
    mode: 'replace' | 'append',
    filter: BulkKeywordsFilter,
  ) => Promise<BulkKeywordsResponse>
  isDemo: boolean
}) {
  const { list, onUpdateKeywords, onBulkApply, isDemo } = props
  const [expanded, setExpanded] = useState(false)

  // 키워드 등록 우선순위: 키워드 없는 업체를 먼저 보여줌
  const sorted = useMemo(() => {
    const items = [...list.items]
    items.sort((a, b) => {
      const aNo = a.tracking_keywords.length === 0 ? 0 : 1
      const bNo = b.tracking_keywords.length === 0 ? 0 : 1
      if (aNo !== bNo) return aNo - bNo
      return (a.business_name || '').localeCompare(b.business_name || '')
    })
    return items
  }, [list.items])

  // monitor 에 등록된 업체가 0건 → 안내 배너
  if (list.total === 0) {
    return (
      <Card className="p-6 border-blue-200 ring-1 ring-blue-100 bg-blue-50/40">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Building2 className="text-blue-600" size={20} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-blue-900 mb-1">
              먼저 노출관리 자동체크 솔루션에 업체를 등록해주세요
            </h2>
            <p className="text-sm text-ink-1 mb-3">
              순위 자동체크는 <strong>노출관리 자동체크</strong>와 한 세트로 동작합니다.
              monitor 에 등록된 070/등록동/상호 정보를 그대로 가져와, 여기서는
              <strong> 추적 키워드만 추가</strong>하면 됩니다.
            </p>
            <Link
              to="/monitor"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            >
              노출관리 솔루션으로 이동
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </Card>
    )
  }

  const noKeywordsCount = list.no_keywords_count
  const withKeywordsCount = list.total - noKeywordsCount

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Tag size={18} className="text-blue-600" />
          1단계 · 추적 키워드 등록
          <span className="text-xs font-normal text-ink-2 ml-1">
            (monitor 등록 업체 {list.total}건)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {noKeywordsCount > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
              키워드 미등록 {noKeywordsCount}건
            </span>
          )}
          {withKeywordsCount > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200">
              추적 중 {withKeywordsCount}건
            </span>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? '접기' : '펼치기'}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-2 mb-2">
        monitor 가 검증한 업체에 추적 키워드만 추가하세요. 키워드를 등록하면 즉시
        매칭(0초)되고 백그라운드에서 순위 자동체크가 시작됩니다. 키워드는 최대 5개.
      </p>

      {/* ── 일괄 적용 (A안) — 5개 키워드 입력 + 필터 + 한 번에 적용 ── */}
      <BulkApplyPanel
        list={list}
        onBulkApply={onBulkApply}
        isDemo={isDemo}
      />

      {expanded && (
        <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-ink-2">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">상호</th>
                <th className="px-3 py-2 text-left font-semibold">등록동</th>
                <th className="px-3 py-2 text-left font-semibold">070</th>
                <th className="px-3 py-2 text-left font-semibold">추적 키워드</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sorted.map((p) => (
                <KeywordRegistryRow
                  key={p.id}
                  place={p}
                  onSave={(kws) => onUpdateKeywords(p.id, kws)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * BulkApplyPanel — A안: 5개 키워드 입력 + 필터 + 한 번에 일괄 적용
 *
 *  · 키워드 칩 입력 (Enter / + 버튼, X 로 제거, 최대 5개)
 *  · 필터: 전체 / 키워드 미등록만 / 시도 / 상호 contains
 *  · 모드: 교체(replace) / 추가(append)
 *  · 적용 버튼: "N건에 일괄 적용" — 대상 > 50건이면 확인 다이얼로그
 *  · 데모 모드(isDemo=true): 적용 버튼 비활성 + amber notice
 * ──────────────────────────────────────────────────────────── */
type BulkFilterMode = 'all' | 'no_keywords' | 'sido' | 'business_name'

function BulkApplyPanel(props: {
  list: RankPlaceListOut
  onBulkApply: (
    keywords: string[],
    mode: 'replace' | 'append',
    filter: BulkKeywordsFilter,
  ) => Promise<BulkKeywordsResponse>
  isDemo: boolean
}) {
  const { list, onBulkApply, isDemo } = props

  // 키워드 chip 입력
  const [keywords, setKeywords] = useState<string[]>([])
  const [input, setInput] = useState('')

  // 필터
  const [filterMode, setFilterMode] = useState<BulkFilterMode>('no_keywords')
  const [sidoInput, setSidoInput] = useState('')
  const [bnInput, setBnInput] = useState('')

  // 적용 모드 (replace = 교체, append = 추가)
  const [applyMode, setApplyMode] = useState<'replace' | 'append'>('replace')

  // 상태
  const [applying, setApplying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<BulkKeywordsResponse | null>(
    null,
  )

  // 클라이언트 측 대상 개수 추정 (사용자 안내용)
  const estimatedCount = useMemo(() => {
    const items = list.items
    if (filterMode === 'all') return items.length
    if (filterMode === 'no_keywords')
      return items.filter((p) => p.tracking_keywords.length === 0).length
    if (filterMode === 'sido') {
      const q = sidoInput.trim()
      if (!q) return 0
      return items.filter((p) => {
        const addr = (p.matched?.address ?? '').trim()
        return addr.split(/\s+/)[0] === q
      }).length
    }
    if (filterMode === 'business_name') {
      const q = bnInput.trim().toLowerCase()
      if (!q) return 0
      return items.filter((p) =>
        (p.business_name || '').toLowerCase().includes(q),
      ).length
    }
    return 0
  }, [list.items, filterMode, sidoInput, bnInput])

  const buildFilter = useCallback((): BulkKeywordsFilter => {
    const f: BulkKeywordsFilter = {}
    if (filterMode === 'no_keywords') f.only_no_keywords = true
    if (filterMode === 'sido' && sidoInput.trim()) f.sido = sidoInput.trim()
    if (filterMode === 'business_name' && bnInput.trim())
      f.business_name_contains = bnInput.trim()
    return f
  }, [filterMode, sidoInput, bnInput])

  const addKeyword = useCallback(() => {
    const v = input.trim()
    if (!v) return
    if (keywords.includes(v)) {
      setInput('')
      return
    }
    if (keywords.length >= 5) return
    setKeywords([...keywords, v])
    setInput('')
  }, [input, keywords])

  const removeKeyword = useCallback(
    (kw: string) => {
      setKeywords(keywords.filter((k) => k !== kw))
    },
    [keywords],
  )

  const canApply =
    !applying &&
    !isDemo &&
    keywords.length > 0 &&
    estimatedCount > 0 &&
    (filterMode !== 'sido' || sidoInput.trim().length > 0) &&
    (filterMode !== 'business_name' || bnInput.trim().length > 0)

  const handleClickApply = useCallback(() => {
    if (!canApply) return
    // 대상이 50건 초과면 확인 다이얼로그
    if (estimatedCount > 50) {
      setConfirmOpen(true)
    } else {
      void doApply()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApply, estimatedCount])

  const doApply = useCallback(async () => {
    setConfirmOpen(false)
    setApplying(true)
    setLastResult(null)
    try {
      const resp = await onBulkApply(keywords, applyMode, buildFilter())
      setLastResult(resp)
      // 적용 성공 후 입력값은 유지 (사용자가 추가 액션 가능). 키워드만 초기화는 X.
    } catch (e) {
      console.error('bulk apply failed', e)
    } finally {
      setApplying(false)
    }
  }, [applyMode, buildFilter, keywords, onBulkApply])

  return (
    <div className="mb-3 rounded-lg ring-1 ring-blue-200 bg-blue-50/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">
          일괄 적용
        </span>
        <span className="text-xs text-ink-1 font-semibold">
          5개 키워드를 입력하고 한 번에 여러 업체에 적용하세요
        </span>
      </div>

      {/* 1) 키워드 chip 입력 */}
      <div>
        <div className="text-[11px] font-semibold text-ink-2 mb-1">
          ① 적용할 키워드 (최대 5개)
        </div>
        <div className="flex flex-wrap items-center gap-1.5 bg-white rounded-md ring-1 ring-slate-300 px-2 py-1.5 min-h-[36px]">
          {keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 ring-1 ring-blue-200"
            >
              {kw}
              <button
                type="button"
                onClick={() => removeKeyword(kw)}
                disabled={applying}
                className="hover:bg-blue-200 rounded-full p-0.5 disabled:opacity-50"
                aria-label={`${kw} 제거`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {keywords.length < 5 && (
            <div className="inline-flex items-center gap-1 flex-1 min-w-[140px]">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addKeyword()
                  }
                }}
                placeholder={
                  keywords.length === 0
                    ? '예: 흥신소, 강남 흥신소 (Enter / + 로 추가)'
                    : '+ 키워드 추가'
                }
                disabled={applying}
                className="text-xs px-2 py-0.5 rounded-md focus:outline-none flex-1 min-w-[120px] disabled:opacity-50"
              />
              {input.trim() && (
                <button
                  type="button"
                  onClick={addKeyword}
                  disabled={applying}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-0.5 disabled:opacity-50"
                >
                  <Plus size={11} />
                  추가
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2) 대상 필터 */}
      <div>
        <div className="text-[11px] font-semibold text-ink-2 mb-1">
          ② 적용 대상
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-filter-mode"
              checked={filterMode === 'no_keywords'}
              onChange={() => setFilterMode('no_keywords')}
              disabled={applying}
            />
            <span>키워드 미등록만</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-filter-mode"
              checked={filterMode === 'all'}
              onChange={() => setFilterMode('all')}
              disabled={applying}
            />
            <span>전체</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-filter-mode"
              checked={filterMode === 'sido'}
              onChange={() => setFilterMode('sido')}
              disabled={applying}
            />
            <span>시도</span>
            {filterMode === 'sido' && (
              <input
                type="text"
                value={sidoInput}
                onChange={(e) => setSidoInput(e.target.value)}
                placeholder="예: 서울특별시"
                disabled={applying}
                className="ml-1 text-xs px-2 py-0.5 rounded-md ring-1 ring-slate-300 focus:ring-blue-500 focus:outline-none w-32 disabled:opacity-50"
              />
            )}
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-filter-mode"
              checked={filterMode === 'business_name'}
              onChange={() => setFilterMode('business_name')}
              disabled={applying}
            />
            <span>상호 포함</span>
            {filterMode === 'business_name' && (
              <input
                type="text"
                value={bnInput}
                onChange={(e) => setBnInput(e.target.value)}
                placeholder="예: 흥신소"
                disabled={applying}
                className="ml-1 text-xs px-2 py-0.5 rounded-md ring-1 ring-slate-300 focus:ring-blue-500 focus:outline-none w-32 disabled:opacity-50"
              />
            )}
          </label>
        </div>
      </div>

      {/* 3) 적용 모드 */}
      <div>
        <div className="text-[11px] font-semibold text-ink-2 mb-1">
          ③ 적용 방식
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-apply-mode"
              checked={applyMode === 'replace'}
              onChange={() => setApplyMode('replace')}
              disabled={applying}
            />
            <span>교체 (기존 키워드를 새 키워드로 덮어쓰기)</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="bulk-apply-mode"
              checked={applyMode === 'append'}
              onChange={() => setApplyMode('append')}
              disabled={applying}
            />
            <span>추가 (기존 키워드에 더하기, 5개 한도)</span>
          </label>
        </div>
      </div>

      {/* 4) 적용 버튼 + 데모 안내 */}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <div className="text-xs text-ink-2">
          예상 대상:{' '}
          <strong className="text-blue-800">{estimatedCount}건</strong>
          {keywords.length > 0 && (
            <>
              {' '}
              · 키워드 {keywords.length}개 ({keywords.join(', ')})
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handleClickApply}
          disabled={!canApply}
          className={clsx(
            'text-xs font-bold px-4 py-2 rounded-md inline-flex items-center gap-1.5 shadow-sm transition',
            canApply
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed',
          )}
          title={
            isDemo
              ? '데모 모드에서는 변경이 비활성화되어 있습니다.'
              : keywords.length === 0
                ? '키워드를 1개 이상 입력하세요'
                : estimatedCount === 0
                  ? '적용 대상이 없습니다'
                  : ''
          }
        >
          {applying ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {estimatedCount > 0 ? `${estimatedCount}건에 일괄 적용` : '일괄 적용'}
        </button>
      </div>

      {isDemo && (
        <div className="text-[11px] text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-md px-2 py-1.5">
          <strong>데모 모드</strong> — 일괄 적용은 비활성화되어 있습니다. 실제
          데이터 수정은 정식 가입 후 사용 가능합니다.
        </div>
      )}

      {lastResult && !applying && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200 rounded-md px-2 py-1.5">
          ✓ 적용 완료 — 대상 {lastResult.total_matched}건 · 갱신{' '}
          {lastResult.updated}건 · 자동매칭 {lastResult.auto_matched}건 · 매칭대기{' '}
          {lastResult.pending_match}건
          {lastResult.skipped_no_change > 0 && (
            <> · 변경없음 {lastResult.skipped_no_change}건</>
          )}
        </div>
      )}

      {/* 확인 다이얼로그 (대상 > 50건) */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false)
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
              <AlertTriangle className="text-amber-600" size={20} />
              <h3 className="text-base font-bold text-amber-900">
                일괄 적용 확인
              </h3>
              <button
                onClick={() => setConfirmOpen(false)}
                className="ml-auto p-1 rounded hover:bg-slate-100"
              >
                <X size={16} className="text-ink-2" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <p>
                <strong className="text-blue-700">{estimatedCount}건</strong>의
                업체에 키워드를{' '}
                <strong>{applyMode === 'replace' ? '교체' : '추가'}</strong>
                합니다.
              </p>
              <div className="text-xs bg-slate-50 rounded-lg px-3 py-2 ring-1 ring-slate-200">
                <div className="font-semibold mb-1">적용 키워드</div>
                <div className="flex flex-wrap gap-1">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 ring-1 ring-blue-200"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
              {applyMode === 'replace' && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 ring-1 ring-amber-200">
                  <strong>주의:</strong> 교체 모드는 기존 추적 키워드를 덮어씁니다.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 bg-slate-50 rounded-b-xl">
              <button
                onClick={() => setConfirmOpen(false)}
                className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md bg-white hover:bg-slate-100 ring-1 ring-slate-300"
              >
                취소
              </button>
              <button
                onClick={() => void doApply()}
                className="text-xs font-bold px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
              >
                <CheckCircle2 size={14} />
                {estimatedCount}건에 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * KeywordRegistryCard 의 1행 — 추적 키워드 chip 인라인 편집
 * ──────────────────────────────────────────────────────────── */
function KeywordRegistryRow(props: {
  place: RankPlaceOut
  onSave: (keywords: string[]) => Promise<void>
}) {
  const { place, onSave } = props
  const [draft, setDraft] = useState<string[]>(place.tracking_keywords)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  // place 변경(서버 동기화) 시 draft 동기화
  useEffect(() => {
    setDraft(place.tracking_keywords)
  }, [place.tracking_keywords])

  const dirty = useMemo(() => {
    if (draft.length !== place.tracking_keywords.length) return true
    return draft.some((k, i) => k !== place.tracking_keywords[i])
  }, [draft, place.tracking_keywords])

  const addKeyword = useCallback(() => {
    const v = input.trim()
    if (!v) return
    if (draft.includes(v)) {
      setInput('')
      return
    }
    if (draft.length >= 5) return
    setDraft([...draft, v])
    setInput('')
  }, [draft, input])

  const removeKeyword = useCallback(
    (kw: string) => {
      setDraft(draft.filter((k) => k !== kw))
    },
    [draft],
  )

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }, [dirty, draft, onSave, saving])

  const handleCancel = useCallback(() => {
    setDraft(place.tracking_keywords)
    setInput('')
  }, [place.tracking_keywords])

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-3 py-2 align-top">
        <div className="font-semibold text-ink-1 text-sm">
          {place.business_name || <span className="text-ink-2">—</span>}
        </div>
        {place.dong_changed && place.actual_dong && (
          <div className="mt-0.5 text-[10px] text-orange-700 inline-flex items-center gap-0.5">
            <AlertTriangle size={10} />
            실제 노출 {place.actual_dong}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top text-xs text-ink-1">
        {place.registered_dong || <span className="text-ink-2">—</span>}
      </td>
      <td className="px-3 py-2 align-top text-xs font-mono text-ink-1">
        {place.phone}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 ring-1 ring-blue-200"
            >
              {kw}
              <button
                type="button"
                onClick={() => removeKeyword(kw)}
                disabled={saving}
                className="hover:bg-blue-100 rounded-full p-0.5 disabled:opacity-50"
                aria-label={`${kw} 제거`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {draft.length < 5 && (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addKeyword()
                  }
                }}
                placeholder={draft.length === 0 ? '추적 키워드 입력' : '+ 추가'}
                disabled={saving}
                className="text-[11px] px-2 py-0.5 rounded-md ring-1 ring-slate-300 focus:ring-blue-500 focus:outline-none w-24 disabled:opacity-50"
              />
              {input.trim() && (
                <button
                  type="button"
                  onClick={addKeyword}
                  disabled={saving}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-0.5 disabled:opacity-50"
                >
                  <Plus size={11} />
                </button>
              )}
            </div>
          )}
          {dirty && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={11} />
                )}
                저장
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-ink-1 disabled:opacity-50"
              >
                취소
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 진행 배너
 *  - 업로드 직후 매칭 + 순위체크가 백그라운드 진행 중일 때 표시
 *  - 매칭 진행률 / 순위 채워짐 비율 시각화
 * ──────────────────────────────────────────────────────────── */
function ProgressBanner(props: { progress: RankCheckProgress }) {
  const { progress } = props
  const matchTotal = progress.total_places
  const matchDone = progress.auto_matched + progress.needs_manual
  const matchPct =
    matchTotal > 0 ? Math.min(100, Math.round((matchDone / matchTotal) * 100)) : 0
  const cellPct =
    progress.total_cells > 0
      ? Math.min(100, Math.round((progress.filled_cells / progress.total_cells) * 100))
      : 0
  const phase =
    progress.pending_match > 0
      ? '매칭 진행 중'
      : progress.filled_cells < progress.total_cells
        ? '순위 검증 중'
        : '완료'

  return (
    <Card className="p-4 border-blue-300 ring-1 ring-blue-200 bg-blue-50/60">
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className="text-blue-600 animate-spin" size={18} />
        <div className="text-sm font-bold text-blue-900">
          업로드 후 자동 처리 중 — {phase}
        </div>
        <span className="ml-auto text-[11px] text-blue-800/80">
          5초마다 자동 갱신
        </span>
      </div>

      {/* 매칭 진행률 */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[11px] text-blue-900 mb-1">
          <span className="font-semibold">① 070 매칭</span>
          <span className="font-mono">
            {matchDone} / {matchTotal} ({matchPct}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${matchPct}%` }}
          />
        </div>
      </div>

      {/* 순위 채워짐 진행률 */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-blue-900 mb-1">
          <span className="font-semibold">② 네이버 순위 검증</span>
          <span className="font-mono">
            {progress.filled_cells} / {progress.total_cells} 셀 ({cellPct}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${cellPct}%` }}
          />
        </div>
      </div>

      <div className="mt-3 text-[11px] text-blue-800/80">
        매칭이 끝나는 대로 매칭된 플레이스의 키워드별 순위가 네이버에서 자동 수집되어
        아래 매트릭스에 채워집니다. 페이지를 떠나도 백그라운드에서 계속 진행됩니다.
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 변경 노출 배너
 *  - 등록동≠실제 노출동인 케이스 알림
 *  - 클릭하면 펼쳐서 상호/등록동/실제노출동/place_id 표시
 * ──────────────────────────────────────────────────────────── */
function DongChangedBanner(props: { data: DongChangedListOut }) {
  const { data } = props
  const [open, setOpen] = useState(false)

  return (
    <Card className="p-0 overflow-hidden border-amber-300 ring-1 ring-amber-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 hover:bg-amber-100 text-left"
      >
        <AlertTriangle className="text-amber-600 shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-amber-900">
            변경 노출 발견 {data.count}건
          </div>
          <div className="text-xs text-amber-800/80">
            등록하신 동(洞)과 실제 네이버 플레이스 노출 동이 다른 케이스입니다. 클릭하여
            상세를 확인하세요.
          </div>
        </div>
        {open ? (
          <ChevronUp className="text-amber-700 shrink-0" size={18} />
        ) : (
          <ChevronDown className="text-amber-700 shrink-0" size={18} />
        )}
      </button>
      {open && (
        <div className="border-t border-amber-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-amber-50/60">
              <tr className="text-amber-900">
                <th className="px-3 py-2 text-left font-semibold">상호</th>
                <th className="px-3 py-2 text-left font-semibold">070전번</th>
                <th className="px-3 py-2 text-left font-semibold">등록동</th>
                <th className="px-3 py-2 text-left font-semibold">실제 노출동</th>
                <th className="px-3 py-2 text-left font-semibold">주소</th>
                <th className="px-3 py-2 text-left font-semibold">place_id</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className="border-t border-amber-100 hover:bg-amber-50/40">
                  <td className="px-3 py-2 font-semibold">{it.business_name || '-'}</td>
                  <td className="px-3 py-2 font-mono">{it.phone}</td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {it.registered_dong || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold inline-flex items-center gap-1">
                      <MapPin size={11} />
                      {it.actual_dong || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{it.address || '-'}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-2">
                    {it.place_id || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 요약 바
 *  - 자동매칭 / 매칭대기 / 수동확인필요 / 변경노출 4개 타일
 * ──────────────────────────────────────────────────────────── */
function SummaryBar(props: {
  list: RankPlaceListOut
  loading: boolean
  running: boolean
  onRefresh: () => void
  onRunMatch: () => void
  onExport: () => void
  onReset: () => void
}) {
  const { list, loading, running, onRefresh, onRunMatch, onExport, onReset } = props

  const Tile = ({
    label,
    value,
    color,
  }: {
    label: string
    value: number
    color: string
  }) => (
    <div
      className={clsx(
        'flex-1 px-3 py-2 rounded-lg ring-1',
        `bg-${color}-50 ring-${color}-200`,
      )}
    >
      <div className="text-[11px] font-semibold text-ink-2">{label}</div>
      <div className={clsx('text-lg font-bold', `text-${color}-700`)}>{value}</div>
    </div>
  )

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-bold flex items-center gap-2 mr-auto">
          <Search size={18} className="text-blue-600" />
          2단계 · 매칭 결과 ({list.total}건)
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
        <button
          onClick={onRunMatch}
          disabled={running}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1 disabled:opacity-50"
        >
          {running ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          매칭 재실행
        </button>
        <button
          onClick={onExport}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"
        >
          <Download size={14} />
          엑셀 다운로드
        </button>
        <button
          onClick={onReset}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 ring-1 ring-rose-200 inline-flex items-center gap-1"
          title="등록된 모든 플레이스와 순위 이력을 삭제하고 처음부터 다시 업로드합니다"
        >
          <Trash2 size={14} />
          전체 초기화
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Tile label="자동매칭" value={list.auto_matched} color="emerald" />
        <Tile label="매칭대기" value={list.pending} color="slate" />
        <Tile label="수동확인필요" value={list.needs_manual} color="amber" />
        <Tile label="변경노출" value={list.dong_changed_count} color="orange" />
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 등록동 × 키워드 매트릭스
 *  - rows = 등록 플레이스 (상호 + 등록동)
 *  - cols = 모든 추적 키워드 (unique)
 *  - cells = 현재 순위 (place×keyword 의 최신 rank)
 *  - 첫 컬럼 sticky
 * ──────────────────────────────────────────────────────────── */
function RankMatrix(props: {
  list: RankPlaceListOut
  reloadTick?: number
  onRowClick?: (place: RankPlaceOut) => void
  onManualCheck?: (placeIds: number[]) => void | Promise<void>
  manualChecking?: boolean
}) {
  const { list, reloadTick = 0, onRowClick, onManualCheck, manualChecking = false } = props

  // 매칭 완료(place_id 있음)된 행만 매트릭스에 표시
  const items = useMemo(() => list.items.filter((p) => !!p.place_id), [list])

  // 모든 키워드 union
  const allKeywords = useMemo(() => {
    const s = new Set<string>()
    items.forEach((p) => p.tracking_keywords.forEach((k) => s.add(k)))
    return Array.from(s)
  }, [items])

  // (placePk × keyword) → 최신 rank cache
  const [rankMap, setRankMap] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (items.length === 0) return
    setLoading(true)
    try {
      // 벌크 엔드포인트 1회 호출 (이전: place 수만큼 /history 호출 → 429 폭주)
      const resp: LatestRanksResponse = await listLatestRanks()
      const next: Record<string, number | null> = {}
      for (const cell of resp.cells) {
        // out_of_range = 75위 밖. UI 표시 마킹용으로 999 사용.
        if (cell.rank == null) {
          next[`${cell.place_pk}::${cell.keyword}`] = null
        } else if (cell.out_of_range) {
          next[`${cell.place_pk}::${cell.keyword}`] = 999
        } else {
          next[`${cell.place_pk}::${cell.keyword}`] = cell.rank
        }
      }
      setRankMap(next)
    } catch (e) {
      console.error('latest-ranks fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [items])

  useEffect(() => {
    reload()
  }, [reload])

  // 외부(페이지 폴링)에서 reloadTick 가 증가하면 매트릭스 새로고침
  useEffect(() => {
    if (reloadTick > 0) {
      reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick])

  if (items.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-ink-2">
        추적 키워드가 등록된 업체가 없습니다. 위 <strong>1단계 · 추적 키워드 등록</strong>{' '}
        카드를 펼쳐 monitor 등록 업체에 키워드를 추가해 주세요.
      </Card>
    )
  }

  const rankCell = (rank: number | null | undefined) => {
    if (rank == null) return <span className="text-ink-2 text-xs">—</span>
    if (rank > 75)
      return <span className="text-rose-600 font-semibold text-xs">75위 밖</span>
    const tone =
      rank <= 3
        ? 'bg-emerald-100 text-emerald-800'
        : rank <= 10
          ? 'bg-blue-100 text-blue-800'
          : rank <= 30
            ? 'bg-slate-100 text-slate-800'
            : 'bg-amber-100 text-amber-800'
    return (
      <span className={clsx('inline-block px-2 py-0.5 rounded font-bold text-xs', tone)}>
        {rank}위
      </span>
    )
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <CheckCircle2 className="text-blue-600" size={18} />
        <h2 className="text-base font-bold">3단계 · 등록동 × 키워드 매트릭스</h2>
        <span className="text-xs text-ink-2">(현재 최신 순위)</span>
        {loading && (
          <Loader2 className="text-blue-500 animate-spin ml-2" size={14} />
        )}
        <div className="ml-auto flex items-center gap-2">
          {onManualCheck && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                const ids = items.filter((p) => p.tracking_keywords.length > 0).map((p) => p.id)
                onManualCheck(ids)
              }}
              disabled={manualChecking || items.length === 0}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="타지역 정책상 자동 순위 추적이 비활성화되어 있습니다. 이 버튼으로 명시적으로 순위 검증을 시작하세요."
            >
              {manualChecking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Search size={12} />
              )}
              {manualChecking ? '검증 중...' : '지금 검증'}
            </button>
          )}
          <button
            onClick={reload}
            disabled={loading}
            className="text-xs font-semibold px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </div>
      {/* 정책 안내 배너 — 자동 추적 비활성, 수동 검증 안내 */}
      <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 flex items-center gap-2">
        <AlertTriangle size={12} className="flex-shrink-0" />
        <span>
          타지역 환경에서는 <b>자동 순위 추적이 비활성화</b>되어 있습니다.
          순위를 확인하려면 우측 상단 <b>"지금 검증"</b> 버튼을 눌러주세요.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr className="text-ink-2">
              <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-slate-50 z-10 min-w-[180px]">
                상호 / 등록동
              </th>
              {allKeywords.map((kw) => (
                <th
                  key={kw}
                  className="px-3 py-2 text-center font-semibold whitespace-nowrap"
                >
                  {kw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => onRowClick?.(p)}
                className={clsx(
                  'border-t border-slate-100 hover:bg-blue-50/30',
                  onRowClick && 'cursor-pointer',
                )}
              >
                <td className="px-3 py-2 sticky left-0 bg-white z-10 border-r border-slate-100">
                  <div className="font-semibold text-blue-700 hover:underline">
                    {p.business_name || '-'}
                  </div>
                  <div className="text-[11px] text-ink-2 flex items-center gap-1 mt-0.5">
                    <span className="px-1 rounded bg-slate-100">
                      {p.registered_dong || '-'}
                    </span>
                    {p.dong_changed && p.actual_dong && (
                      <span className="px-1 rounded bg-amber-100 text-amber-800 inline-flex items-center gap-0.5">
                        <MapPin size={10} />
                        실제 {p.actual_dong}
                      </span>
                    )}
                  </div>
                </td>
                {allKeywords.map((kw) => {
                  const tracked = p.tracking_keywords.includes(kw)
                  if (!tracked) {
                    return (
                      <td
                        key={kw}
                        className="px-3 py-2 text-center text-ink-2 text-[11px]"
                      >
                        ·
                      </td>
                    )
                  }
                  const r = rankMap[`${p.id}::${kw}`]
                  return (
                    <td key={kw} className="px-3 py-2 text-center">
                      {rankCell(r)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 키워드별 추이 그래프 섹션
 *  - 모든 키워드별로 1개씩 카드
 *  - 각 카드 안에 해당 키워드를 추적하는 모든 플레이스의 30일 라인을 겹쳐서 그림
 * ──────────────────────────────────────────────────────────── */
function KeywordGraphSection(props: { list: RankPlaceListOut }) {
  const { list } = props

  const items = useMemo(() => list.items.filter((p) => !!p.place_id), [list])

  const allKeywords = useMemo(() => {
    const s = new Set<string>()
    items.forEach((p) => p.tracking_keywords.forEach((k) => s.add(k)))
    return Array.from(s)
  }, [items])

  // 어떤 키워드 카드를 펼칠지 (lazy load) — 펼친 카드만 /history 호출.
  // 자동 로드하면 모든 (place×keyword) 만큼 호출되어 429 폭주.
  const [openedKw, setOpenedKw] = useState<string | null>(null)

  if (items.length === 0 || allKeywords.length === 0) return null

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <LineChartIcon className="text-blue-600" size={18} />
        <h2 className="text-base font-bold">4단계 · 키워드별 30일 순위 추이</h2>
        <span className="text-xs text-ink-2">(클릭해서 펼치기)</span>
      </div>
      <div className="space-y-2">
        {allKeywords.map((kw) => {
          const tracking = items.filter((p) => p.tracking_keywords.includes(kw))
          const open = openedKw === kw
          return (
            <div key={kw} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenedKw(open ? null : kw)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left"
              >
                <LineChartIcon className="text-blue-600" size={14} />
                <span className="font-bold text-sm">{kw}</span>
                <span className="text-xs text-ink-2">
                  {tracking.length}개 플레이스 추적 중
                </span>
                <span className="ml-auto">
                  {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </button>
              {open && (
                <div className="border-t border-slate-200 p-3">
                  <KeywordRankCard keyword={kw} places={items} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 단일 키워드 카드
 *  - 키워드를 추적하는 모든 플레이스의 30일 라인 차트
 * ──────────────────────────────────────────────────────────── */
interface KeywordSeriesEntry {
  placePk: number
  label: string
  points: { check_date: string; rank: number | null; out_of_range: boolean }[]
}

function KeywordRankCard(props: { keyword: string; places: RankPlaceOut[] }) {
  const { keyword, places } = props
  const tracking = useMemo(
    () => places.filter((p) => p.tracking_keywords.includes(keyword)),
    [places, keyword],
  )

  const [series, setSeries] = useState<KeywordSeriesEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)

    // 동시성 제한 (최대 4) — 429 방지
    const queue = [...tracking]
    const results: KeywordSeriesEntry[] = []
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()
        if (!p) break
        try {
          const hist = await getRankHistory(p.id, 30)
          const s = hist.series.find((x) => x.keyword === keyword)
          results.push({
            placePk: p.id,
            label: `${p.business_name ?? '-'} (${p.registered_dong ?? '-'})`,
            points: s?.points ?? [],
          })
        } catch (e) {
          console.error('history failed', p.id, e)
        }
      }
    }
    Promise.all(Array.from({ length: Math.min(4, tracking.length) }, worker))
      .then(() => {
        if (!alive) return
        setSeries(results.filter((e) => e.points.length > 0))
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [tracking, keyword])

  if (tracking.length === 0) return null

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs text-ink-2">
          {tracking.length}개 플레이스 · 최근 30일
        </span>
        {loading && (
          <Loader2 className="text-blue-500 animate-spin ml-2" size={12} />
        )}
      </div>
      {series.length === 0 && !loading ? (
        <div className="py-10 text-center text-xs text-ink-2">
          아직 기록된 순위 데이터가 없습니다. 매일 자동체크 이후 데이터가 누적됩니다.
        </div>
      ) : (
        <MultiLineChart series={series} />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 다중 라인 SVG 차트 (Y축 반전, 1위=상단)
 * ──────────────────────────────────────────────────────────── */
const LINE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
]

function MultiLineChart(props: { series: KeywordSeriesEntry[] }) {
  const { series } = props

  const W = 760
  const H = 240
  const PAD_L = 40
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 28

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  // 가장 긴 시리즈의 날짜 축 기준
  const longest =
    series.reduce(
      (acc, s) => (s.points.length > acc.points.length ? s : acc),
      series[0],
    ) ?? null
  const len = longest?.points.length ?? 0
  if (len === 0) return null

  const ranks = series.flatMap((s) =>
    s.points.map((p) => p.rank).filter((r): r is number => r != null),
  )
  const maxRank = Math.max(75, ...(ranks.length ? ranks : [10]))

  const x = (i: number) =>
    PAD_L + (len <= 1 ? innerW / 2 : (innerW * i) / (len - 1))
  const y = (r: number) => PAD_T + (innerH * (r - 1)) / Math.max(1, maxRank - 1)

  const yTicks = [1, 5, 10, 25, 50, 75].filter((t) => t <= maxRank)

  // 각 시리즈의 path 계산
  const lines = series.map((s, idx) => {
    const segments: string[] = []
    let current: string[] = []
    s.points.forEach((p, i) => {
      if (p.rank == null || p.out_of_range) {
        if (current.length) {
          segments.push(current.join(' '))
          current = []
        }
      } else {
        const prefix = current.length === 0 ? 'M' : 'L'
        current.push(`${prefix}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`)
      }
    })
    if (current.length) segments.push(current.join(' '))
    return {
      idx,
      label: s.label,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      segments,
      points: s.points,
      lastRank: s.points[s.points.length - 1]?.rank ?? null,
    }
  })

  return (
    <div>
      <div className="bg-slate-50 rounded-lg p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Y axis grid */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(t)}
                y2={y(t)}
                stroke="#e2e8f0"
                strokeDasharray={t === 1 ? '0' : '3 3'}
              />
              <text
                x={PAD_L - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize="10"
                fill="#64748b"
              >
                {t}
              </text>
            </g>
          ))}
          {/* X axis labels */}
          {longest && longest.points.length > 0 && (
            <>
              <text
                x={x(0)}
                y={H - 8}
                fontSize="9"
                fill="#64748b"
                textAnchor="start"
              >
                {longest.points[0].check_date.slice(5)}
              </text>
              {longest.points.length > 2 && (
                <text
                  x={x(Math.floor(longest.points.length / 2))}
                  y={H - 8}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="middle"
                >
                  {longest.points[
                    Math.floor(longest.points.length / 2)
                  ].check_date.slice(5)}
                </text>
              )}
              {longest.points.length > 1 && (
                <text
                  x={x(longest.points.length - 1)}
                  y={H - 8}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="end"
                >
                  {longest.points[longest.points.length - 1].check_date.slice(5)}
                </text>
              )}
            </>
          )}
          {/* Lines + points */}
          {lines.map((ln) => (
            <g key={ln.idx}>
              {ln.segments.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={ln.color}
                  strokeWidth="2"
                />
              ))}
              {ln.points.map((p, i) => {
                if (p.rank == null || p.out_of_range) return null
                return (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p.rank)}
                    r="2.5"
                    fill={ln.color}
                    stroke="white"
                    strokeWidth="1"
                  />
                )
              })}
            </g>
          ))}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {lines.map((ln) => (
          <div key={ln.idx} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: ln.color }}
            />
            <span className="text-ink-1">{ln.label}</span>
            {ln.lastRank != null ? (
              <span className="text-emerald-700 font-semibold">
                {ln.lastRank}위
              </span>
            ) : (
              <span className="text-rose-600 font-semibold">75위 밖</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 플레이스 상세 모달
 *  - 매트릭스 행 클릭 시 오픈
 *  - 업체 기본정보(070/등록동/실제 노출동/place_id/매칭일시)
 *  - 키워드별 최신 순위 + 7일/30일 변동
 *  - 네이버 플레이스(m.place.naver.com) 외부 링크
 * ──────────────────────────────────────────────────────────── */
function PlaceDetailModal(props: {
  place: RankPlaceOut
  onClose: () => void
}) {
  const { place, onClose } = props

  const [history, setHistory] = useState<RankHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 경쟁업체 펼치기 (키워드 클릭 시) — 키워드별 캐시
  const [openedKw, setOpenedKw] = useState<string | null>(null)
  const [compCache, setCompCache] = useState<Record<string, CompetitionResponse>>({})
  const [compLoadingKw, setCompLoadingKw] = useState<string | null>(null)
  const [compErrorKw, setCompErrorKw] = useState<Record<string, string>>({})

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // history fetch (30일)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getRankHistory(place.id, 30)
      .then((resp) => {
        if (!cancelled) setHistory(resp)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || '이력 조회 실패')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [place.id])

  // 키워드 행 클릭 → 경쟁업체 펼치기/접기
  const toggleCompetition = useCallback(
    async (kw: string) => {
      if (openedKw === kw) {
        setOpenedKw(null)
        return
      }
      setOpenedKw(kw)
      // 캐시 hit 면 즉시 표시
      if (compCache[kw]) return
      setCompLoadingKw(kw)
      setCompErrorKw((m) => ({ ...m, [kw]: '' }))
      try {
        const resp = await getCompetition(place.id, kw)
        setCompCache((c) => ({ ...c, [kw]: resp }))
      } catch (e: any) {
        const msg =
          e?.response?.data?.detail || e?.message || '경쟁업체 조회 실패'
        setCompErrorKw((m) => ({ ...m, [kw]: String(msg) }))
      } finally {
        setCompLoadingKw(null)
      }
    },
    [openedKw, compCache, place.id],
  )

  // 키워드별 최신/7일전/30일전 rank 추출
  const summaries = useMemo(() => {
    if (!history) {
      return place.tracking_keywords.map((kw) => ({
        keyword: kw,
        latest: null as number | null,
        latestOOR: false,
        latestDate: null as string | null,
        diff7: null as number | null,
        diff30: null as number | null,
        points: 0,
      }))
    }
    const byKw = new Map(history.series.map((s) => [s.keyword, s.points]))
    return place.tracking_keywords.map((kw) => {
      const pts = byKw.get(kw) ?? []
      const filled = pts.filter((p) => p.rank != null) // 75위 밖이어도 out_of_range로 표기됨
      const last = pts[pts.length - 1] ?? null
      const latest = last?.rank ?? null
      const latestOOR = !!last?.out_of_range
      const latestDate = last?.check_date ?? null
      // 7일/30일 전 비교: 동일 시리즈 내 인덱스 기준 (최신 = 마지막)
      const pickPast = (daysAgo: number): number | null => {
        if (pts.length < 2) return null
        // pts는 check_date asc 정렬 가정. daysAgo 만큼 떨어진 가까운 포인트.
        const target = pts.length - 1 - daysAgo
        if (target < 0) return null
        const p = pts[target]
        return p?.rank ?? null
      }
      const past7 = pickPast(7)
      const past30 = pickPast(Math.min(30, pts.length - 1))
      const diff = (past: number | null): number | null => {
        if (latest == null || past == null) return null
        return past - latest // 양수=상승(과거보다 좋아짐), 음수=하락
      }
      return {
        keyword: kw,
        latest,
        latestOOR,
        latestDate,
        diff7: diff(past7),
        diff30: diff(past30),
        points: filled.length,
      }
    })
  }, [history, place.tracking_keywords])

  const naverPlaceUrl = place.place_id
    ? `https://m.place.naver.com/place/${place.place_id}/home`
    : null
  const naverMapUrl = place.place_id
    ? `https://m.map.naver.com/search?query=${encodeURIComponent(
        (place.registered_dong ?? '') + ' ' + (place.business_name ?? ''),
      )}`
    : null

  const rankBadge = (rank: number | null, oor: boolean) => {
    if (rank == null && !oor) {
      return <span className="text-ink-2 text-xs">—</span>
    }
    if (oor || (rank != null && rank > 75)) {
      return (
        <span className="px-2 py-0.5 rounded font-bold text-xs bg-rose-100 text-rose-700">
          75위 밖
        </span>
      )
    }
    const r = rank as number
    const tone =
      r <= 3
        ? 'bg-emerald-100 text-emerald-800'
        : r <= 10
          ? 'bg-blue-100 text-blue-800'
          : r <= 30
            ? 'bg-slate-100 text-slate-800'
            : 'bg-amber-100 text-amber-800'
    return (
      <span className={clsx('px-2 py-0.5 rounded font-bold text-xs', tone)}>
        {r}위
      </span>
    )
  }

  const diffBadge = (d: number | null) => {
    if (d == null) return <span className="text-ink-2 text-[11px]">—</span>
    if (d === 0)
      return <span className="text-ink-2 text-[11px] font-semibold">±0</span>
    if (d > 0)
      return (
        <span className="text-emerald-700 text-[11px] font-semibold">
          ▲{d}
        </span>
      )
    return (
      <span className="text-rose-600 text-[11px] font-semibold">▼{-d}</span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200">
          <Building2 className="text-blue-600 shrink-0" size={20} />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold truncate">
              {place.business_name || '(상호 미등록)'}
            </h3>
            <div className="text-[11px] text-ink-2 mt-0.5 flex items-center gap-1 flex-wrap">
              <span className="px-1 rounded bg-slate-100">
                {place.registered_dong || '-'}
              </span>
              {place.dong_changed && place.actual_dong && (
                <span className="px-1 rounded bg-amber-100 text-amber-800 inline-flex items-center gap-0.5">
                  <MapPin size={10} />
                  실제 {place.actual_dong}
                </span>
              )}
              <span
                className={clsx(
                  'px-1 rounded font-semibold',
                  place.match_status === 'AUTO_MATCHED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : place.match_status === 'NEEDS_MANUAL'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700',
                )}
              >
                {place.match_status ?? 'PENDING_MATCH'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 p-1 rounded hover:bg-slate-100"
            aria-label="닫기"
          >
            <X size={16} className="text-ink-2" />
          </button>
        </div>

        {/* 본문 — 스크롤 */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 기본 정보 */}
          <section>
            <h4 className="text-xs font-bold text-ink-2 mb-2 uppercase tracking-wide">
              기본 정보
            </h4>
            <div className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <Phone size={12} className="text-ink-2 shrink-0" />
                <span className="text-ink-2">070전번:</span>
                <span className="font-mono">{place.phone}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin size={12} className="text-ink-2 shrink-0" />
                <span className="text-ink-2">등록동:</span>
                <span className="font-semibold">
                  {place.registered_dong || '-'}
                </span>
              </div>
              {place.matched?.category && (
                <div className="flex items-center gap-1.5">
                  <span className="text-ink-2">카테고리:</span>
                  <span>{place.matched.category}</span>
                </div>
              )}
              {place.matched?.address && (
                <div className="flex items-center gap-1.5 sm:col-span-2">
                  <span className="text-ink-2">매칭 주소:</span>
                  <span className="text-ink-1">{place.matched.address}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-ink-2">place_id:</span>
                <span className="font-mono text-[11px]">
                  {place.place_id || '-'}
                </span>
              </div>
              {place.matched_at && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-ink-2 shrink-0" />
                  <span className="text-ink-2">매칭일시:</span>
                  <span className="text-[11px]">
                    {new Date(place.matched_at).toLocaleString('ko-KR')}
                  </span>
                </div>
              )}
            </div>

            {/* 외부 링크 */}
            {(naverPlaceUrl || naverMapUrl) && (
              <div className="flex items-center gap-2 mt-3">
                {naverPlaceUrl && (
                  <a
                    href={naverPlaceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  >
                    <ExternalLink size={11} />
                    네이버 플레이스 열기
                  </a>
                )}
                {naverMapUrl && (
                  <a
                    href={naverMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md bg-blue-100 text-blue-800 hover:bg-blue-200"
                  >
                    <Search size={11} />
                    네이버 지도 검색
                  </a>
                )}
              </div>
            )}
          </section>

          {/* 키워드별 순위 */}
          <section>
            <h4 className="text-xs font-bold text-ink-2 mb-2 uppercase tracking-wide flex items-center gap-2">
              키워드별 최신 순위 (30일 변동)
              {loading && (
                <Loader2
                  className="text-blue-500 animate-spin"
                  size={12}
                />
              )}
              <span className="text-[10px] text-ink-2 normal-case tracking-normal font-normal ml-1">
                · 행 클릭 시 경쟁업체 1~75위 펼치기
              </span>
            </h4>
            {error ? (
              <div className="text-xs text-rose-600 bg-rose-50 rounded px-3 py-2">
                {error}
              </div>
            ) : place.tracking_keywords.length === 0 ? (
              <div className="text-xs text-ink-2 bg-slate-50 rounded px-3 py-2">
                추적 키워드가 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-50">
                    <tr className="text-ink-2">
                      <th className="px-2 py-1.5 text-left font-semibold">
                        키워드
                      </th>
                      <th className="px-2 py-1.5 text-center font-semibold">
                        현재 순위
                      </th>
                      <th className="px-2 py-1.5 text-center font-semibold">
                        7일 전 대비
                      </th>
                      <th className="px-2 py-1.5 text-center font-semibold">
                        30일 전 대비
                      </th>
                      <th className="px-2 py-1.5 text-center font-semibold">
                        기록
                      </th>
                      <th className="px-2 py-1.5 text-center font-semibold w-8">
                        {/* expand icon */}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((s) => {
                      const isOpen = openedKw === s.keyword
                      const comp = compCache[s.keyword]
                      const compLoading = compLoadingKw === s.keyword
                      const compError = compErrorKw[s.keyword]
                      return (
                        <Fragment key={s.keyword}>
                          <tr
                            onClick={() => toggleCompetition(s.keyword)}
                            className={clsx(
                              'border-t border-slate-100 cursor-pointer hover:bg-blue-50/40',
                              isOpen && 'bg-blue-50/60',
                            )}
                          >
                            <td className="px-2 py-1.5 font-semibold text-blue-700">
                              {s.keyword}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {rankBadge(s.latest, s.latestOOR)}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {diffBadge(s.diff7)}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {diffBadge(s.diff30)}
                            </td>
                            <td className="px-2 py-1.5 text-center text-[11px] text-ink-2">
                              {s.points}건
                            </td>
                            <td className="px-2 py-1.5 text-center text-ink-2">
                              {compLoading ? (
                                <Loader2
                                  className="inline animate-spin text-blue-500"
                                  size={12}
                                />
                              ) : isOpen ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-slate-50/50">
                              <td colSpan={6} className="px-2 py-2">
                                {compError ? (
                                  <div className="text-xs text-rose-600 bg-rose-50 rounded px-2 py-1.5">
                                    {compError}
                                  </div>
                                ) : !comp ? (
                                  <div className="text-xs text-ink-2 py-2 text-center">
                                    <Loader2
                                      className="inline animate-spin mr-1 text-blue-500"
                                      size={12}
                                    />
                                    경쟁업체 불러오는 중…
                                  </div>
                                ) : (
                                  <CompetitionList comp={comp} />
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] text-ink-2 mt-2">
                  ▲ 상승(과거보다 좋은 순위) · ▼ 하락 · 75위 밖은 비교에서
                  제외됨. 행 클릭 시 그 키워드의 동×키워드 검색 결과 1~75위가
                  펼쳐집니다.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* 푸터 */}
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50 rounded-b-xl border-t border-slate-200">
          <span className="text-[11px] text-ink-2">
            ESC 또는 바깥 영역 클릭으로 닫기
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-200 hover:bg-slate-300 text-ink-1"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 * 컴포넌트: 경쟁업체 리스트 (모달 안에서 키워드 펼치기 시)
 *  - 1~75위 전체 표시, 내 업체는 강조 배경
 *  - 1~3위 emerald, 4~10 blue, 11~30 slate, 31~75 amber 배지
 *  - 네이버 플레이스 직링크 외부 아이콘
 * ──────────────────────────────────────────────────────────── */
function CompetitionList(props: { comp: CompetitionResponse }) {
  const { comp } = props

  const rankTone = (r: number) =>
    r <= 3
      ? 'bg-emerald-100 text-emerald-800'
      : r <= 10
        ? 'bg-blue-100 text-blue-800'
        : r <= 30
          ? 'bg-slate-100 text-slate-800'
          : 'bg-amber-100 text-amber-800'

  if (comp.error) {
    return (
      <div className="text-xs text-rose-600 bg-rose-50 rounded px-2 py-1.5">
        네이버 검색 실패: {comp.error}
      </div>
    )
  }

  if (comp.items.length === 0) {
    return (
      <div className="text-xs text-ink-2 bg-slate-50 rounded px-2 py-2 text-center">
        검색 결과가 없습니다. (쿼리: <code>{comp.query}</code>)
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* 헤더: 쿼리 + 내 순위 */}
      <div className="flex items-center justify-between text-[11px] text-ink-2 px-1">
        <div>
          쿼리: <code className="bg-white px-1 rounded">{comp.query}</code>
          {' · '}
          전체 {comp.total_count}건 중 {comp.items.length}건
        </div>
        <div>
          내 업체:{' '}
          {comp.my_rank != null ? (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded font-bold',
                rankTone(comp.my_rank),
              )}
            >
              {comp.my_rank}위
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded font-bold bg-rose-100 text-rose-700">
              75위 밖
            </span>
          )}
        </div>
      </div>

      {/* 리스트 */}
      <div className="max-h-[360px] overflow-y-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-ink-2">
              <th className="px-2 py-1.5 text-center font-semibold w-12">
                순위
              </th>
              <th className="px-2 py-1.5 text-left font-semibold">상호</th>
              <th className="px-2 py-1.5 text-left font-semibold">카테고리</th>
              <th className="px-2 py-1.5 text-left font-semibold hidden sm:table-cell">
                주소
              </th>
              <th className="px-2 py-1.5 text-center font-semibold w-12">
                {/* link */}
              </th>
            </tr>
          </thead>
          <tbody>
            {comp.items.map((it) => (
              <tr
                key={`${it.rank}-${it.place_id}`}
                className={clsx(
                  'border-t border-slate-100',
                  it.is_me
                    ? 'bg-emerald-50 ring-1 ring-emerald-300'
                    : 'hover:bg-slate-50',
                )}
              >
                <td className="px-2 py-1.5 text-center">
                  <span
                    className={clsx(
                      'inline-block px-1.5 py-0.5 rounded font-bold text-[11px]',
                      rankTone(it.rank),
                    )}
                  >
                    {it.rank}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <div
                    className={clsx(
                      'font-semibold',
                      it.is_me && 'text-emerald-800',
                    )}
                  >
                    {it.name || '-'}
                    {it.is_me && (
                      <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold">
                        내 업체
                      </span>
                    )}
                  </div>
                  {(it.phone || it.virtual_phone) && (
                    <div className="text-[10px] text-ink-2 font-mono">
                      {it.phone || it.virtual_phone}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-ink-2 text-[11px]">
                  {it.category || '-'}
                </td>
                <td className="px-2 py-1.5 text-ink-2 text-[11px] hidden sm:table-cell">
                  {it.address || '-'}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {it.place_id && (
                    <a
                      href={`https://m.place.naver.com/place/${it.place_id}/home`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center text-blue-600 hover:text-blue-800"
                      aria-label="네이버 플레이스 열기"
                    >
                      <ExternalLink size={11} />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
