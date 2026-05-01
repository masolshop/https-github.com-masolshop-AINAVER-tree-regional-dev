/**
 * 지역별 경쟁도 분석 솔루션 (솔루션 #2)
 *
 * 데이터 소스: m.map.naver.com 지도 섹션 (PoC 검증 완료)
 * 판정: 도로명·지번 모두 번지 없음 → 타지역
 * 등급:
 *   · 청정  1-5  (emerald)
 *   · 경쟁  6-10 (yellow)
 *   · 과열  11-15 (orange)
 *   · 포화  16+   (red)
 *   · 없음  0     (slate)
 *
 * 모드:
 *   · Fast    — 시도/시군구 prefix 1-N 호출 (5-30s, 즉시 응답)
 *   · Precise — 시도×시군구의 모든 동/리 prefix 호출 (백그라운드 job, 30s-5min)
 */
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import clsx from 'clsx'
import {
  Search as SearchIcon,
  Download,
  AlertTriangle,
  ExternalLink,
  MapPin,
  Zap,
  Crosshair,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { keywordApi } from '@/api/keyword'
import { competitionApi } from '@/api/competition'
import type { RegionsResponse } from '@/api/keyword'
import type {
  CompetitionGrade,
  CompetitionRow,
  CompetitionPlace,
  FastScanResponse,
  PreciseJobStatus,
} from '@/api/competition'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'

// ─────────────────────────────────────────────────────────
// 등급 상수 — 사용자 요청: 청정 1-5 / 경쟁 6-10 / 과열 11-15 / 포화 16+
// ─────────────────────────────────────────────────────────
const GRADE_ORDER: CompetitionGrade[] = ['saturated', 'heated', 'compete', 'clean', 'none']

const GRADE_LABEL_KO: Record<CompetitionGrade, string> = {
  saturated: '포화',
  heated: '과열',
  compete: '경쟁',
  clean: '청정',
  none: '없음',
}

const GRADE_RANGE: Record<CompetitionGrade, string> = {
  saturated: '16+',
  heated: '11-15',
  compete: '6-10',
  clean: '1-5',
  none: '0',
}

const GRADE_PILL: Record<CompetitionGrade, string> = {
  saturated: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  heated: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
  compete: 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200',
  clean: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  none: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
}

const GRADE_BAR: Record<CompetitionGrade, string> = {
  saturated: 'bg-red-500',
  heated: 'bg-orange-500',
  compete: 'bg-yellow-500',
  clean: 'bg-emerald-500',
  none: 'bg-slate-300',
}

const GRADE_DOT: Record<CompetitionGrade, string> = {
  saturated: 'bg-red-500',
  heated: 'bg-orange-500',
  compete: 'bg-yellow-500',
  clean: 'bg-emerald-500',
  none: 'bg-slate-300',
}

function GradePill({ g }: { g: CompetitionGrade }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap',
        GRADE_PILL[g],
      )}
    >
      <span className={clsx('inline-block w-2 h-2 rounded-full', GRADE_DOT[g])} />
      {GRADE_LABEL_KO[g]}
    </span>
  )
}

function todayKstDate(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000)
  return kst.toISOString().slice(0, 10)
}

