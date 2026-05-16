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
  Users,
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
  triggerRerunOutOfRange,
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

  // ── 동적 폴링 (Phase 7) ──────────────────────────────────────
  // 폴링 트리거:
  //   · progress.in_progress     : 매칭 대기 OR 수동 검증 잡 실행 중
  //                                (Phase 7 New Issue 부터는 "빈 셀 존재" 만으로는
  //                                 in_progress=True 가 되지 않음 — 워커가 stuck 셀을
  //                                 만들어도 무한 폴링이 발생하지 않도록 변경)
  //   · progress.manual_running  : 사용자가 '지금 검증' 으로 백그라운드 잡 실행 중 (Phase 7 신규)
  // 폴링 주기:
  //   · manual_running 일 때는 3초 (사용자가 직접 트리거 → 즉각적 피드백 우선)
  //   · 그렇지 않으면 5초 (백그라운드 매칭 완료 대기 — 부하 감소)
  const inProgress = progress?.in_progress ?? false
  const manualRunningBackend = progress?.manual_running ?? false
  const shouldPoll = inProgress || manualRunningBackend
  const pollInterval = manualRunningBackend ? 3000 : 5000
  useEffect(() => {
    if (!shouldPoll) return
    const t = window.setInterval(async () => {
      const p = await fetchProgress()
      // 매칭이 아직 진행 중이면 places/dong-changed도 다시 가져옴
      if (p && p.pending_match > 0) {
        await fetchAll()
      }
      // 매트릭스 reload 트리거 — 새 셀이 들어왔을 가능성
      setMatrixReloadTick((n) => n + 1)
    }, pollInterval)
    return () => window.clearInterval(t)
  }, [shouldPoll, pollInterval, fetchProgress, fetchAll])

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

  /* ── 수동 순위 검증 트리거 (타지역 정책 — 자동 트리거 모두 비활성화) ──
   * Phase 7 변경:
   *  · 로컬 manualLocal 은 POST 직후~첫 /progress 폴링 사이의 짧은 갭 동안만 true.
   *  · 권위 신호는 progress.manual_running (백엔드가 잡 종료 시 try/finally 로 해제).
   *  · 청크 분할: place 수가 CHUNK_SIZE 보다 크면 N개씩 잘라 순차 호출
   *      "검증중 → 쿨다운(폴링) → 검증중" 패턴 (Phase 6 LiveCheckTab 과 유사 UX).
   *  · 청크 사이엔 백엔드 manual_running 가 false 가 될 때까지 폴링 대기 후
   *    CHUNK_COOLDOWN_MS 휴식 (네이버 부하 분산).
   */
  const [manualLocal, setManualLocal] = useState(false)
  // 청크 진행 상태 — 매트릭스 버튼이 "청크 N/M" 표시할 때 사용
  //
  // [2026-05-16 phase 'naver_paused' 추가]
  // 청크 루프 도중 백엔드 회로차단(OPEN)이 감지되면 다음 청크를 트리거하지 않고
  // phase='naver_paused' 로 전환해서 차단 해제까지 대기한다. CLOSED 가 되면
  // 같은 청크 인덱스를 재시도하여 자동으로 이어진다. 이렇게 하면 사용자가
  // "청크 1/10 쿨다운" 상태로 영원히 멈춰 있다가 수동 새로고침할 필요가 없다.
  const [chunkPhase, setChunkPhase] = useState<{
    current: number
    total: number
    phase: 'checking' | 'cooldown' | 'naver_paused'
  } | null>(null)

  // 최종 권위 busy 신호: 로컬 즉시성 OR 백엔드 truth.
  // RankMatrix.manualChecking 으로 내려보낸다.
  const manualChecking =
    manualLocal || (progress?.manual_running ?? false) || chunkPhase != null

  const handleManualRankCheck = useCallback(
    async (placeIds: number[] = []) => {
      // [2026-05-16 fix] 회로차단 OPEN 상태에서도 클릭을 받아들인다.
      //   기존 정책: OPEN 이면 즉시 토스트 후 return → 사용자가 새로고침 + 다시 누르면
      //              버튼이 안 눌린 것처럼 보이는 UX 버그.
      //   신 정책:   pre-check 단계에서 'naver_paused' 로 진입해 cooldown 만료까지
      //              자동 대기 → 풀리면 자동 시작. 사용자는 한 번만 누르면 됨.
      const fresh = await fetchProgress()
      // 백엔드가 이미 잡을 돌리고 있다면 중복 트리거만 금지.
      if (fresh?.manual_running) {
        showToast(
          '이미 백그라운드에서 검증 중입니다. 완료 후 다시 시도해주세요.',
        )
        return
      }
      if (fresh?.naver_circuit_open) {
        // 안내만 한 번 — 그래도 루프는 진입해서 자동 재개 처리에 맡긴다.
        showToast(
          '네이버 일시 차단 상태입니다. 차단이 풀리면 자동으로 검증을 시작합니다.',
        )
      }

      // 청크 분할 설정
      // - 한 청크당 N건 (네이버 호출량 = N × 키워드수). 30건이면 평균 ~150 쿼리 / ~20초 내외.
      // - 사용자가 단일 행 검증을 누르면 (1건) 청크 분할 없음 → 즉시 처리.
      const CHUNK_SIZE = 30
      const CHUNK_COOLDOWN_MS = 1500
      const POLL_INTERVAL_MS = 3000
      const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5분 (안전장치)

      const ids = placeIds.length > 0 ? [...placeIds] : []
      const chunks: number[][] = []
      if (ids.length === 0) {
        // 빈 배열 = '전체 검증' — 백엔드가 알아서 본인 자격 행 전부 처리.
        // 단일 호출이지만 백엔드 잡은 길 수 있으므로 chunkPhase 로 표시.
        chunks.push([])
      } else {
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
          chunks.push(ids.slice(i, i + CHUNK_SIZE))
        }
      }

      const totalChunks = chunks.length
      setManualLocal(true)
      // [2026-05-16] 회로차단 대기 안전장치: cooldown=120s × 최대 5회 재시도 = 10분
      const NAVER_PAUSE_POLL_MS = 5000
      const NAVER_PAUSE_MAX_WAIT_MS = 10 * 60 * 1000

      try {
        let idx = 0
        while (idx < totalChunks) {
          const chunkIds = chunks[idx]

          // ─── A) 청크 트리거 직전 회로차단 사전 체크
          // OPEN 이면 차단 풀릴 때까지 폴링하면서 같은 인덱스 재시도
          const preFresh = await fetchProgress()

          // [2026-05-16] 100% 완료 시 청크 루프 조기 종료
          //   배경: 사용자가 큰 잡을 트리거하면 청크 10개로 분할되는데, 청크 2까지
          //         진행되어 (place×keyword) 누적 진행률이 100% 가 되면 나머지 8개
          //         청크는 같은 place들에 대해 같은 검증을 또 돌리게 됨 →
          //         (1) 불필요한 Naver 호출, (2) 회로차단 재트립 위험, (3) UX 답답.
          //   조건: total_cells > 0 (백엔드가 잡 메타 set 한 상태) AND
          //         filled_cells >= total_cells (모든 셀 검증 완료).
          //   첫 청크(idx=0)는 무조건 트리거 — 그 전에 total_cells 가 0 일 수 있음.
          if (
            idx > 0 &&
            preFresh &&
            preFresh.total_cells > 0 &&
            preFresh.filled_cells >= preFresh.total_cells &&
            !preFresh.manual_running
          ) {
            showToast(
              `검증 완료 — 남은 ${totalChunks - idx}개 청크는 이미 결과가 있어 생략합니다.`,
            )
            break
          }

          if (preFresh?.naver_circuit_open) {
            setChunkPhase({
              current: idx + 1,
              total: totalChunks,
              phase: 'naver_paused',
            })
            const pauseDeadline = Date.now() + NAVER_PAUSE_MAX_WAIT_MS
            let recovered = false
            while (Date.now() < pauseDeadline) {
              await new Promise((r) => window.setTimeout(r, NAVER_PAUSE_POLL_MS))
              const p = await fetchProgress()
              if (!p?.naver_circuit_open) {
                recovered = true
                break
              }
            }
            if (!recovered) {
              showToast(
                '네이버 차단 해제 대기 시간이 초과되어 청크 루프를 종료합니다. 잠시 후 다시 시도해주세요.',
              )
              break
            }
            // 차단 풀렸음 — 같은 청크 인덱스로 재진입
            continue
          }

          setChunkPhase({ current: idx + 1, total: totalChunks, phase: 'checking' })

          try {
            const resp = await triggerManualRankCheck(chunkIds)
            if (totalChunks === 1) {
              showToast(
                resp.message ??
                  `${resp.started}개 업체 검증을 시작했습니다. 매트릭스에 차례로 반영됩니다.`,
              )
            } else {
              showToast(
                `청크 ${idx + 1}/${totalChunks} 시작 — ${resp.started}건 검증 중...`,
              )
            }
            // 즉시 한 번 progress 동기화 → 백엔드 manual_running 이 true 가 됨
            await fetchProgress()
          } catch (e) {
            // 409 (이미 검증 중) 등 — 다음 청크는 시도하지 않고 break
            console.error('manual rank chunk failed', e)
            showToast(
              `청크 ${idx + 1}/${totalChunks} 실패: ${(e as Error).message}. 잠시 후 다시 시도해주세요.`,
            )
            break
          }

          // 마지막 청크가 아니면 — 백엔드 잡 완료를 기다린 뒤 쿨다운 후 다음 청크
          if (idx < totalChunks - 1) {
            setChunkPhase({ current: idx + 1, total: totalChunks, phase: 'cooldown' })
            // 1) 현재 청크의 manual_running 이 false 가 될 때까지 폴링
            const deadline = Date.now() + POLL_TIMEOUT_MS
            // 첫 폴링은 짧은 지연 후 (백엔드가 busy=true set 할 시간을 줌)
            await new Promise((r) => window.setTimeout(r, 800))
            let circuitTrippedMidway = false
            while (Date.now() < deadline) {
              const p = await fetchProgress()
              if (!p?.manual_running) break
              // 청크가 도는 도중 회로차단이 OPEN 되면 즉시 빠져나와
              // 다음 루프 헤드의 사전 체크에서 'naver_paused' 로 잡힘
              if (p?.naver_circuit_open) {
                circuitTrippedMidway = true
                break
              }
              await new Promise((r) => window.setTimeout(r, POLL_INTERVAL_MS))
            }
            // 2) 네이버 부하 분산용 짧은 쿨다운 (회로차단 trip 시엔 생략)
            if (!circuitTrippedMidway) {
              await new Promise((r) => window.setTimeout(r, CHUNK_COOLDOWN_MS))
            }
            // 3) 매트릭스에 누적된 셀 반영
            setMatrixReloadTick((n) => n + 1)
            await fetchAll()
          }

          idx += 1
        }

        // 모든 청크가 트리거되었음. 마지막 청크의 백엔드 잡 종료는 자동 폴링이
        // 알아서 감지 → manualChecking 이 자연스럽게 false 가 된다.
        // 매트릭스에 최신 상태 반영을 위한 트리거.
        window.setTimeout(() => {
          setMatrixReloadTick((n) => n + 1)
          fetchAll()
        }, 2000)
      } catch (e) {
        console.error('manual rank check loop crashed', e)
        showToast('수동 검증 실패: ' + (e as Error).message)
      } finally {
        setManualLocal(false)
        setChunkPhase(null)
      }
    },
    [fetchAll, fetchProgress, showToast],
  )

  // ─── "순위권 없음" 셀 재검증 핸들러 (2026-05-16) ───
  // 매트릭스 헤더의 "순위권 없음 N건 재검증" 버튼에서 호출. 백엔드가
  // 최근 7일 내 out_of_range=True 셀들의 place 를 추려 _run_rank_check_for_ids 로
  // 디스패치. handleManualRankCheck 와 달리 클라이언트 측 청크 분할은 하지 않고,
  // 단일 잡으로 트리거한 뒤 폴링(manual_running) 에 결과를 맡긴다. 백엔드는 동일
  // busy-mark 키를 사용하므로 manual_running=true 가 켜져 UI 가 자동으로 busy 됨.
  const handleRerunOutOfRange = useCallback(async () => {
    const fresh = await fetchProgress()
    if (fresh?.manual_running) {
      showToast('이미 백그라운드에서 검증 중입니다. 완료 후 다시 시도해주세요.')
      return
    }
    setManualLocal(true)
    try {
      const resp = await triggerRerunOutOfRange()
      if (resp.started === 0) {
        showToast(resp.message ?? '재검증 대상이 없습니다.')
        setManualLocal(false)
        return
      }
      showToast(
        resp.message ??
          `${resp.started}개 업체의 순위권 없음 셀 ${resp.cells_to_recheck}건을 재검증합니다.`,
      )
      // 백엔드 busy 플래그가 켜질 시간 — 짧게 대기 후 progress 폴링이 인계
      await new Promise((r) => setTimeout(r, 500))
      await fetchProgress()
    } catch (err) {
      const msg =
        (err as { message?: string })?.message ??
        '재검증 트리거에 실패했습니다.'
      showToast(msg)
      setManualLocal(false)
    } finally {
      // manualLocal 은 polling 에서 manual_running=false 가 관측되면
      // (또는 cleanup useEffect 가) 알아서 내림. 여기서는 일찍 끄지 않음.
    }
  }, [fetchProgress, showToast])

  // ─── chunkPhase 안전 cleanup (2026-05-16, 강화) ───
  // 청크 루프가 try/finally 에서 setChunkPhase(null) 까지 잘 도달하면 문제 없지만,
  // 이론상의 race (예: 사용자가 탭을 별도로 이동하여 setTimeout/await 체인이 끊긴 경우)
  // 를 대비한 안전망. 2단계 분리:
  //
  // Case 1) 검증 100% 완료 + idle → 즉시 cleanup (3초)
  //   filled_cells >= total_cells 면 더 할 일이 없음. 진행 배너를 빨리 닫는다.
  //
  // Case 2) 단순 idle (검증 미완료지만 백엔드 idle, 회로차단 CLOSED) → 8초 후 cleanup
  //   청크 1→2 사이 정상 쿨다운(1.5초) 시 일시적으로 둘 다 false 가 될 수 있으므로
  //   바로 cleanup 하면 정상 동작을 깬다. 충분한 grace period 부여.
  useEffect(() => {
    if (chunkPhase == null) return
    if (progress == null) return
    const idle = !progress.manual_running && !progress.naver_circuit_open
    if (!idle) return
    const fullyDone =
      progress.total_cells > 0 && progress.filled_cells >= progress.total_cells
    const delayMs = fullyDone ? 3000 : 8000
    const t = window.setTimeout(() => {
      setChunkPhase(null)
      setManualLocal(false)
    }, delayMs)
    return () => window.clearTimeout(t)
  }, [chunkPhase, progress])

  // ─── "rerun-out-of-range" 경로용 manualLocal cleanup (2026-05-16) ───
  // 이 경로는 청크 분할 없이 단발성으로 트리거하므로 chunkPhase 를 set 하지 않는다.
  // 백엔드 잡이 완료(manual_running=false)되면 manualLocal 도 함께 내려야 매트릭스
  // 헤더의 "검증 중..." 버튼이 해제된다. chunkPhase 가 있는 경우는 위 useEffect 가
  // 처리하므로 여기서는 chunkPhase 가 null 인 경우에만 작동.
  useEffect(() => {
    if (chunkPhase != null) return
    if (!manualLocal) return
    if (progress == null) return
    // 백엔드가 아직 잡을 set 하지 않은 상태(트리거 직후 짧은 윈도) 는 무시
    if (progress.manual_running) return
    // 백엔드 idle 확인됨 → 약간의 grace 후 manualLocal 해제.
    //   grace 를 충분히 길게(5초) 잡는 이유: 트리거 직후 ~700ms 윈도 동안 백엔드
    //   busy 플래그가 아직 폴링에 반영 안 됐을 수 있는데, 그 사이 이 useEffect 가
    //   먼저 발화하면 잘못된 타이머가 set 된다. 다음 progress 폴링(3초 간격)에서
    //   manual_running=true 가 관측되면 위 guard 에 막혀 timer 가 clearTimeout 된다.
    //   5초면 충분한 안전 마진.
    const t = window.setTimeout(() => {
      setManualLocal(false)
    }, 5000)
    return () => window.clearTimeout(t)
  }, [chunkPhase, manualLocal, progress])

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

  /* ── 순위 데이터 초기화 (등록 플레이스는 보존) ── */
  const handleResetAll = useCallback(async () => {
    setResetting(true)
    try {
      const r = await resetAllRankData()
      showToast(r.message)
      setResetModalOpen(false)
      // 순위/매칭 관련 로컬 상태만 즉시 비우기.
      // ⚠️ setList(null) 은 일부러 호출하지 않는다 — 등록 플레이스는 보존되므로
      //    refetch 직후 같은 289건이 다시 그려져야 "안 사라졌음" 이 시각적으로 확인된다.
      setDongChanged(null)
      setProgress(null)
      setMatrixReloadTick(0)
      // 서버에서 새로 fetch — 플레이스 목록은 그대로, 키워드/매칭만 비어있을 것
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
        <ProgressBanner progress={progress} chunkPhase={chunkPhase} />
      )}

      {/* 수동확인 필요 — NEEDS_MANUAL 행 직접 해결
       *  정책: 백엔드가 070 매칭 0건 → 이름+동 폴백 매칭으로 자동 승격(false-positive 회피 위해
       *  단일 후보일 때만). 끝까지 못 잡힌 NEEDS_MANUAL 은 매트릭스에서 제외만 하고 사용자
       *  입력 강요는 하지 않는다. (이전 UI 의 NeedsManualPanel 은 표시하지 않음)
       */}

      {/* 3a) 네이버 회로차단 배너 — Phase 5 Fix A
       *  매트릭스 박스 바로 위에 배치하여, 검증 진행 중인 매트릭스와 시각적으로
       *  인접하게 노출 (이전엔 페이지 상단이라 매트릭스에서 멀리 떨어져 있었음).
       */}
      {progress?.naver_circuit_open && <NaverCircuitOpenBanner />}

      {/* 3) 등록동 × 키워드 매트릭스 — 현재 순위 한눈에 */}
      {list && list.items.length > 0 && (
        <RankMatrix
          list={list}
          reloadTick={matrixReloadTick}
          onRowClick={(p) => setDetailPlace(p)}
          onManualCheck={handleManualRankCheck}
          onRerunOutOfRange={handleRerunOutOfRange}
          manualChecking={manualChecking}
          progress={progress}
          chunkPhase={chunkPhase}
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
          <h3 className="text-base font-bold text-rose-900">순위 데이터 초기화</h3>
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
            등록된 <strong className="text-rose-700">{totalPlaces}건</strong>의 플레이스에서{' '}
            <strong>추적 키워드 / 매칭 결과 / 순위 이력</strong>만 초기화됩니다.
            <br />
            <span className="text-xs text-emerald-700">
              ✓ 등록 플레이스(070전화·주소·상호)는 그대로 유지됩니다.
            </span>
          </p>

          <div className="text-xs space-y-2">
            <div className="bg-rose-50 ring-1 ring-rose-200 rounded-lg px-3 py-2">
              <div className="font-semibold text-rose-800 mb-1">🗑 초기화 대상</div>
              <ul className="text-rose-900/80 space-y-0.5">
                <li>· 추적 키워드 (tracking_keywords)</li>
                <li>· 매칭 결과 (place_id 매칭상태 / 신뢰도 / 후보)</li>
                <li>· 변경노출 플래그 (dong_changed / actual_dong)</li>
                <li>· 키워드별 순위 이력 (30일 추이 그래프 데이터)</li>
              </ul>
            </div>
            <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-3 py-2">
              <div className="font-semibold text-emerald-800 mb-1">✓ 보존 (삭제 안 함)</div>
              <ul className="text-emerald-900/80 space-y-0.5">
                <li>· 070 전화번호 / 등록동 / 상호 / 주소 / 카테고리</li>
                <li>· /monitor 페이지의 노출관리 판정 결과</li>
                <li>· 가장 최근 업로드 표시 (in_latest_upload)</li>
              </ul>
            </div>
          </div>

          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 ring-1 ring-amber-200">
            <strong>주의:</strong> 추적 키워드를 다시 입력해야 매칭/순위 체크가 재개됩니다.
            등록 플레이스 자체는 /monitor 에서 계속 노출관리 됩니다.
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
              위 내용을 확인했으며, 추적 키워드/매칭/순위이력을 초기화하는 데 동의합니다.
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
            순위 데이터 초기화
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
function ProgressBanner(props: {
  progress: RankCheckProgress
  /** Phase 7 New Issue — 매트릭스와 동일한 청크 단계 표시 */
  chunkPhase?: {
    current: number
    total: number
    phase: 'checking' | 'cooldown' | 'naver_paused'
  } | null
}) {
  const { progress, chunkPhase = null } = props
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
          <span className="font-semibold inline-flex items-center gap-1.5">
            ② 네이버 순위 검증
            {/* Phase 7 New Issue — 청크 진행 표시 (검증 중일 때만) */}
            {chunkPhase && (
              <span
                className={clsx(
                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                  chunkPhase.phase === 'naver_paused'
                    ? 'bg-rose-100 text-rose-800'
                    : chunkPhase.phase === 'cooldown'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800',
                )}
              >
                {chunkPhase.phase === 'naver_paused' ? (
                  <AlertTriangle size={9} />
                ) : chunkPhase.phase === 'cooldown' ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={9} />
                )}
                청크 {chunkPhase.current}/{chunkPhase.total}
                {chunkPhase.phase === 'naver_paused'
                  ? ' · 네이버 차단 대기'
                  : chunkPhase.phase === 'cooldown'
                    ? ' · 쿨다운'
                    : ''}
              </span>
            )}
          </span>
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
 * 컴포넌트: 네이버 회로차단 배너 (Phase 5 - Fix A)
 *  - 백엔드의 naver_map circuit breaker 가 OPEN 일 때 표시
 *  - OPEN 동안에는 "지금 검증" 을 눌러도 모든 셀이 단락되어 결과가 안 쌓인다
 *  - cooldown 은 120 초. 5 초 폴링이므로 자동으로 사라진다.
 * ──────────────────────────────────────────────────────────── */
function NaverCircuitOpenBanner() {
  return (
    <Card className="p-0 overflow-hidden border-rose-300 ring-1 ring-rose-200">
      <div className="flex items-center gap-3 px-4 py-3 bg-rose-50">
        <AlertTriangle className="text-rose-600 shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-rose-900">
            네이버 지도 일시 차단 감지 — 검증을 잠시 중단합니다
          </div>
          <div className="text-xs text-rose-800/80 mt-0.5">
            네이버 응답이 연속 실패하여 회로차단이 발동했습니다. 약 2분 후
            자동으로 복구되며, 이 배너가 사라지면 "지금 검증" 을 다시
            눌러주세요. 이미 누른 검증은 결과를 받지 못해도 데이터가 손상되지
            않습니다.
          </div>
        </div>
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
          title="추적 키워드 / 매칭 결과 / 순위 이력만 초기화합니다. 등록 플레이스(070·주소·상호)는 그대로 유지됩니다."
        >
          <Trash2 size={14} />
          순위 데이터 초기화
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
  /** 2026-05-16 — "순위권 없음" 셀만 재검증 */
  onRerunOutOfRange?: () => void | Promise<void>
  manualChecking?: boolean
  /** Phase 7 — 백엔드 잡 진행률 표시용 */
  progress?: RankCheckProgress | null
  /** Phase 7 — 청크 단위 진행 표시 (검증중/쿨다운) */
  chunkPhase?: {
    current: number
    total: number
    phase: 'checking' | 'cooldown' | 'naver_paused'
  } | null
}) {
  const {
    list,
    reloadTick = 0,
    onRowClick,
    onManualCheck,
    onRerunOutOfRange,
    manualChecking = false,
    progress = null,
    chunkPhase = null,
  } = props

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
      // [2026-05-16] 백엔드가 미검증 (place, keyword) 셀을 응답에서 제외해 보내준다.
      // (이전: placeholder 로 채워서 보냈고 프론트가 그것을 검증 완료로 오해 → "578/578" 거짓)
      // 추가로 missing_count 메타 필드로 미검증 셀 수를 명시. 우리는 cells 만 보고
      // rankMap 을 구성하면 됨 — useMemo 가 hasOwnProperty 로 자연스럽게 unchecked 셈.
      const next: Record<string, number | null> = {}
      for (const cell of resp.cells) {
        // 안전망: 구버전 백엔드 호환 — check_date=null 이면 미검증이므로 skip
        if (cell.check_date == null) continue
        if (cell.rank == null) {
          // 검증됐는데 rank=null (out_of_range=false) — 레거시 결측. 안전하게 999 처리.
          next[`${cell.place_pk}::${cell.keyword}`] = 999
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
    // [2026-05-16] top 20 정책: 21위 이상은 추적 의미 없음 → "순위권 없음"
    // (rank > 20 으로 비교하되, 999 sentinel 도 자연스럽게 잡힘)
    if (rank > 20)
      return <span className="text-rose-600 font-semibold text-xs">순위권 없음</span>
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

  // Phase 7 — 버튼 라벨/툴팁 derivation
  // 우선순위: chunkPhase(쿨다운/검증중) > 백엔드 manual_running > 로컬 즉시 신호
  //
  // [2026-05-16] "지금 검증" 클릭 시 미검증 셀이 많은 place 를 앞 청크에 배치한다.
  //   배경: 한 사용자가 키워드를 새로 추가하면 그 keyword 만 PlaceRankHistory 가
  //         없는 상태가 된다. 이전 정렬은 RegisteredPlace.id ASC 였기 때문에
  //         새 키워드의 결과를 보려면 큐 끝까지 기다려야 했음.
  //   정렬 키 (내림차순):
  //     1) 미검증 셀 수 (total - filled)  — 많은 것 먼저
  //     2) RegisteredPlace.id 오름차순     — 결정적 tie-break
  //   미검증 0인 place 도 큐에는 포함된다 (재확인 의미) — 그저 우선순위만 낮춤.
  const eligibleIds = useMemo(() => {
    const candidates = items
      .filter((p) => p.tracking_keywords.length > 0)
      .map((p) => {
        // perPlaceCompletion 은 이 useMemo 아래에 정의되므로 inline 으로 계산
        let filled = 0
        for (const kw of p.tracking_keywords) {
          if (Object.prototype.hasOwnProperty.call(rankMap, `${p.id}::${kw}`)) {
            filled += 1
          }
        }
        const total = p.tracking_keywords.length
        return { id: p.id, missing: total - filled }
      })
    candidates.sort((a, b) => {
      if (b.missing !== a.missing) return b.missing - a.missing
      return a.id - b.id
    })
    return candidates.map((c) => c.id)
  }, [items, rankMap])
  const totalCells = progress?.total_cells ?? 0
  const filledCells = progress?.filled_cells ?? 0
  const cellPct = totalCells > 0 ? Math.min(100, Math.round((filledCells / totalCells) * 100)) : 0

  // ── (2026-05-16) 잡 단위 진행률 표시 분기 ─────────────────────────
  // 일반 manual-rank-check (place 단위, 전체 매트릭스) 는 분모/분자가
  // total_cells/filled_cells 로 의미 있게 매핑되지만, rerun-out-of-range
  // (셀 단위) 는 그렇지 않다 — filled_cells 는 *전체 매트릭스* 의 7일 누적
  // distinct 카운트라 잡 시작 시점부터 다시 카운트하지 않는다.
  //
  // 따라서 rerun 잡일 때는:
  //   · 명시적 분모: progress.manual_target_total (= 105)
  //   · 분자: 모름 (진척률 정확 추적 불가) → indeterminate 표시
  //   · 텍스트: "순위권 없음 N건 재검증 중 — 약 N×4초 예상"
  //
  // 'rerun-out-of-range' 라벨이 set 되면 위 분기 적용.
  const jobLabel = progress?.manual_label ?? null
  const jobTargetTotal = progress?.manual_target_total ?? null
  const isRerunJob = jobLabel === 'rerun-out-of-range' && (jobTargetTotal ?? 0) > 0

  // Phase 7 New Issue — 행별 완료 진행률 (filled / total tracking_keywords).
  // 매트릭스 셀이 무작위 순서로 채워져 사용자가 답답해하는 문제 (verbatim:
  // "100% 검증하고 매트릭스에 채우고 있는데 유저 입장에서는 답답해") 를 완화하기 위해
  // 행마다 "3/5 ✓" 식의 배지를 노출. rankMap 에 키가 존재(=DB persist 완료) 하면
  // 채워진 것으로 간주 — 순위권 없음(null) 도 PlaceRankHistory 행이 있으면 진척으로 본다.
  const perPlaceCompletion = useMemo(() => {
    const map: Record<number, { filled: number; total: number }> = {}
    for (const p of items) {
      const total = p.tracking_keywords.length
      let filled = 0
      for (const kw of p.tracking_keywords) {
        if (Object.prototype.hasOwnProperty.call(rankMap, `${p.id}::${kw}`)) {
          filled += 1
        }
      }
      map[p.id] = { filled, total }
    }
    return map
  }, [items, rankMap])

  // ── Phase 8: 매트릭스 통계 ──────────────────────────────────────
  // A) 검증 진행: 전체 셀(=업체 × 등록키워드) 중 검증 완료/미검증
  // C) 순위 분포: 1위/2위/3위/4위/5위/6~10위/11~20위/순위권없음 buckets
  // D) 업체 단위 요약: 모든 키워드 1~3위 / 부분 노출 (일부만 top 20) / 전혀 안 잡힘
  //
  // 모두 rankMap 만으로 계산 — 추가 API 호출 0회. items 또는 rankMap 변경 시만 재계산.
  const matrixStats = useMemo(() => {
    // A: 전체 셀 = sum of (each place의 tracking_keywords 개수)
    let totalCellsAll = 0
    let checked = 0 // rank 값이 있거나 999(순위권 없음 sentinel) 포함 — null 만 미검증
    let unchecked = 0
    // C: rank 분포 (검증된 셀만 카운트)
    const buckets = { r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, r6_10: 0, r11_20: 0, out: 0 }
    // D: 업체 단위
    let bizAllTop3 = 0 // 모든 키워드가 1~3위
    let bizPartial = 0 // 일부만 top 20
    let bizNone = 0 // 전체가 순위권 없음 (검증된 키워드 기준)
    // E: 키워드 단위 — 키워드별 총/검증/1위/5위↓/없음 카운트 + 최고/평균/노출률
    //    분포는 4 그룹으로 압축: top1 / top2-5 / top6-20 / out (none)
    //    노출률 = top20 검증된 셀 / 그 키워드를 추적하는 업체수 (등록 기준)
    type PerKw = {
      total: number // 이 키워드를 추적하는 업체 수
      checked: number // 검증된 셀 수
      top1: number
      top2_5: number
      top6_20: number
      out: number // 순위권 없음 (검증된 것만)
      sumRank: number // top20 안에 든 셀들의 rank 합 (평균 계산용)
      bestRank: number | null // 1..20 중 최솟값
    }
    const perKw: Record<string, PerKw> = {}

    for (const p of items) {
      const kws = p.tracking_keywords
      totalCellsAll += kws.length
      // 이 업체의 키워드별 상태 집계 — D 계산용
      let bizCheckedCount = 0
      let bizInTop20 = 0
      let bizInTop3 = 0
      for (const kw of kws) {
        // 키워드별 누산기 초기화
        if (!perKw[kw]) {
          perKw[kw] = {
            total: 0,
            checked: 0,
            top1: 0,
            top2_5: 0,
            top6_20: 0,
            out: 0,
            sumRank: 0,
            bestRank: null,
          }
        }
        perKw[kw].total += 1

        const key = `${p.id}::${kw}`
        const has = Object.prototype.hasOwnProperty.call(rankMap, key)
        if (!has) {
          unchecked += 1
          continue
        }
        const r = rankMap[key]
        checked += 1
        bizCheckedCount += 1
        perKw[kw].checked += 1
        // r === null   → 검증은 됐으나 PlaceRankHistory 가 null (이전 정책 잔재. mobile route 정책에선 999 sentinel 사용)
        // r === 999    → top 20 밖 (순위권 없음)
        // 1 <= r <= 20 → 순위
        if (r == null || r > 20) {
          buckets.out += 1
          perKw[kw].out += 1
        } else {
          bizInTop20 += 1
          if (r === 1) buckets.r1 += 1
          else if (r === 2) buckets.r2 += 1
          else if (r === 3) buckets.r3 += 1
          else if (r === 4) buckets.r4 += 1
          else if (r === 5) buckets.r5 += 1
          else if (r <= 10) buckets.r6_10 += 1
          else buckets.r11_20 += 1
          if (r <= 3) bizInTop3 += 1
          // perKw 분포 (4-bucket 압축)
          if (r === 1) perKw[kw].top1 += 1
          else if (r <= 5) perKw[kw].top2_5 += 1
          else perKw[kw].top6_20 += 1
          // 평균/최고 계산용
          perKw[kw].sumRank += r
          if (perKw[kw].bestRank === null || r < perKw[kw].bestRank!) {
            perKw[kw].bestRank = r
          }
        }
      }
      // D 분류 — 키워드가 0개인 업체는 모든 분류에서 제외
      if (kws.length === 0) continue
      // 검증된 키워드 기준으로만 분류 (미검증 상태에서 D 통계가 출렁이지 않게)
      if (bizCheckedCount === 0) continue
      if (bizInTop3 === bizCheckedCount) {
        bizAllTop3 += 1
      } else if (bizInTop20 === 0) {
        bizNone += 1
      } else {
        bizPartial += 1
      }
    }

    return {
      totalCells: totalCellsAll,
      checked,
      unchecked,
      buckets,
      biz: { allTop3: bizAllTop3, partial: bizPartial, none: bizNone },
      perKw,
    }
  }, [items, rankMap])

  let btnLabel = '지금 검증'
  let btnTitle =
    '타지역 정책상 자동 순위 추적이 비활성화되어 있습니다. 이 버튼으로 명시적으로 순위 검증을 시작하세요.'
  if (chunkPhase) {
    if (chunkPhase.phase === 'naver_paused') {
      btnLabel = `네이버 차단 — 자동 재개 대기 (${chunkPhase.current}/${chunkPhase.total})`
      btnTitle =
        '네이버 회로차단이 해제되면 같은 청크부터 자동으로 이어서 검증합니다. 수동 조작 불필요.'
    } else if (chunkPhase.phase === 'checking') {
      btnLabel = `검증 중 (${chunkPhase.current}/${chunkPhase.total} 청크)`
      btnTitle = '네이버 부하 분산을 위해 청크 단위로 나누어 진행 중입니다.'
    } else {
      btnLabel = `쿨다운 (${chunkPhase.current}/${chunkPhase.total})`
      btnTitle = '네이버 부하 분산을 위해 청크 단위로 나누어 진행 중입니다.'
    }
  } else if (manualChecking) {
    if (isRerunJob) {
      btnLabel = `재검증 중... (${jobTargetTotal}건)`
      btnTitle = '순위권 없음 셀만 백그라운드에서 재검증 중입니다.'
    } else {
      btnLabel = totalCells > 0 ? `검증 중... (${filledCells}/${totalCells} 셀)` : '검증 중...'
      btnTitle = '백그라운드에서 검증이 진행 중입니다. 완료될 때까지 다시 누를 수 없습니다.'
    }
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
                onManualCheck(eligibleIds)
              }}
              disabled={manualChecking || items.length === 0}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title={btnTitle}
            >
              {manualChecking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Search size={12} />
              )}
              {btnLabel}
            </button>
          )}
          {/* 2026-05-16 — "순위권 없음 N건 재검증" 버튼.
              매트릭스에서 out_of_range=True 로 잡힌 셀들이 대부분 검증 당시의
              일시 오류(네이버 IP 차단, 페이지 로딩 실패) 로 인한 false positive 라는
              관찰에 따라, 그 셀들의 place 만 골라 다시 검증한다. 백엔드는
              POST /rerun-out-of-range 가 처리. matrixStats.buckets.out 이 0 이면 비활성. */}
          {onRerunOutOfRange && matrixStats.buckets.out > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRerunOutOfRange()
              }}
              disabled={manualChecking}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title={
                '매트릭스에 "순위권 없음" 으로 잡힌 셀들을 다시 검증합니다. ' +
                '대부분 검증 당시의 일시 오류(네이버 차단 등) 라서 재검증하면 실제 순위가 잡힐 가능성이 높습니다.'
              }
            >
              {manualChecking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              순위권 없음 {matrixStats.buckets.out}건 재검증
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

      {/* Phase 7 — 검증 진행률 스트립 (검증 중일 때만 표시) */}
      {manualChecking && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center justify-between text-[11px] text-blue-900 mb-1">
            <span className="font-semibold inline-flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              {isRerunJob
                ? `순위권 없음 ${jobTargetTotal}건 재검증 중 — 잠시만 기다려주세요`
                : chunkPhase?.phase === 'naver_paused'
                  ? `네이버 일시차단 감지 — 자동 재개 대기 중 (청크 ${chunkPhase.current}/${chunkPhase.total})`
                  : chunkPhase?.phase === 'cooldown'
                    ? `청크 ${chunkPhase.current}/${chunkPhase.total} 완료 — 다음 청크 준비 중...`
                    : chunkPhase
                      ? `청크 ${chunkPhase.current}/${chunkPhase.total} 검증 중`
                      : '백그라운드에서 순위 검증 중'}
            </span>
            {/* 진행률 텍스트 분기:
                · rerun-out-of-range : 분자(잡 처리량) 추적 어려우므로 분모만 표시
                · 그 외             : filled/total 기존 동작 */}
            {isRerunJob ? (
              <span className="font-mono text-blue-700">잡 크기: {jobTargetTotal}건</span>
            ) : (
              totalCells > 0 && (
                <span className="font-mono">
                  {filledCells} / {totalCells} 셀 ({cellPct}%)
                </span>
              )
            )}
          </div>
          {/* 프로그레스 바:
              · rerun-out-of-range : indeterminate (왔다갔다 애니메이션) — 정확한 % 모름
              · 그 외             : cellPct 기반 determinate */}
          {isRerunJob ? (
            <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full animate-pulse"
                style={{ width: '40%' }}
              />
            </div>
          ) : (
            totalCells > 0 && (
              <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden">
                <div
                  className={clsx(
                    'h-full transition-all duration-500',
                    chunkPhase?.phase === 'naver_paused'
                      ? 'bg-rose-400'
                      : chunkPhase?.phase === 'cooldown'
                        ? 'bg-amber-400'
                        : 'bg-emerald-500',
                  )}
                  style={{ width: `${cellPct}%` }}
                />
              </div>
            )
          )}
        </div>
      )}

      {/* Phase 7 — 매트릭스 통계 패널 (A: 검증 진행 / C: 순위 분포 / D: 업체 단위 요약) */}
      {matrixStats.totalCells > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 space-y-1.5">
          {/* Row A — 검증 진행 */}
          <div className="flex items-center gap-3 text-[11px] text-slate-700 flex-wrap">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
              <CheckCircle2 size={11} className="text-emerald-600" />
              검증 진행
            </span>
            <span className="font-mono">
              <b className="text-emerald-700">{matrixStats.checked}</b>
              <span className="text-slate-400"> / </span>
              <span className="text-slate-700">{matrixStats.totalCells}</span>
              <span className="text-slate-400 ml-0.5">셀 검증 완료</span>
            </span>
            {matrixStats.unchecked > 0 && (
              <span className="font-mono text-slate-500">
                미검증 <b className="text-slate-700">{matrixStats.unchecked}</b>
              </span>
            )}
          </div>

          {/* Row C — 순위별 분포 (검증된 셀만, top-N=20 기준) */}
          {matrixStats.checked > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-600 mr-1">
                <TrendingUp size={11} className="text-blue-600" />
                순위 분포
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">
                1위 <b>{matrixStats.buckets.r1}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">
                2위 <b>{matrixStats.buckets.r2}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono">
                3위 <b>{matrixStats.buckets.r3}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">
                4위 <b>{matrixStats.buckets.r4}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono">
                5위 <b>{matrixStats.buckets.r5}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono">
                6~10위 <b>{matrixStats.buckets.r6_10}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono">
                11~20위 <b>{matrixStats.buckets.r11_20}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-mono">
                순위권 없음 <b>{matrixStats.buckets.out}</b>
              </span>
            </div>
          )}

          {/* Row D — 업체 단위 요약 (검증된 키워드 기준) */}
          {matrixStats.checked > 0 &&
            matrixStats.biz.allTop3 + matrixStats.biz.partial + matrixStats.biz.none > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-slate-700 flex-wrap">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                  <Users size={11} className="text-violet-600" />
                  업체 단위
                </span>
                <span className="font-mono">
                  모든 키워드 1~3위{' '}
                  <b className="text-emerald-700">{matrixStats.biz.allTop3}</b>
                  <span className="text-slate-400"> 업체</span>
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono">
                  부분 노출 <b className="text-blue-700">{matrixStats.biz.partial}</b>
                </span>
                <span className="text-slate-300">·</span>
                <span className="font-mono">
                  전혀 안 잡힘 <b className="text-rose-700">{matrixStats.biz.none}</b>
                </span>
              </div>
            )}

          {/* Row E — 키워드별 미니 분포 (1위 · 2~5위 · 6~20위 · 없음) */}
          {matrixStats.checked > 0 && allKeywords.length > 0 && (
            <div className="flex items-start gap-1.5 text-[12px] flex-wrap">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-600 mr-1 mt-0.5 text-[11px]">
                <Tag size={11} className="text-amber-600" />
                키워드별 분포
              </span>
              {allKeywords.map((kw) => {
                const s = matrixStats.perKw[kw]
                if (!s || s.checked === 0) {
                  return (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono"
                    >
                      <b className="text-slate-700">{kw}</b>
                      <span className="text-slate-400">미검증</span>
                    </span>
                  )
                }
                return (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono"
                  >
                    <b className="text-slate-800">{kw}</b>
                    <span className="text-emerald-700">1위 {s.top1}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-blue-700">2~5위 {s.top2_5}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-amber-700">6~20위 {s.top6_20}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-rose-700">없음 {s.out}</span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Row F — 키워드별 최고/평균/노출률 (분모 = 검증 완료된 셀만, 미검증 제외) */}
          {matrixStats.checked > 0 && allKeywords.length > 0 && (
            <div className="flex items-start gap-1.5 text-[12px] flex-wrap">
              <span
                className="inline-flex items-center gap-1 font-semibold text-slate-600 mr-1 mt-0.5 text-[11px]"
                title="노출률 분모는 검증 완료된 셀 기준입니다. 미검증 셀은 분모에서 제외됩니다."
              >
                <TrendingUp size={11} className="text-violet-600" />
                키워드별 요약
                <span className="text-slate-400 font-normal">(검증완료 기준)</span>
              </span>
              {allKeywords.map((kw) => {
                const s = matrixStats.perKw[kw]
                if (!s || s.checked === 0) return null
                const inTop20 = s.top1 + s.top2_5 + s.top6_20
                // 노출률 = 검증된 셀 중 top20 안에 든 비율 (미검증 셀은 분모에서 제외해서 검증 진행 중에도 안정)
                const exposureRate = s.checked > 0 ? Math.round((inTop20 / s.checked) * 100) : 0
                const avg = inTop20 > 0 ? (s.sumRank / inTop20).toFixed(1) : '—'
                const best = s.bestRank ?? null
                // 노출률 색상 톤
                const rateTone =
                  exposureRate >= 80
                    ? 'text-emerald-700'
                    : exposureRate >= 50
                      ? 'text-blue-700'
                      : exposureRate >= 20
                        ? 'text-amber-700'
                        : 'text-rose-700'
                // 미검증 셀 수 = 이 키워드를 추적하는 업체 - 검증 완료
                const kwUnchecked = s.total - s.checked
                return (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono"
                    title={`'${kw}' 키워드: 등록 ${s.total}건 · 검증 완료 ${s.checked}건${kwUnchecked > 0 ? ` · 미검증 ${kwUnchecked}건` : ''}`}
                  >
                    <b className="text-slate-800">{kw}</b>
                    <span className="text-slate-600">
                      최고{' '}
                      <b className={best === null ? 'text-slate-400' : 'text-emerald-700'}>
                        {best === null ? '—' : `${best}위`}
                      </b>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">
                      평균 <b className="text-slate-800">{avg === '—' ? '—' : `${avg}위`}</b>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-600">
                      노출률 <b className={rateTone}>{exposureRate}%</b>
                      <span className="text-slate-400 ml-0.5 text-[10px]">
                        ({inTop20}/{s.checked})
                      </span>
                    </span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 정책 안내 배너 — 자동 추적 비활성, 수동 검증 안내 (검증 중엔 숨김) */}
      {!manualChecking && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 flex items-center gap-2">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span>
            타지역 환경에서는 <b>자동 순위 추적이 비활성화</b>되어 있습니다.
            순위를 확인하려면 우측 상단 <b>"지금 검증"</b> 버튼을 눌러주세요.
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50">
            <tr className="text-ink-2">
              <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-slate-50 z-10 min-w-[180px]">
                상호 / 등록동
              </th>
              {allKeywords.map((kw) => {
                const s = matrixStats.perKw[kw]
                const hasChecked = s && s.checked > 0
                return (
                  <th
                    key={kw}
                    className="px-3 py-2 text-center font-semibold whitespace-nowrap"
                  >
                    <div className="leading-tight">{kw}</div>
                    {hasChecked && (
                      <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[11.5px] font-mono font-normal">
                        <span className="text-emerald-700">
                          1위 <b>{s.top1}</b>
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-blue-700">
                          5위↓ <b>{s.top2_5 + s.top6_20}</b>
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-rose-700">
                          없음 <b>{s.out}</b>
                        </span>
                      </div>
                    )}
                  </th>
                )
              })}
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
                  <div className="flex items-center gap-1.5">
                    <div className="font-semibold text-blue-700 hover:underline">
                      {p.business_name || '-'}
                    </div>
                    {/* Phase 7 New Issue — 행별 완료 배지 */}
                    {(() => {
                      const c = perPlaceCompletion[p.id]
                      if (!c || c.total === 0) return null
                      const complete = c.filled >= c.total
                      return (
                        <span
                          className={clsx(
                            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                            complete
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800',
                          )}
                          title={
                            complete
                              ? '이 업체의 모든 키워드 검증 완료'
                              : `이 업체 ${c.total}개 키워드 중 ${c.filled}개 검증 완료`
                          }
                        >
                          {complete ? (
                            <CheckCircle2 size={10} />
                          ) : (
                            <Loader2 size={10} className="animate-spin" />
                          )}
                          {c.filled}/{c.total}
                        </span>
                      )
                    })()}
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
  // [2026-05-16] top 20 정책: 차트 Y축도 20위까지만 의미 있음.
  // 순위가 20을 넘어가는 데이터(예: 과거 75위 정책 시절 기록)는 그래도 표시되도록 max 를 늘림.
  const maxRank = Math.max(20, ...(ranks.length ? ranks : [10]))

  const x = (i: number) =>
    PAD_L + (len <= 1 ? innerW / 2 : (innerW * i) / (len - 1))
  const y = (r: number) => PAD_T + (innerH * (r - 1)) / Math.max(1, maxRank - 1)

  const yTicks = [1, 5, 10, 15, 20].filter((t) => t <= maxRank)

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
              <span className="text-rose-600 font-semibold">순위권 없음</span>
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
      const filled = pts.filter((p) => p.rank != null) // 순위권 없음이어도 out_of_range로 표기됨
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
    if (oor || (rank != null && rank > 20)) {
      return (
        <span className="px-2 py-0.5 rounded font-bold text-xs bg-rose-100 text-rose-700">
          순위권 없음
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
                · 행 클릭 시 경쟁업체 1~20위 펼치기
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
                  ▲ 상승(과거보다 좋은 순위) · ▼ 하락 · 순위권 없음은 비교에서
                  제외됨. 행 클릭 시 그 키워드의 동×키워드 검색 결과 1~20위가
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
 *  - 1~20위 전체 표시, 내 업체는 강조 배경
 *  - 1~3위 emerald, 4~10 blue, 11~20 slate 배지 (광고 제외 organic top 20)
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
              순위권 없음
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
