/**
 * Monitor — Tab 2: 실시간 노출 확인 (검증 프로세스 3단계)
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ 1단계  등록 체크 (수동, 등록 직후 1회)                         │
 *  │   · 정밀 모드 — 전화 + 동/로/리 일치 검증                      │
 *  │   · 전체 등록건                                                │
 *  │   · POST /verify/live { mode: 'full', only_pending: false }   │
 *  │                                                                │
 *  │ 2단계  재체크 (수동, PENDING 만)                              │
 *  │   · 정밀 모드 — 1단계와 동일 검증, 대상만 다름                 │
 *  │   · current_verdict='PENDING' 인 항목만                        │
 *  │   · 활성화 조건: PENDING ≥ 1                                   │
 *  │   · POST /verify/live { mode: 'full', only_pending: true }    │
 *  │                                                                │
 *  │ 3단계  자동 정기 체크 (자동, 매일)                             │
 *  │   · 빠른 모드 — 페이지 헤더만 GET                              │
 *  │   · 사용자별 verify_slot 시각 (예: 매일 오전 11:00 KST)        │
 *  │   · APScheduler — services.scheduler.run_slot_verification    │
 *  │   · 이 화면에서는 안내 카드만 표시 (트리거 버튼 없음)          │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * 청크 분할: 100건/청크, 글로벌 세마포어로 동시 호출 throttle.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import { usePlacesList } from '@/hooks/usePlaces'
import { useSchedulerStatus } from '@/hooks/useEvents'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { runLiveCheck, listPlaces, getVerifyProgress } from '@/api/places'
import { ApiError } from '@/api/client'
import type { VerificationResult } from '@/api/types'
import { placeKeys } from '@/hooks/usePlaces'
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  MapPin,
  Building2,
  Activity,
  Clock,
  Zap,
  AlertTriangle,
  StopCircle,
  RefreshCw,
  CalendarClock,
} from 'lucide-react'

const CHUNK_SIZE = 100              // 청크당 100건 — 진행률 자주 업데이트 + 청크 오버헤드 최소화
// 청크 사이 휴식 (정크 체크중 → 쿨다운중 → 다음 청크) — 시각적 호흡 + 네이버 호출 분산
//   · 0ms 면 청크 사이 라벨이 깜빡이고 사라져서 사용자가 진행 흐름을 못 본다.
//   · 800ms 면 충분히 "쿨다운중" 라벨이 보이고 총 시간 영향은 청크당 0.8초 (전체로 수십초)
const CHUNK_DELAY_MS = 800

// 검증 직후 쿨다운(초) — 네이버 IP 차단(captcha) 회피용
//   · 등록 체크 / 재체크가 끝난 직후 같은 버튼을 연타하면 차단이 더 길어진다.
//   · 5분(300초) 동안 버튼을 비활성화하고 "잠시 후 재시도" 안내 표시.
//   · 새로고침해도 유지되도록 localStorage 에 다음 가능 시각(epoch ms)을 저장.
const COOLDOWN_SEC = 300
const COOLDOWN_KEY = 'liveCheck.cooldownUntil'

// ── Option A: 백단 진행 상태 "추정" 백업 ─────────────────────────
//   · React useState 는 새로고침 시 사라져서, 사용자가 페이지를 다시 열면
//     버튼이 다시 활성화되는 UX 버그가 있었다.
//   · 검증 시작 시 localStorage 에 startedAt(epoch ms) + 종류 + 총 청크 등을
//     저장하고, 마운트 시 그 값을 읽어 RUN_STATE_MAX_AGE_MS 이내면
//     "백단에서 아직 진행 중일 가능성이 있다"고 추정하여 버튼을 비활성화한다.
//   · 정상 종료 / 취소 / 실패 시 모두 localStorage 에서 제거한다.
//   · 추정 만료 시간(=좀비 상태 방지)을 충분히 길게 잡되, 현실적인 최대치보다
//     약간 여유를 두는 정도(30분)로 설정. 완벽한 동기화는 2단계(Option B)
//     백엔드 progress 엔드포인트에서 처리한다.
const RUN_STATE_KEY = 'liveCheck.runState'
const RUN_STATE_MAX_AGE_MS = 30 * 60 * 1000  // 30분

/** 어떤 종류의 수동 검증을 실행 중인지 — UI 라벨/진행률 표시에 사용 */
type CheckKind = 'register' | 'recheck'

/** 청크 단위 진행 상태 — UI 의 청크 히스토리 라벨에 사용 */
type ChunkStatus = 'waiting' | 'running' | 'cooldown' | 'done' | 'skipped'

/** localStorage 에 저장하는 백단 진행 상태 백업 (Option A) */
interface PersistedRunState {
  kind: CheckKind
  startedAt: number          // epoch ms
  totalChunks: number
  totalTargets: number
}

function readPersistedRunState(): PersistedRunState | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(RUN_STATE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedRunState
    if (typeof parsed?.startedAt !== 'number') return null
    // 너무 오래된 백업은 좀비 — 자동 제거 후 null
    if (Date.now() - parsed.startedAt > RUN_STATE_MAX_AGE_MS) {
      window.localStorage.removeItem(RUN_STATE_KEY)
      return null
    }
    return parsed
  } catch {
    window.localStorage.removeItem(RUN_STATE_KEY)
    return null
  }
}

function writePersistedRunState(s: PersistedRunState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RUN_STATE_KEY, JSON.stringify(s))
}

function clearPersistedRunState() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(RUN_STATE_KEY)
}