function safeFilename(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

// ─────────────────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────────────────
type ScanMode = 'fast' | 'precise'

export default function Competition() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [regions, setRegions] = useState<RegionsResponse | null>(null)
  const [scanMode, setScanMode] = useState<ScanMode>('fast')

  // 공통 입력
  const [keyword, setKeyword] = useState('흥신소')
  const [scope, setScope] = useState<'nationwide' | 'sido' | 'sigungu'>('sido')
  const [sido, setSido] = useState('서울특별시')
  const [sigungu, setSigungu] = useState('')
  const [paceMs, setPaceMs] = useState(400)
  const [concurrency, setConcurrency] = useState(5)

  // Fast 결과
  const [fastResult, setFastResult] = useState<FastScanResponse | null>(null)
  const [fastLoading, setFastLoading] = useState(false)

  // Precise 결과 (job)
  const [job, setJob] = useState<PreciseJobStatus | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [estSec, setEstSec] = useState(0)
  const [starting, setStarting] = useState(false)

  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [detail, setDetail] = useState<CompetitionRow | null>(null)
  const [minOther, setMinOther] = useState(0)

  // 인증 후 regions 로드
  useEffect(() => {
    if (!isAuthenticated) return
    if (regions) return
    keywordApi.regions()
      .then((r) => {
        setRegions(r)
        if (!sido && r.tree['서울특별시']) setSido('서울특별시')
      })
      .catch((e) => setErrMsg(e instanceof Error ? e.message : '지역 데이터 로드 실패'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  // 시도 변경 시 시군구 초기화
  useEffect(() => {
    setSigungu('')
  }, [sido])

  // job 폴링
  useEffect(() => {
    if (!jobId) return
    let stop = false
    let tries = 0
    const tick = async () => {
      try {
        const s = await competitionApi.jobStatus(jobId, true)
        if (stop) return
        setJob(s)
        if (s.status === 'running') {
          tries++
          setTimeout(tick, 1500)
        }
      } catch (e) {
        if (stop) return
        if (tries < 5) {
          tries++
          setTimeout(tick, 2000)
        } else {
          setErrMsg(e instanceof Error ? e.message : 'job polling 실패')
        }
      }
    }
    tick()
    return () => {
      stop = true
    }
  }, [jobId])

  const sidos = useMemo(() => (regions ? Object.keys(regions.tree) : []), [regions])
  const sigungus = useMemo(() => {
    if (!regions || !sido) return [] as string[]
    return Object.keys(regions.tree[sido] || {})
  }, [regions, sido])

  const dongCount = useMemo(() => {
    if (!regions) return 0
    if (scanMode !== 'precise') return 0
    if (!sido) return 0
    if (scope === 'sigungu' && sigungu) {
      return (regions.tree[sido]?.[sigungu] || []).length
    }
    if (scope === 'sido') {
      const s = regions.tree[sido] || {}
      return Object.values(s).reduce((acc, arr) => acc + arr.length, 0)
    }
    return 0
  }, [regions, sido, sigungu, scope, scanMode])

  // ── Fast 시작 ────────────────────────────────────────
  const startFast = async () => {
    if (!isAuthenticated) {
      openLoginModal('/competition')
      return
    }
    const kw = keyword.trim()
    if (!kw) {
      setErrMsg('키워드를 입력해 주세요.')
      return
    }
    if (scope !== 'nationwide' && !sido) {
      setErrMsg('시도를 선택해 주세요.')
      return
    }
    if (scope === 'sigungu' && !sigungu) {
      setErrMsg('시군구를 선택해 주세요.')
      return
    }
    setErrMsg(null)
    setFastResult(null)
    setFastLoading(true)
    try {
      const res = await competitionApi.scanFast({
        keyword: kw,
        scope,
        sido: scope === 'nationwide' ? '' : sido,
        sigungu: scope === 'sigungu' ? sigungu : '',
        pace_ms: paceMs,
        concurrency,
      })
      setFastResult(res)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Fast 스캔 실패'
      setErrMsg(msg)
    } finally {
      setFastLoading(false)
    }
  }

  // ── Precise 시작 ─────────────────────────────────────
  const startPrecise = async () => {
    if (!isAuthenticated) {
      openLoginModal('/competition')
      return
    }
    const kw = keyword.trim()
    if (!kw) {
      setErrMsg('키워드를 입력해 주세요.')
      return
    }
    if (!sido) {
      setErrMsg('시도를 선택해 주세요.')
      return
    }
    const pscope: 'sigungu' | 'sido' = scope === 'sido' ? 'sido' : 'sigungu'
    if (pscope === 'sigungu' && !sigungu) {
      setErrMsg('시군구를 선택해 주세요.')
      return
    }
    setErrMsg(null)
    setJob(null)
    setJobId(null)
    setStarting(true)
    try {
      const res = await competitionApi.scanPrecise({
        keyword: kw,
        scope: pscope,
        sido,
        sigungu: pscope === 'sigungu' ? sigungu : '',
        pace_ms: paceMs,
        concurrency,
      })
      setEstSec(res.estimated_seconds)
      setJobId(res.job_id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Precise 스캔 실패'
      setErrMsg(msg)
    } finally {
      setStarting(false)
    }
  }

  // ── 현재 결과 (Fast | Precise job) ──────────────────
  const result = scanMode === 'fast' ? fastResult : job
  const rows = result?.rows || []
  const dist = result?.dist
  const totals = result?.totals

  const filteredRows = useMemo(() => {
    return rows.filter((r) => r.other >= minOther)
  }, [rows, minOther])

  // ── Excel 다운로드 ───────────────────────────────────
  const exportSummary = () => {
    if (!result || rows.length === 0) return
    const sheet = filteredRows.map((r) => ({
      시도: r.sido,
      시군구: r.sigungu,
      '동/리': r.dong,
      타지역수: r.other,
      메인수: r.main,
      총수: r.total,
      등급: GRADE_LABEL_KO[r.grade],
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), '동별경쟁도')
    const fname = `네이버_경쟁도_${safeFilename(result.keyword || keyword)}_${todayKstDate()}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  const exportDetail = () => {
    if (!result || rows.length === 0) return
    const detailRows: any[] = []
    for (const r of filteredRows) {
      r.items.forEach((it, idx) => {
        detailRows.push({
          시도: r.sido,
          시군구: r.sigungu,
          '동/리': r.dong,
          등급: GRADE_LABEL_KO[r.grade],
          순위: idx + 1,
          분류: it.is_other_region ? '타지역' : '메인',
          상호: it.name,
          카테고리: it.category,
          전번: it.phone || it.virtual_phone,
          주소: it.address,
          도로명: it.road_address,
          place_id: it.place_id,
        })
      })
    }
    const summarySheet = filteredRows.map((r) => ({
      시도: r.sido,
      시군구: r.sigungu,
      '동/리': r.dong,
      타지역수: r.other,
      메인수: r.main,
      총수: r.total,
      등급: GRADE_LABEL_KO[r.grade],
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), '동별경쟁도_요약')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '업체상세')
    const fname = `네이버_경쟁도_상세_${safeFilename(result.keyword || keyword)}_${todayKstDate()}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  const isPreciseRunning = scanMode === 'precise' && !!job && job.status === 'running'

  return (
    <div className="px-4 lg:px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
          <MapPin className="text-blue-600" size={24} />
          지역별 경쟁도 분석 솔루션
        </h1>
        <p className="text-sm text-ink-2 mt-1">
          네이버 지도 섹션을 동별로 분석해 타지역 등록 업체 수로 경쟁도(4단계)를 산출합니다.
          예: <strong>“흥신소”</strong> 검색 시 압구정동에 27개 타지역이 등록되어 있다면 <strong>포화</strong> 등급.
        </p>
      </div>

      {/* 모드 선택 */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setScanMode('fast')}
            className={clsx(
              'px-4 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition',
              scanMode === 'fast'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-ink-1 border-slate-300 hover:border-blue-400',
            )}
          >
            <Zap size={16} /> Fast 모드
            <span className="text-[11px] opacity-75">(5-30초)</span>
          </button>
          <button
            type="button"
            onClick={() => setScanMode('precise')}
            className={clsx(
              'px-4 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition',
              scanMode === 'precise'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-ink-1 border-slate-300 hover:border-blue-400',
            )}
          >
            <Crosshair size={16} /> Precise 모드
            <span className="text-[11px] opacity-75">(30초-5분)</span>
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-2">
          {scanMode === 'fast' ? (
            <>
              <b>Fast</b> — 시도/시군구 prefix 1-N회 호출(예: “서울 흥신소”). 한 호출당 75건이라 큰 시군구는 일부 동이 누락될 수 있습니다.
            </>
          ) : (
            <>
              <b>Precise</b> — 시도×시군구의 모든 동/리 prefix를 호출(예: “압구정동 흥신소”). 동별 정밀도 100%, 시간 더 소요.
            </>
          )}
        </p>
      </Card>

      {/* 입력 폼 */}
      <Card className="p-4 space-y-4">
        {/* 검색 범위 */}
        <div>
          <div className="text-xs font-semibold text-ink-2 mb-1.5">검색 범위</div>
          <div className="flex flex-wrap gap-2">
            {scanMode === 'fast' && (
              <button
                type="button"
                onClick={() => setScope('nationwide')}
                className={clsx(
                  'px-3 py-1.5 rounded-md border text-sm',
                  scope === 'nationwide'
                    ? 'bg-blue-50 text-blue-700 border-blue-300'
                    : 'bg-white text-ink-1 border-slate-300',
                )}
              >
                전국 ({sidos.length} 시도)
              </button>
            )}
            <button
              type="button"
              onClick={() => setScope('sido')}
              className={clsx(
                'px-3 py-1.5 rounded-md border text-sm',
                scope === 'sido'
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'bg-white text-ink-1 border-slate-300',
              )}
            >
              시·도 단위
            </button>
            <button
              type="button"
              onClick={() => setScope('sigungu')}
              className={clsx(
                'px-3 py-1.5 rounded-md border text-sm',
                scope === 'sigungu'
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'bg-white text-ink-1 border-slate-300',
              )}
            >
              시·군·구 단위
            </button>
          </div>
        </div>

        {/* 시도/시군구/키워드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {scope !== 'nationwide' && (
            <div>
              <div className="text-xs font-semibold text-ink-2 mb-1">시도</div>
              <select
                value={sido}
                onChange={(e) => setSido(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white"
              >
                <option value="">— 선택 —</option>
                {sidos.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          {scope === 'sigungu' && (
            <div>
              <div className="text-xs font-semibold text-ink-2 mb-1">시군구</div>
              <select
                value={sigungu}
                onChange={(e) => setSigungu(e.target.value)}
                disabled={!sido}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white disabled:bg-slate-100"
              >
                <option value="">— 선택 —</option>
                {sigungus.map((s) => (
                  <option key={s || '_'} value={s}>{s || '(세종시)'}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-ink-2 mb-1">키워드</div>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="예: 흥신소, 심부름센터, 선불폰"
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
            />
          </div>
        </div>

        {/* 고급 옵션 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-200">
          <div>
            <div className="text-xs text-ink-2 mb-1">동시성</div>
            <input
              type="number" min={1} max={8} value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(8, +e.target.value || 5)))}
              className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm"
            />
          </div>
          <div>
            <div className="text-xs text-ink-2 mb-1">호출 간격(ms)</div>
            <input
              type="number" min={200} max={3000} step={100} value={paceMs}
              onChange={(e) => setPaceMs(Math.max(200, Math.min(3000, +e.target.value || 400)))}
              className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-sm"
            />
          </div>
          {scanMode === 'precise' && (
            <div className="col-span-2">
              <div className="text-xs text-ink-2 mb-1">대상 동/리 수</div>
              <div className="px-2 py-1.5 text-sm font-semibold">
                {dongCount}개 (예상 {Math.max(5, Math.ceil((dongCount / Math.max(1, concurrency)) * (paceMs / 1000 + 0.5)) + 5)}초)
              </div>
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 pt-2">
          {scanMode === 'fast' ? (
            <button
              type="button"
              onClick={startFast}
              disabled={fastLoading}
              className="px-5 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"
            >
              <SearchIcon size={16} />
              {fastLoading ? '분석 중…' : 'Fast 분석 시작'}
            </button>
          ) : (
            <button
              type="button"
              onClick={startPrecise}
              disabled={starting || isPreciseRunning}
              className="px-5 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"
            >
              <Crosshair size={16} />
              {starting ? '시작 중…' : isPreciseRunning ? '진행 중…' : 'Precise 분석 시작'}
            </button>
          )}
        </div>

        {errMsg && (
          <div className="px-3 py-2 rounded-md bg-red-50 text-red-700 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{errMsg}</span>
          </div>
        )}
      </Card>

      {/* Precise 진행 표시 */}
      {scanMode === 'precise' && job && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-semibold">진행 상태:</span>{' '}
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-full text-xs font-bold',
                  job.status === 'running' ? 'bg-blue-100 text-blue-700'
                    : job.status === 'done' ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700',
                )}
              >
                {job.status}
              </span>
              {' '}
              <span className="text-ink-2">
                {job.done} / {job.total} ({Math.round(job.progress * 100)}%)
              </span>
              {job.status === 'running' && (
                <span className="text-ink-2"> · 예상 {estSec}초</span>
              )}
            </div>
          </div>
          <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-blue-500 transition-all"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
        </Card>
      )}

      {/* 결과 KPI + 등급 분포 */}
      {result && rows.length > 0 && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-base font-bold flex items-center gap-2">
              <span className="text-blue-600">{result.keyword}</span>
              <span className="text-ink-2 text-sm font-normal">
                {scanMode === 'fast'
                  ? `· Fast (${(fastResult?.elapsed_ms || 0) / 1000}초)`
                  : `· Precise (${job?.total}개 동/리)`}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportSummary}
                className="px-4 py-2 rounded-lg border-2 border-emerald-600 text-sm font-bold flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700 shadow-sm transition"
              >
                <Download size={16} /> 요약 Excel
              </button>
              <button
                type="button"
                onClick={exportDetail}
                className="px-4 py-2 rounded-lg border-2 border-blue-600 text-sm font-bold flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-700 shadow-sm transition"
              >
                <Download size={16} /> 상세 Excel
              </button>
            </div>
          </div>

          {/* 등급 분포 카드 */}
          {dist && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {GRADE_ORDER.map((g) => {
                const n = (dist as any)[g] as number
                return (
                  <div
                    key={g}
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 flex items-center gap-2"
                  >
                    <span className={clsx('inline-block w-3 h-3 rounded-full', GRADE_DOT[g])} />
                    <div className="flex-1">
                      <div className="text-[11px] text-ink-2">
                        {GRADE_LABEL_KO[g]} ({GRADE_RANGE[g]})
                      </div>
                      <div className="text-base font-bold">{n}<span className="text-xs text-ink-2 font-normal"> 동</span></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Totals */}
          {totals && (
            <div className="text-xs text-ink-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>분석 동: <b className="text-ink-1">{totals.dong_count}</b></span>
              <span>총 업체: <b className="text-ink-1">{totals.place_count}</b></span>
              <span>타지역 합계: <b className="text-orange-600">{totals.other_count}</b></span>
              <span>메인 합계: <b className="text-emerald-600">{totals.main_count}</b></span>
              {scanMode === 'fast' && fastResult && (
                <span>네이버 totalCount(최대): <b>{fastResult.naver_total_max.toLocaleString()}</b></span>
              )}
            </div>
          )}

          {/* 필터 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-2">타지역수 ≥</span>
            <input
              type="number" min={0} max={50} step={1} value={minOther}
              onChange={(e) => setMinOther(Math.max(0, +e.target.value || 0))}
              className="w-20 px-2 py-1 rounded-md border border-slate-300 text-sm"
            />
            <span className="text-ink-2">개만 표시 ({filteredRows.length} / {rows.length})</span>
          </div>
        </Card>
      )}

      {/* 동별 결과 테이블 */}
      {result && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold">
            동별 경쟁도 (타지역수 내림차순)
          </div>
          <div className="overflow-auto max-h-[700px]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-xs text-ink-2">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">시도</th>
                  <th className="px-3 py-2 font-semibold">시군구</th>
                  <th className="px-3 py-2 font-semibold">동/리</th>
                  <th className="px-3 py-2 font-semibold text-right">타지역</th>
                  <th className="px-3 py-2 font-semibold text-right">메인</th>
                  <th className="px-3 py-2 font-semibold text-right">총</th>
                  <th className="px-3 py-2 font-semibold">등급</th>
                  <th className="px-3 py-2 font-semibold">분포</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => {
                  const total = Math.max(1, r.total)
                  const otherPct = (r.other / total) * 100
                  return (
                    <tr
                      key={r.key}
                      onClick={() => r.items.length > 0 && setDetail(r)}
                      className={clsx(
                        'border-t border-slate-100 hover:bg-blue-50/40',
                        r.items.length > 0 ? 'cursor-pointer' : 'cursor-default',
                      )}
                    >
                      <td className="px-3 py-2 text-xs text-ink-2">{i + 1}</td>
                      <td className="px-3 py-2 text-xs">{r.sido}</td>
                      <td className="px-3 py-2 text-xs">{r.sigungu}</td>
                      <td className="px-3 py-2">
                        <span className="text-blue-700 font-semibold underline-offset-2 hover:underline">
                          {r.dong}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-orange-600">{r.other}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{r.main}</td>
                      <td className="px-3 py-2 text-right text-ink-2">{r.total}</td>
                      <td className="px-3 py-2">
                        <GradePill g={r.grade} />
                      </td>
                      <td className="px-3 py-2 w-32">
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                          <div
                            className={clsx('h-2', GRADE_BAR[r.grade])}
                            style={{ width: `${otherPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-ink-2 text-sm">
                      조건에 맞는 동/리가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 결과 없음 안내 */}
      {!result && !fastLoading && !starting && !job && (
        <Card className="p-8 text-center text-sm text-ink-2">
          모드와 검색 범위를 선택한 뒤, 키워드를 입력하고 “분석 시작” 버튼을 눌러주세요.
          <br />
          예시: <b>흥신소</b> · 서울특별시 · 시·군·구 단위 · 강남구 → Fast 모드 ≈ 1초.
        </Card>
      )}

      {/* 모달: 동 상세 */}
      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// 동 상세 모달
// ─────────────────────────────────────────────────────────
function DetailModal({ row, onClose }: { row: CompetitionRow; onClose: () => void }) {
  // 타지역 먼저, 그 다음 메인 — 사용자 요청 “순위별 리스트”
  const sorted = useMemo(() => {
    const arr = [...row.items]
    arr.sort((a, b) => {
      if (a.is_other_region !== b.is_other_region) return a.is_other_region ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return arr
  }, [row])

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-2">{row.sido}</span>
            <span className="text-ink-2">·</span>
            <span className="text-sm text-ink-2">{row.sigungu}</span>
            <span className="text-ink-2">·</span>
            <span className="text-base font-bold text-blue-700">{row.dong}</span>
            <GradePill g={row.grade} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100"
            aria-label="close"
          >
            <X size={18} />
          </button>
        </div>

        {/* 요약 */}
        <div className="px-5 py-2 text-xs text-ink-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100">
          <span>총 <b className="text-ink-1">{row.total}</b></span>
          <span>메인 <b className="text-emerald-600">{row.main}</b></span>
          <span>타지역 <b className="text-orange-600">{row.other}</b></span>
        </div>

        {/* 테이블 */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr className="text-left text-xs text-ink-2">
                <th className="px-3 py-2 font-semibold">순위</th>
                <th className="px-3 py-2 font-semibold">분류</th>
                <th className="px-3 py-2 font-semibold">카테고리</th>
                <th className="px-3 py-2 font-semibold">전화번호</th>
                <th className="px-3 py-2 font-semibold">상호</th>
                <th className="px-3 py-2 font-semibold">주소</th>
                <th className="px-3 py-2 font-semibold">플레이스</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it, idx) => (
                <PlaceRow key={`${it.place_id || it.name}-${idx}`} it={it} rank={idx + 1} />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-2 text-sm">
                    업체가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function PlaceRow({ it, rank }: { it: CompetitionPlace; rank: number }) {
  const placeUrl = it.place_id ? `https://m.place.naver.com/place/${it.place_id}/home` : ''
  const phone = it.phone || it.virtual_phone || '-'
  const addr = it.road_address || it.address || '-'
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
      <td className="px-3 py-2 text-xs text-ink-2">{rank}</td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap',
            it.is_other_region
              ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-200'
              : 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
          )}
        >
          {it.is_other_region ? '타지역' : '메인'}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">{it.category || '-'}</td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">{phone}</td>
      <td className="px-3 py-2 font-medium">{it.name}</td>
      <td className="px-3 py-2 text-xs text-ink-2">{addr}</td>
      <td className="px-3 py-2">
        {placeUrl ? (
          <a
            href={placeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
          >
            열기 <ExternalLink size={11} />
          </a>
        ) : (
          <span className="text-xs text-ink-2">-</span>
        )}
      </td>
    </tr>
  )
}