export default function LiveCheckTab() {
  const qc = useQueryClient()
  const { data: placesData } = usePlacesList()
  const { data: schedulerData } = useSchedulerStatus()

  // 청크 처리 상태
  const [running, setRunning] = useState(false)
  const [kind, setKind] = useState<CheckKind>('register')   // 현재 실행 중인 검증 종류
  const [progress, setProgress] = useState({ chunk: 0, totalChunks: 0, done: 0, total: 0 })
  const [results, setResults] = useState<VerificationResult[]>([])
  const [totalMs, setTotalMs] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  // 직전 청크 시간 (ETA 계산용)
  const [lastChunkMs, setLastChunkMs] = useState<number[]>([])
  const cancelRef = useRef(false)
  // 진행 중인 청크 fetch 를 즉시 abort 시키기 위한 컨트롤러
  const abortRef = useRef<AbortController | null>(null)

  // ── 청크 히스토리 — UI 의 "청크 1 완료 / 청크 2 체크중 / 청크 3 대기" 라벨 ──
  //   각 청크의 상태가 'waiting' → 'running' → 'cooldown' → 'done'/'skipped' 로 흐른다.
  const [chunkStatuses, setChunkStatuses] = useState<ChunkStatus[]>([])

  // ── Option A: 새로고침 후에도 "백단 진행 중일 가능성" 을 기억 ──
  //   마운트 시 localStorage 의 runState 를 읽어 30분 이내면 추정 모드 활성화.
  //   추정 모드: 진행률 패널을 "동기화 중" 라벨로 표시하고 버튼을 비활성화한다.
  //   2단계(백엔드 progress 엔드포인트) 가 들어오면 추정 → 실제로 대체된다.
  const [persistedRun, setPersistedRun] = useState<PersistedRunState | null>(() =>
    readPersistedRunState(),
  )

  // 만료된 추정 상태(30분 경과) 자동 청소 — 1분마다 체크
  useEffect(() => {
    if (!persistedRun) return
    const id = window.setInterval(() => {
      if (Date.now() - persistedRun.startedAt > RUN_STATE_MAX_AGE_MS) {
        clearPersistedRunState()
        setPersistedRun(null)
      }
    }, 60_000)
    return () => window.clearInterval(id)
  }, [persistedRun])

  // 같은 사용자가 다른 탭에서 검증을 시작/종료할 때도 즉시 반영
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: StorageEvent) => {
      if (e.key !== RUN_STATE_KEY) return
      setPersistedRun(readPersistedRunState())
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // ─── Option B: 백엔드 progress polling (3초 주기) ───────────────────
  //   GET /api/v1/verify/progress — 사용자별 락 + 청크 진행 메타.
  //   이 응답이 추정 모드(persistedRun)보다 우선이며, 동기화의 진실 원천(SoT).
  //   running 이거나 추정 모드일 때만 빠르게 폴링하고, 그 외에는 일시 정지하여
  //   불필요한 트래픽을 절감한다 (refetchInterval = 새로고침 후 30초간만 활성).
  //
  // 응답 의미:
  //   · data.running=true  → 백엔드가 실제로 락을 잡고 있거나 30초 이내 마지막 청크 응답
  //   · data.kind/chunk_index/total_chunks/done/total → UI 표시용 진행 메타
  //
  // 페일오버: 네트워크 단절 시 useQuery 가 stale data 를 유지 → 추정 모드(persistedRun)
  // 가 백업으로 작동.
  const { data: backendProgress } = useQuery({
    queryKey: ['verify', 'progress'],
    queryFn: getVerifyProgress,
    refetchInterval: (q) => {
      // running 일 때는 3초, 추정 모드일 때도 3초, 그 외는 일시 정지.
      // q.state.data?.running 이 true 면 백엔드가 진행 중 → 계속 폴링.
      const isBackendRunning = (q.state.data as { running?: boolean } | undefined)?.running
      if (running || isBackendRunning || persistedRun !== null) return 3000
      return false
    },
    refetchOnWindowFocus: true,
    staleTime: 1000,
  })

  // "백단이 돌고 있다고 봐야 하는가" — 우선순위:
  //   1) 백엔드 progress.running === true     (실제 사실 — 최고 우선)
  //   2) 로컬 running                          (현재 탭에서 진행 중)
  //   3) localStorage 추정 모드(persistedRun)  (새로고침 직후 백엔드 응답 도착 전 안전망)
  const backendBusy =
    (backendProgress?.running ?? false) || running || persistedRun !== null

  // 백엔드가 'idle' 을 명확히 보고하면 좀비 추정 모드를 자동 정리 (5초 grace)
  useEffect(() => {
    if (!persistedRun) return
    if (!backendProgress) return
    if (backendProgress.running) return
    // 백엔드가 idle 인데 추정 모드가 살아있다 — 시작한 지 5초 이상 지났다면 정리.
    // (시작 직후 0~1초는 백엔드가 미처 락을 잡지 못한 상태일 수 있음)
    const elapsed = Date.now() - persistedRun.startedAt
    if (elapsed > 5000) {
      clearPersistedRunState()
      setPersistedRun(null)
    }
  }, [backendProgress, persistedRun])

  // ── 검증 후 쿨다운 (네이버 captcha/차단 회피) ──────────────────────
  //   localStorage 에서 epoch(ms) 를 읽어 초기화. 만료되면 0.
  const [cooldownLeft, setCooldownLeft] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const raw = window.localStorage.getItem(COOLDOWN_KEY)
    if (!raw) return 0
    const until = parseInt(raw, 10)
    if (!Number.isFinite(until)) return 0
    const left = Math.ceil((until - Date.now()) / 1000)
    return left > 0 ? left : 0
  })

  // 1초마다 카운트다운 — 0 이 되면 자연 종료
  useEffect(() => {
    if (cooldownLeft <= 0) return
    const id = window.setInterval(() => {
      setCooldownLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [cooldownLeft])

  /** 쿨다운 시작 — 검증이 끝난 직후 호출 */
  const startCooldown = (sec = COOLDOWN_SEC) => {
    const until = Date.now() + sec * 1000
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COOLDOWN_KEY, String(until))
    }
    setCooldownLeft(sec)
  }

  /** 쿨다운 남은 시간 — 사람이 읽기 좋은 형식 */
  const cooldownLabel = useMemo(() => {
    if (cooldownLeft <= 0) return null
    const m = Math.floor(cooldownLeft / 60)
    const s = cooldownLeft % 60
    return m > 0 ? `${m}분 ${s}초` : `${s}초`
  }, [cooldownLeft])

  const totalRegistered = placesData?.summary.total ?? 0
  const allPlaceIds = useMemo(
    () => (placesData?.items ?? []).map((p) => p.id),
    [placesData?.items],
  )

  // 2단계 "재체크" 활성화 조건 — current_verdict='PENDING' 카운트
  const pendingPlaceIds = useMemo(
    () =>
      (placesData?.items ?? [])
        .filter((p) => p.current_verdict === 'PENDING')
        .map((p) => p.id),
    [placesData?.items],
  )
  const pendingCount = pendingPlaceIds.length

  // 누적 요약
  const summary = useMemo(() => {
    // 용어 통일 (변경 노출 정책):
    //   - 정상 노출: OK
    //   - 변경 노출(info, 정상의 일종): 전화/동/지역 불일치
    //   - 상호 불일치(warning): NAME_MISMATCH
    //   - 네이버 미노출(danger): DEAD
    const s = { ok: 0, changed: 0, warning: 0, danger: 0 }
    for (const r of results) {
      if (r.verdict === 'OK') s.ok++
      else if (
        r.verdict === 'PHONE_MISMATCH' ||
        r.verdict === 'DONG_MISMATCH' ||
        r.verdict === 'REGION_MISMATCH'
      )
        s.changed++
      else if (r.verdict === 'NAME_MISMATCH') s.warning++
      else if (r.verdict === 'DEAD') s.danger++
    }
    return s
  }, [results])

  const avgMs = useMemo(() => {
    if (results.length === 0) return 0
    const sum = results.reduce((a, r) => a + (r.response_ms || 0), 0)
    return Math.round(sum / results.length)
  }, [results])

  const throughput = useMemo(() => {
    if (totalMs === 0 || results.length === 0) return 0
    return Number(((results.length / totalMs) * 1000).toFixed(1))
  }, [results.length, totalMs])

  /**
   * 검증 시작 — 1단계 "등록 체크" 또는 2단계 "재체크".
   * @param checkKind 'register'  → 정밀, 전체 등록 대상
   *                  'recheck'   → 정밀, current_verdict='PENDING' 만
   */
  const startCheck = async (checkKind: CheckKind) => {
    if (totalRegistered === 0) {
      alert('등록된 070 번호가 없습니다. 먼저 "등록 관리" 탭에서 등록해 주세요.')
      return
    }
    if (running) return

    // ── C) 재체크 진입 직전 placesData refetch ──
    // 이유: 화면의 PENDING 카운트는 useQuery 캐시(staleTime=15s)에 의존하므로,
    //       자동 정기 체크가 백그라운드에서 verdict 를 바꿔놓은 직후 사용자가
    //       "재체크" 를 누르면 실제 DB 의 PENDING 과 화면 카운트가 어긋난다.
    //       이 어긋남이 곧 "API 404: 재체크할 검증 대기 항목이 없습니다." 의
    //       근본 원인이었으므로, 청크 분할 직전에 최신 목록을 다시 가져온다.
    let targetIds: number[]
    if (checkKind === 'recheck') {
      try {
        const fresh = await listPlaces()
        // 캐시도 같이 갱신 — 화면의 카운트 라벨도 즉시 보정.
        qc.setQueryData(placeKeys.list(), fresh)
        targetIds = (fresh.items ?? [])
          .filter((p) => p.current_verdict === 'PENDING')
          .map((p) => p.id)
      } catch (e: unknown) {
        // refetch 자체가 실패하면 캐시 값으로 폴백 (네트워크 일시 단절 등)
        console.warn('[LiveCheck] PENDING refetch 실패, 캐시 사용:', e)
        targetIds = [...pendingPlaceIds]
      }
    } else {
      targetIds = [...allPlaceIds]
    }

    if (targetIds.length === 0) {
      // 재체크인데 PENDING 이 0건 — refetch 후에도 0이면 안내 후 종료.
      if (checkKind === 'recheck') {
        alert('재체크할 검증 대기 항목이 없습니다. (자동 체크가 이미 모두 정리했을 수 있어요)')
      } else {
        alert('검증할 등록이 없습니다.')
      }
      return
    }

    // 초기화
    setKind(checkKind)
    setRunning(true)
    setCancelling(false)
    setErrorMsg(null)
    setResults([])
    setTotalMs(0)
    setLastChunkMs([])
    cancelRef.current = false
    // 새 검증 세션의 AbortController — cancel() 시 진행 중인 청크 fetch 도 즉시 취소
    abortRef.current = new AbortController()

    const chunks: number[][] = []
    for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
      chunks.push(targetIds.slice(i, i + CHUNK_SIZE))
    }

    setProgress({
      chunk: 0,
      totalChunks: chunks.length,
      done: 0,
      total: targetIds.length,
    })
    // 청크 히스토리 초기화 — 전부 'waiting' 으로 시작
    setChunkStatuses(Array.from({ length: chunks.length }, () => 'waiting'))

    // Option A: 백단 진행 상태 백업 — 새로고침해도 30분간 유지
    const persistedSnapshot: PersistedRunState = {
      kind: checkKind,
      startedAt: Date.now(),
      totalChunks: chunks.length,
      totalTargets: targetIds.length,
    }
    writePersistedRunState(persistedSnapshot)
    setPersistedRun(persistedSnapshot)

    const kindLabel = checkKind === 'recheck' ? '재체크' : '등록 체크'
    console.log(
      `[LiveCheck] ${kindLabel} 시작: ${targetIds.length}건을 ${chunks.length}개 청크로 분할 (청크 크기: ${CHUNK_SIZE})`,
    )

    let accResults: VerificationResult[] = []
    let accMs = 0
    let skippedChunks = 0          // ── B) 회복 가능 에러로 skip 한 청크 카운트
    let lastSkipReason: string | null = null
    const t0 = performance.now()

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelRef.current) {
          console.log(`[LiveCheck] 사용자 취소 (청크 ${i + 1}/${chunks.length})`)
          break
        }
        const chunk = chunks[i]
        console.log(`[LiveCheck] 청크 ${i + 1}/${chunks.length} 전송 중 (${chunk.length}건)…`)
        setProgress((p) => ({ ...p, chunk: i + 1 }))
        // 이 청크 상태 → 'running'
        setChunkStatuses((prev) => {
          const next = [...prev]
          next[i] = 'running'
          return next
        })

        const ts = performance.now()
        // ── B) 청크별 에러 격리 ──
        // 한 청크 실패가 남은 청크를 못 잡아먹게 한다. 회복 가능한 에러
        // (404 — 재체크 청크가 이미 OK/DEAD 로 바뀜, 5xx — 네이버 일시 장애)는
        // skip 후 다음 청크로 자동 진행. 회복 불가 에러(401/409 락/사용자 취소)는
        // 바깥 catch 로 throw 해서 전체 중단.
        let resp: Awaited<ReturnType<typeof runLiveCheck>>
        try {
          // 두 단계 모두 정밀(full) 모드. 재체크는 only_pending 으로 백엔드에서도 한 번 더 필터.
          // Option B: 청크 메타를 함께 전송 — 백엔드 /verify/progress 가 정확한 진행 상태
          //   (몇 번째 청크 / 전체 청크 수 / 누적 건수)를 다른 탭/새로고침 후에도 노출 가능.
          resp = await runLiveCheck(
            {
              place_ids: chunk,
              mode: 'full',
              only_pending: checkKind === 'recheck',
              kind: checkKind,
              chunk_index: i,
              total_chunks: chunks.length,
              total_targets: targetIds.length,
            },
            { signal: abortRef.current?.signal },
          )
        } catch (chunkErr: unknown) {
          // 1) 사용자 취소는 전체 중단으로 escalate (바깥 catch 에서 처리)
          if (cancelRef.current || isAbortError(chunkErr)) {
            throw chunkErr
          }
          // 2) 인증 실패 / 락 충돌은 전체 중단 — 다음 청크도 100% 같은 에러를 받음
          if (chunkErr instanceof ApiError && (chunkErr.status === 401 || chunkErr.status === 409)) {
            throw chunkErr
          }
          // 3) 회복 가능한 청크 단발 실패 — 404 (재체크 대상 0건), 5xx 일시 장애 등
          //    → 이 청크만 skip, 다음 청크 계속 진행
          skippedChunks += 1
          lastSkipReason =
            chunkErr instanceof ApiError
              ? `청크 ${i + 1}: API ${chunkErr.status} ${chunkErr.message}`
              : `청크 ${i + 1}: ${(chunkErr as Error)?.message ?? '알 수 없는 오류'}`
          console.warn(`[LiveCheck] 청크 ${i + 1}/${chunks.length} skip — ${lastSkipReason}`)
          // skip 도 elapsed/진행률에 반영 — 사용자가 멈춘 줄 알지 않도록
          const skipElapsed = Math.round(performance.now() - ts)
          setLastChunkMs((prev) => [...prev, skipElapsed])
          // 청크 히스토리: skip 표시
          setChunkStatuses((prev) => {
            const next = [...prev]
            next[i] = 'skipped'
            return next
          })
          if (i < chunks.length - 1 && CHUNK_DELAY_MS > 0) {
            // 다음 청크는 'cooldown' 단계로 표시
            setChunkStatuses((prev) => {
              const next = [...prev]
              next[i + 1] = 'cooldown'
              return next
            })
            await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
          }
          continue
        }

        const elapsed = Math.round(performance.now() - ts)

        accMs += resp.total_ms || elapsed
        accResults = accResults.concat(resp.results || [])
        setResults([...accResults])
        setTotalMs(accMs)
        setProgress((p) => ({ ...p, done: accResults.length }))
        setLastChunkMs((prev) => [...prev, elapsed])
        // 이 청크 상태 → 'done'
        setChunkStatuses((prev) => {
          const next = [...prev]
          next[i] = 'done'
          return next
        })

        console.log(
          `[LiveCheck] 청크 ${i + 1}/${chunks.length} 완료 (${elapsed}ms): ` +
            `누적 ${accResults.length}/${targetIds.length}, ` +
            `ok=${resp.summary?.ok ?? 0} warn=${resp.summary?.warning ?? 0} dgr=${resp.summary?.danger ?? 0}`,
        )

        // 마지막 청크가 아니면 잠시 휴식 — 다음 청크 'cooldown' 라벨 + 시각적 호흡
        if (i < chunks.length - 1 && CHUNK_DELAY_MS > 0) {
          setChunkStatuses((prev) => {
            const next = [...prev]
            next[i + 1] = 'cooldown'
            return next
          })
          await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
        }
      }

      const total = Math.round(performance.now() - t0)
      console.log(
        `[LiveCheck] ${kindLabel} 완료: ${accResults.length}/${targetIds.length}건 ` +
          `(총 ${total}ms, skip=${skippedChunks})`,
      )
      // skip 이 있었으면 작은 경고만 — 정상 종료지만 사용자에게 보여줄 가치 있음
      if (skippedChunks > 0) {
        setErrorMsg(
          `검증이 완료됐지만 ${skippedChunks}개 청크는 건너뛰었습니다 ` +
            `(${lastSkipReason ?? '일시 오류'}). ` +
            `필요하면 잠시 후 "재체크"를 한 번 더 눌러주세요.`,
        )
      }
      // 캐시 무효화는 finally 에서 일괄 처리
    } catch (e: unknown) {
      // 사용자 취소(AbortError) 는 에러로 표시하지 않음
      if (cancelRef.current || isAbortError(e)) {
        console.log('[LiveCheck] 취소됨 — 진행 중인 청크 fetch abort')
      } else {
        const msg = formatApiError(e)
        console.error('[LiveCheck] 실패:', msg, e)
        setErrorMsg(msg)
      }
    } finally {
      setRunning(false)
      setCancelling(false)
      abortRef.current = null
      // Option A: 백단 진행 백업 제거 — 검증 사이클이 끝났으므로 추정 모드 해제
      clearPersistedRunState()
      setPersistedRun(null)
      // 부분 결과의 verdict/place 상태 반영을 위해 캐시 무효화
      qc.invalidateQueries({ queryKey: placeKeys.all })
      // Option B: 백엔드 progress 도 즉시 재조회 — UI 가 빠르게 idle 로 전환되도록
      qc.invalidateQueries({ queryKey: ['verify', 'progress'] })
      // 검증 직후 쿨다운(5분) 시작 — 사용자가 즉시 다시 누르는 것을 방지
      // (사용자 취소 시에는 쿨다운을 걸지 않음 — 의도적으로 멈춘 것이므로)
      if (!cancelRef.current) {
        startCooldown()
      }
    }
  }

  const cancel = () => {
    if (!running) return
    console.log('[LiveCheck] 사용자 취소 요청 — abort 신호 전송')
    cancelRef.current = true
    setCancelling(true)
    // 진행 중인 청크 fetch 를 즉시 abort (백엔드는 disconnect 감지)
    abortRef.current?.abort()
  }

  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  // ETA(남은 예상 시간) 계산 — 평균 청크 처리 시간 × 남은 청크 수
  const eta = useMemo(() => {
    if (!running || lastChunkMs.length === 0) return null
    const avgChunkMs = lastChunkMs.reduce((a, b) => a + b, 0) / lastChunkMs.length
    const remainingChunks = progress.totalChunks - progress.chunk
    const remainingMs = avgChunkMs * remainingChunks + remainingChunks * CHUNK_DELAY_MS
    return Math.max(0, Math.round(remainingMs / 1000))
  }, [running, lastChunkMs, progress.chunk, progress.totalChunks])

  // 진행 중 상단 카드의 라벨/설명 (kind 에 따라 동적)
  const runningLabel = kind === 'recheck' ? '재체크' : '등록 체크'

  // 자동 정기 체크 다음 시각 (KST 표시) — 사용자별 verify_slot 기반
  const nextAutoLabel = useMemo(() => {
    if (!schedulerData?.next_run_at) {
      return schedulerData?.verify_slot_label ?? null
    }
    const d = new Date(schedulerData.next_run_at)
    if (Number.isNaN(d.getTime())) return schedulerData.verify_slot_label ?? null
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }, [schedulerData])

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────
       *   상단 패널 — 검증 진행 상황 / 취소 버튼
       *   (running 일 때만 표시; 검증 종류는 kind 로 라벨 분기)
       *
       *   Option A: 새로고침 후 running=false 이지만 localStorage 에
       *   최근 시작 기록이 있으면 추정 모드로 별도 안내 배너를 띄운다.
       * ───────────────────────────────────────────────────────────── */}
      {/* 새로고침 후 / 다른 탭에서 백엔드가 검증 중 — 통합 안내 배너.
       *   우선순위:
       *     · backendProgress.running === true 가 진실 원천 (다른 탭/기기 포함)
       *     · 그것이 없을 때만 추정 모드(persistedRun)로 폴백
       *
       *   running=true 일 때는 본 카드 대신 아래 진행 카드가 떠 있으므로 숨김. */}
      {!running && (backendProgress?.running || persistedRun) && (
        <Card variant="dark" className="min-h-[120px] !bg-amber-900/30 border border-amber-400/40">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <Loader2 size={20} className="animate-spin text-amber-200" />
            </div>
            <div className="flex-1">
              <h3 className="text-h3 text-amber-100 mb-1">
                {backendProgress?.running ? (
                  <>
                    {backendProgress.kind === 'recheck' ? '재체크' : backendProgress.kind === 'register' ? '등록 체크' : '검증'}
                    가 백에서 진행 중이에요
                  </>
                ) : (
                  <>이전 {persistedRun?.kind === 'recheck' ? '재체크' : '등록 체크'}가 아직 백에서 진행 중일 수 있어요</>
                )}
              </h3>
              <p className="text-body-sm text-amber-100/85">
                {backendProgress?.running && backendProgress.total > 0 ? (
                  // 백엔드가 정확한 진행 상태를 보고 — 청크/건수까지 표시
                  <>
                    청크{' '}
                    <span className="font-bold tabular-nums">
                      {backendProgress.chunk_index ?? '—'}/{backendProgress.total_chunks ?? '—'}
                    </span>
                    {' '}·{' '}
                    <span className="font-bold tabular-nums">
                      {backendProgress.done}/{backendProgress.total}건
                    </span>
                    {' '}처리 중입니다.
                    {backendProgress.started_at && (
                      <>
                        {' '}
                        <span className="tabular-nums text-amber-100/70">
                          (시작 후 {Math.floor((Date.now() - backendProgress.started_at) / 60000)}분 경과)
                        </span>
                      </>
                    )}
                  </>
                ) : persistedRun ? (
                  // 백엔드 응답이 아직 안 왔거나 idle 인데 추정 모드만 살아있을 때
                  <>
                    <span className="font-bold">{persistedRun.totalTargets}건</span>을 {persistedRun.totalChunks}개 청크로 분할해 호출했고,
                    {' '}
                    <span className="tabular-nums">
                      {Math.floor((Date.now() - persistedRun.startedAt) / 60000)}분 경과
                    </span>
                    {' '}상태입니다.
                  </>
                ) : null}
                <br />
                <span className="text-caption text-amber-100/70">
                  중복 실행을 막기 위해 등록 체크 / 재체크 버튼을 잠시 잠그어 둡니다.
                  {backendProgress?.running
                    ? ' · 백엔드 완료가 감지되면 자동 해제됩니다.'
                    : ' · 최대 30분 후 자동 해제되며, 지금 해제하려면 아래 버튼을 눌러주세요.'}
                </span>
              </p>
              {/* 백엔드가 실제로 진행 중이면 강제 해제 버튼은 숨김 (위험) — 추정 모드일 때만 표시 */}
              {!backendProgress?.running && persistedRun && (
                <button
                  type="button"
                  onClick={() => {
                    clearPersistedRunState()
                    setPersistedRun(null)
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-amber-100/15 hover:bg-amber-100/25 text-amber-100 text-caption font-semibold transition-colors"
                >
                  <RefreshCw size={12} /> 이제 끝났어요 — 버튼 잠금 해제
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {running && (
        <Card variant="dark" className="min-h-[180px]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/15 text-white/90 text-caption font-bold uppercase tracking-wider mb-3">
                <ShieldCheck size={12} /> live verification
              </span>
              <h3 className="text-h2 text-white mb-2">
                🔍 {runningLabel} 진행 중 (정밀 모드)
              </h3>
              <p className="text-body-sm text-white/75">
                <span className="font-bold text-white">{progress.total}</span>개의 070 번호에
                대해 플레이스 ID + 전화번호 + 동/로/리 일치 여부까지 정밀 검증합니다.
                <br />
                <span className="text-caption text-white/60">
                  {CHUNK_SIZE}건씩 청크로 나눠 직렬 호출 · 정확도 우선(네이버 차단 회피)
                  으로 충분한 호출 간격을 두고 진행합니다 · 청크당 약 1~2분
                </span>
              </p>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={cancel}
                disabled={cancelling}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-pill bg-red-500/90 hover:bg-red-500 text-white font-semibold text-body-sm transition-all disabled:opacity-60 disabled:cursor-wait"
              >
                {cancelling ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 취소 중…
                  </>
                ) : (
                  <>
                    <StopCircle size={16} /> 취소
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 청크별 진행률 막대 + ETA */}
          {progress.totalChunks > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-caption text-white/80 mb-2 tabular-nums">
                <span>
                  청크 {progress.chunk}/{progress.totalChunks} · {progress.done}/{progress.total}건
                </span>
                <div className="flex items-center gap-3">
                  {eta !== null && eta > 0 && (
                    <span className="text-white/70">
                      남은 시간 약 {eta < 60 ? `${eta}초` : `${Math.floor(eta / 60)}분 ${eta % 60}초`}
                    </span>
                  )}
                  <span className="font-bold text-white">{progressPct}%</span>
                </div>
              </div>
              <div className="h-2 bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-300 to-white rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* ── 청크 히스토리 — 청크 1 완료 / 청크 2 체크중 / 청크 3 대기 라벨 ──
               *   청크가 많을 때 (예: 10개+) 는 수직 스크롤 목록으로 표시.
               *   각 아이템은 이모지 아이콘과 함께 상태를 드러낸다: */}
              <div className="mt-4">
                <div className="text-caption text-white/70 mb-2 uppercase tracking-wider font-bold">
                  청크 진행 현황
                </div>
                <div className="max-h-[200px] overflow-y-auto space-y-1 pr-1 rounded-card bg-white/5 p-2">
                  {chunkStatuses.map((status, idx) => (
                    <ChunkStatusRow
                      key={idx}
                      index={idx}
                      total={chunkStatuses.length}
                      status={status}
                      ms={lastChunkMs[idx]}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────
       *   3단계 검증 액션 카드 (running 이 아닐 때만 표시)
       *   1) 등록 체크 — 전체 정밀
       *   2) 재체크    — PENDING 만 정밀 (PENDING ≥ 1 일 때만 활성)
       *   3) 자동 정기 체크 — 안내만 (트리거 없음)
       * ───────────────────────────────────────────────────────────── */}
      {!running && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1단계 — 등록 체크 */}
          <Card variant="dark" className="flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-white/15 text-white/90 text-caption font-bold uppercase tracking-wider self-start mb-3">
              <ShieldCheck size={12} /> 1단계
            </span>
            <h3 className="text-h3 text-white mb-1">🔍 등록 체크</h3>
            <p className="text-caption text-white/70 mb-4 flex-1">
              등록된{' '}
              <span className="font-bold text-white">{totalRegistered}</span>개의 070
              번호를 정밀 검증합니다 (전화 + 동/로/리). <strong className="text-white">정확도 우선</strong>
              으로 직렬 호출 + 충분한 호출 간격을 두고 진행되어 시간이 다소
              걸리지만(예: 296건 ≈ 약 3~5분) 네이버 차단 위험이 거의 없습니다.
              등록 직후 1회만 실행하시면 됩니다.
            </p>
            <button
              type="button"
              onClick={() => startCheck('register')}
              disabled={totalRegistered === 0 || cooldownLeft > 0 || backendBusy}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-pill bg-white text-brand-700 font-bold text-body-sm shadow-card hover:shadow-card-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title={
                backendBusy && !running
                  ? '이전 검증이 아직 백에서 진행 중일 수 있어요. 상단 안내를 참고하세요.'
                  : cooldownLeft > 0
                  ? `네이버 차단 회피를 위해 ${cooldownLabel} 후에 다시 시도할 수 있어요.`
                  : undefined
              }
            >
              <Play size={14} />
              {backendBusy && !running
                ? '백단 진행 중 (잠김)'
                : cooldownLeft > 0
                ? `재시도 가능 ${cooldownLabel}`
                : '등록 체크 시작'}
            </button>
          </Card>

          {/* 2단계 — 재체크 (PENDING 만) */}
          <Card variant="dark" className="flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-amber-400/25 text-amber-100 text-caption font-bold uppercase tracking-wider self-start mb-3">
              <RefreshCw size={12} /> 2단계
            </span>
            <h3 className="text-h3 text-white mb-1">🔄 재체크 ({pendingCount}건)</h3>
            <p className="text-caption text-white/70 mb-4 flex-1">
              1단계 등록 체크에서{' '}
              <span className="font-bold text-amber-200">검증 대기</span>로 보류된
              항목만 정밀 모드로 재검증합니다. 일시 차단(429/403)이 풀린 뒤 한
              번에 정리하기 좋은 단계입니다.
              {cooldownLeft > 0 && (
                <>
                  <br />
                  <span className="text-amber-200 font-semibold">
                    ⏳ 네이버 차단 회피용 쿨다운 — {cooldownLabel} 후 재시도
                  </span>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => startCheck('recheck')}
              disabled={pendingCount === 0 || cooldownLeft > 0 || backendBusy}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-pill bg-white text-brand-700 font-bold text-body-sm shadow-card hover:shadow-card-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title={
                backendBusy && !running
                  ? '이전 검증이 아직 백에서 진행 중일 수 있어요. 상단 안내를 참고하세요.'
                  : pendingCount === 0
                  ? '검증 대기 항목이 없습니다.'
                  : cooldownLeft > 0
                  ? `네이버 차단 회피를 위해 ${cooldownLabel} 후에 다시 시도할 수 있어요.`
                  : undefined
              }
            >
              <RefreshCw size={14} />
              {backendBusy && !running
                ? '백단 진행 중 (잠김)'
                : cooldownLeft > 0
                ? `재시도 가능 ${cooldownLabel}`
                : `재체크 (${pendingCount}건)`}
            </button>
          </Card>

          {/* 3단계 — 자동 정기 체크 (안내) */}
          <Card variant="dark" className="flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-emerald-400/25 text-emerald-100 text-caption font-bold uppercase tracking-wider self-start mb-3">
              <CalendarClock size={12} /> 3단계
            </span>
            <h3 className="text-h3 text-white mb-1">⚡ 자동 정기 체크</h3>
            <p className="text-caption text-white/70 mb-4 flex-1">
              매일 사용자별 시각에 빠른 모드(페이지 존재 유무)로 서버에서 자동
              실행됩니다. 시간 제약 없이 직렬 호출 + 충분한 간격으로 진행되어
              네이버 차단 위험 없이 안정적으로 동작합니다. 변경이 감지되면
              이메일로 알림을 받으실 수 있습니다.
            </p>
            <div className="px-3 py-2 rounded-card bg-white/5 border border-white/10">
              <div className="text-caption text-white/60 mb-0.5">다음 자동 정기 체크</div>
              <div className="text-body text-white font-bold tabular-nums">
                {nextAutoLabel ?? '—'}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ───── 에러 표시 ───── */}
      {errorMsg && (
        <div className="px-4 py-3 rounded-card bg-red-50 border border-red-200 text-status-danger flex items-center gap-2">
          <AlertTriangle size={14} />
          검증 실패: {errorMsg}
        </div>
      )}

      {/* ───── 결과 요약 (1건 이상 결과 누적 시) ───── */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryStat
            icon={<CheckCircle2 size={16} />}
            label="정상 노출"
            value={summary.ok}
            tone="success"
          />
          <SummaryStat
            icon={<XCircle size={16} />}
            label="변경 노출"
            value={summary.changed + summary.warning}
            tone="info"
          />
          <SummaryStat
            icon={<XCircle size={16} />}
            label="네이버 미노출"
            value={summary.danger}
            tone="danger"
          />
          <SummaryStat
            icon={<Clock size={16} />}
            label="평균 응답"
            value={`${avgMs}`}
            unit="ms"
            tone="info"
          />
          <SummaryStat
            icon={<Zap size={16} />}
            label="처리량"
            value={`${throughput.toFixed(1)}`}
            unit="req/s"
            tone="info"
          />
        </div>
      )}

      {/* ───── 상세 결과 테이블 ───── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">상세 검증 결과</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              {results.length === 0
                ? '위의 "등록 체크" 또는 "재체크" 버튼을 눌러 정밀 검증을 수행하세요.'
                : `${kind === 'recheck' ? '재체크' : '등록 체크'} (정밀): ` +
                  `✓ 페이지 생존 / ✓ 전화 / ✓ 동·로·리 (총 ${results.length}건)`}
            </p>
          </div>
          {totalMs > 0 && (
            <div className="text-caption text-ink-muted tabular-nums">
              총 {totalMs}ms 누적
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                  <th className="px-card-sm py-3 font-semibold">070 / Place ID</th>
                  <th className="px-3 py-3 font-semibold">등록값 → 실제값</th>
                  <th className="px-3 py-3 font-semibold">생존</th>
                  <th className="px-3 py-3 font-semibold">전화</th>
                  <th className="px-3 py-3 font-semibold">동</th>
                  <th className="px-3 py-3 font-semibold">상호</th>
                  <th className="px-3 py-3 font-semibold">판정</th>
                  <th className="px-card-sm py-3 font-semibold text-right">응답</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.place_id_ref}
                    className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors align-top"
                  >
                    <td className="px-card-sm py-3">
                      <div className="text-ink font-semibold tabular-nums">
                        {r.phone}
                      </div>
                      <div className="text-caption text-ink-muted font-mono mt-0.5">
                        {r.place_id ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-caption">
                      <ComparisonRow
                        icon={<MapPin size={11} />}
                        expected={r.registered_dong ?? '—'}
                        actual={r.detail.actual_dong ?? '—'}
                        match={r.detail.dong_match}
                      />
                      <ComparisonRow
                        icon={<Building2 size={11} />}
                        expected={r.business_name ?? '—'}
                        actual={r.detail.actual_name ?? '—'}
                        match={r.detail.name_match}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.alive} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.phone_match} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.dong_match} />
                    </td>
                    <td className="px-3 py-3">
                      <CheckIcon ok={r.detail.name_match} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5" title={errorTooltip(r.error)}>
                        <VerdictBadge verdict={r.verdict} />
                        {(r.verdict === 'PENDING' || r.verdict === 'DEAD') && r.error && (
                          <span className="text-caption text-ink-soft truncate max-w-[140px]">
                            {errorShortLabel(r.error)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-card-sm py-3 text-right text-caption text-ink-muted tabular-nums">
                      {r.response_ms}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ───────────── 서브 컴포넌트 ───────────── */

/** 검증 실패 사유 짧은 라벨 — 표 셀에 표시 (PENDING / DEAD 공통) */
function errorShortLabel(err: string): string {
  // ── 일시 차단 (PENDING) ──
  if (err.startsWith('naver_blocked_captcha')) return '네이버 일시 차단'
  if (err.startsWith('http_403')) return '403 차단'
  if (err.startsWith('http_429') || err.includes('rate_limited')) return '429 일시 제한'
  if (err.startsWith('http_5')) return '네이버 5xx 오류'
  if (err.startsWith('network')) return '네트워크 오류'
  if (err.startsWith('extract_exception')) return '추출 오류'
  // ── 페이지 누락 (DEAD) ──
  if (err.startsWith('place_id_not_found')) return '플레이스 미노출'
  if (err.startsWith('name_not_found_in_search')) return '검색 결과 없음'
  return err
}

/** 검증 실패 사유 툴팁 — 사용자에게 안내 메시지 */
function errorTooltip(err: string | null | undefined): string | undefined {
  if (!err) return undefined
  // ── 일시 차단 (PENDING) ──
  if (err.startsWith('naver_blocked_captcha'))
    return '네이버가 일시적으로 캡차/차단 페이지를 응답했어요. 5~10분 후 재체크해 주세요.'
  if (err.startsWith('http_403'))
    return '네이버가 403(접근 차단) 으로 응답했어요. 잠시 후 재체크하세요.'
  if (err.includes('429') || err.includes('rate_limited'))
    return '요청량이 일시적으로 많아 429(과도한 요청)로 응답했어요. 5분 후 재체크하세요.'
  if (err.startsWith('http_5'))
    return '네이버 서버 일시 오류(5xx). 잠시 후 재체크하세요.'
  if (err.startsWith('network'))
    return '네트워크 오류로 검색 응답을 받지 못했어요. 잠시 후 재체크하세요.'
  // ── 페이지 누락 (DEAD) ──
  if (err.startsWith('place_id_not_found'))
    return '네이버 검색에 이 070 번호로 매칭되는 플레이스가 없어요. 폐업/삭제됐거나 등록 관리에서 Place ID 를 직접 입력해 주세요.'
  if (err.startsWith('name_not_found_in_search'))
    return '검색 결과에서 상호명을 찾지 못했어요. 등록 관리에서 Place ID 를 직접 확인해 주세요.'
  return err
}

function CheckIcon({ ok }: { ok: boolean | null | undefined }) {
  // fast 모드에서는 검증을 건너뛰므로 null — "—" 표시
  if (ok === null || ok === undefined) {
    return <span className="text-ink-soft text-caption font-mono" title="빠른 검증 — 비교 생략">—</span>
  }
  return ok ? (
    <CheckCircle2 size={16} className="text-status-success" />
  ) : (
    <XCircle size={16} className="text-status-danger" />
  )
}

interface ComparisonRowProps {
  icon: React.ReactNode
  expected: string
  actual: string
  match: boolean | null | undefined
}

function ComparisonRow({ icon, expected, actual, match }: ComparisonRowProps) {
  // fast 모드: match===null → 비교 자체가 없었음 → 회색 처리 + "—"
  const isSkipped = match === null || match === undefined
  return (
    <div className="flex items-center gap-1.5 mb-1 last:mb-0">
      <span className="text-ink-muted">{icon}</span>
      <span className="text-ink-muted truncate max-w-[140px]" title={expected}>
        {expected}
      </span>
      <span className="text-ink-soft">→</span>
      <span
        className={
          isSkipped
            ? 'text-ink-soft italic truncate max-w-[140px]'
            : match
            ? 'text-status-success font-medium truncate max-w-[140px]'
            : 'text-status-danger font-medium truncate max-w-[140px]'
        }
        title={isSkipped ? '빠른 검증 — 비교 생략' : actual}
      >
        {isSkipped ? '—' : actual}
      </span>
    </div>
  )
}

/* ─── 청크 진행 상태 1행 — 등록 체크 진행 중 상단 카드에서 사용 ───
 *   상태에 따라 아이콘 + 색상 + 텍스트가 동적으로 바뀐다:
 *     · 'waiting'  ⏸  대기 중       (회색)
 *     · 'running'  🔄  체크 중        (앰버, 스피너)
 *     · 'cooldown' ⏳  쿨다운 중      (스카이블루, 다음 청크 준비)
 *     · 'done'     ✅  완료 (xx ms)   (초록)
 *     · 'skipped'  ⚠   건너뜀         (회색, 점선)
 */
interface ChunkStatusRowProps {
  index: number
  total: number
  status: ChunkStatus
  ms?: number
}

function ChunkStatusRow({ index, total, status, ms }: ChunkStatusRowProps) {
  const num = index + 1
  const baseLabel = `청크 ${num}/${total}`
  // 상태별 스타일/아이콘/라벨 — 한국어 우선
  if (status === 'done') {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-emerald-400/10 text-emerald-100">
        <span className="flex items-center gap-2 text-caption">
          <CheckCircle2 size={14} className="text-emerald-300" />
          <span className="font-semibold">{baseLabel}</span>
          <span className="text-emerald-100/70">완료</span>
        </span>
        {typeof ms === 'number' && (
          <span className="text-caption text-emerald-100/70 tabular-nums">{ms}ms</span>
        )}
      </div>
    )
  }
  if (status === 'running') {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-amber-400/15 text-amber-100">
        <span className="flex items-center gap-2 text-caption">
          <Loader2 size={14} className="animate-spin text-amber-200" />
          <span className="font-semibold">{baseLabel}</span>
          <span className="text-amber-100/80">체크 중…</span>
        </span>
      </div>
    )
  }
  if (status === 'cooldown') {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-sky-400/15 text-sky-100">
        <span className="flex items-center gap-2 text-caption">
          <Clock size={14} className="text-sky-200" />
          <span className="font-semibold">{baseLabel}</span>
          <span className="text-sky-100/80">쿨다운 중 (다음 청크 준비)</span>
        </span>
      </div>
    )
  }
  if (status === 'skipped') {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white/5 text-white/60 border border-dashed border-white/15">
        <span className="flex items-center gap-2 text-caption">
          <AlertTriangle size={14} className="text-white/50" />
          <span className="font-semibold">{baseLabel}</span>
          <span>건너뜀 (일시 오류)</span>
        </span>
        {typeof ms === 'number' && (
          <span className="text-caption text-white/40 tabular-nums">{ms}ms</span>
        )}
      </div>
    )
  }
  // waiting (default)
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 rounded text-white/50">
      <span className="flex items-center gap-2 text-caption">
        <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-white/40">⏸</span>
        <span className="font-semibold">{baseLabel}</span>
        <span>대기 중</span>
      </span>
    </div>
  )
}

interface SummaryStatProps {
  icon: React.ReactNode
  label: string
  value: number | string
  unit?: string
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function SummaryStat({ icon, label, value, unit, tone }: SummaryStatProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  return (
    <Card variant="white" className="!p-4">
      <div className="flex items-center justify-between mb-2">
        <div
          className={`w-8 h-8 rounded-xl ${toneClass} flex items-center justify-center`}
        >
          {icon}
        </div>
      </div>
      <div className="text-caption text-ink-muted mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-h2 text-ink tabular-nums leading-none">{value}</span>
        {unit && <span className="text-caption text-ink-muted">{unit}</span>}
      </div>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <div className="w-16 h-16 mx-auto rounded-card bg-brand-50 text-brand-500 flex items-center justify-center mb-4">
        <Activity size={28} />
      </div>
      <div className="text-body text-ink font-semibold mb-1">
        검증 결과가 아직 없습니다
      </div>
      <div className="text-caption text-ink-muted">
        상단의 "등록 체크" 또는 "재체크" 버튼을 누르면 정밀 검증이 실행됩니다.
      </div>
    </div>
  )
}

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) {
      // status=0 은 (1) 네트워크 단절, (2) 자체 timeout, (3) 사용자 abort 모두 포함.
      // request timeout 은 정밀모드에서 네이버 rate-limit 회복 대기로 발생할 수 있음.
      if (/timeout/i.test(e.message)) {
        return (
          '검증 요청 시간 초과. 네이버 요청 한도(429) 영향으로 마지막 청크가 ' +
          '오래 걸렸을 수 있습니다. 부분 결과는 자동 저장되었으니 잠시 후 ' +
          '"등록 관리" 탭에서 결과를 확인하거나 빠른 검증으로 다시 시도해 주세요.'
        )
      }
      return `네트워크 오류 (백엔드 연결 확인): ${e.message}`
    }
    if (e.status === 409) {
      // 동일 사용자가 이미 검증 진행 중 — 백엔드 락 충돌
      return '이전 검증이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요.'
    }
    return `API ${e.status}: ${e.message}`
  }
  return (e as Error).message ?? '알 수 없는 오류'
}

/** fetch abort 로 인한 에러를 식별 — 사용자 취소 시 에러로 표시하지 않기 위함 */
function isAbortError(e: unknown): boolean {
  if (e instanceof ApiError && e.status === 0) {
    // ApiError(status=0) 중 message 가 'Aborted' 또는 'aborted' 인 경우
    return /abort/i.test(e.message)
  }
  if (e instanceof Error) {
    return e.name === 'AbortError' || /abort/i.test(e.message)
  }
  return false
}
