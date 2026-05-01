/**
 * Tab 3: 토큰 동시출현 네트워크 그래프 (SVG force-directed 레이아웃)
 *
 * 단순 simulated annealing — Fruchterman-Reingold 스프링 모델을 React 내부에서 구현.
 * 외부 d3/react-flow 의존성 없이 순수 SVG로 렌더링.
 */
import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Network,
  Loader2,
  AlertTriangle,
  Sparkles,
  Download,
  RefreshCw,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import {
  KeywordDnaApi,
  type GraphResult,
  type GraphNode,
  type DnaCategory,
} from '@/api/keywordDna'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import {
  CAT_LABEL,
  CAT_FILL,
  SAMPLE_KEYWORDS,
  todayKstDate,
  safeFilename,
  fmtNum,
} from './shared'

// 스프링 시뮬레이션 파라미터
const W = 720
const H = 520
const ITERATIONS = 240
const REPULSION = 9000
const SPRING_LEN = 90
const SPRING_K = 0.04
const CENTER_ATTR = 0.012
const DAMPING = 0.85

interface Pos {
  x: number
  y: number
  vx: number
  vy: number
}

function simulate(
  nodes: GraphNode[],
  edges: { source: string; target: string; weight: number }[],
  centerId: string,
): Map<string, Pos> {
  const pos = new Map<string, Pos>()
  // 초기 배치 — 중심 노드는 중앙, 나머지는 원형
  const others = nodes.filter((n) => n.id !== centerId)
  pos.set(centerId, { x: W / 2, y: H / 2, vx: 0, vy: 0 })
  const r = Math.min(W, H) * 0.35
  for (let i = 0; i < others.length; i++) {
    const a = (2 * Math.PI * i) / Math.max(1, others.length)
    pos.set(others[i].id, {
      x: W / 2 + r * Math.cos(a),
      y: H / 2 + r * Math.sin(a),
      vx: 0,
      vy: 0,
    })
  }

  // 정규화된 엣지 가중치
  const maxW = Math.max(1, ...edges.map((e) => e.weight))
  const eList = edges.map((e) => ({
    s: e.source,
    t: e.target,
    w: e.weight / maxW,
  }))

  for (let it = 0; it < ITERATIONS; it++) {
    // 반발력 (모든 노드 쌍)
    const ids = Array.from(pos.keys())
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!
        const b = pos.get(ids[j])!
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const f = REPULSION / (dist * dist)
        const fx = (dx / dist) * f
        const fy = (dy / dist) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    // 스프링 인력 (엣지)
    for (const e of eList) {
      const a = pos.get(e.s)
      const b = pos.get(e.t)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const target = SPRING_LEN / (0.5 + e.w)
      const f = SPRING_K * (dist - target) * (0.5 + e.w)
      const fx = (dx / dist) * f
      const fy = (dy / dist) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
    // 중앙 인력
    for (const id of ids) {
      const p = pos.get(id)!
      p.vx += (W / 2 - p.x) * CENTER_ATTR
      p.vy += (H / 2 - p.y) * CENTER_ATTR
    }
    // 중심 노드 고정
    const c = pos.get(centerId)
    if (c) {
      c.vx = 0
      c.vy = 0
      c.x = W / 2
      c.y = H / 2
    }
    // 위치 갱신
    for (const id of ids) {
      const p = pos.get(id)!
      p.vx *= DAMPING
      p.vy *= DAMPING
      p.x += p.vx
      p.y += p.vy
      p.x = Math.max(20, Math.min(W - 20, p.x))
      p.y = Math.max(20, Math.min(H - 20, p.y))
    }
  }
  return pos
}

export default function GraphTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const openLoginModal = useAuthStore((s) => s.openLoginModal)

  const [keyword, setKeyword] = useState('하수구')
  const [maxNodes, setMaxNodes] = useState(30)
  const [result, setResult] = useState<GraphResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [seed, setSeed] = useState(0) // 재배치 트리거
  const svgRef = useRef<SVGSVGElement>(null)

  const submit = async (kw?: string) => {
    if (!isAuthenticated) {
      openLoginModal()
      return
    }
    const target = (kw ?? keyword).trim()
    if (!target) {
      setErrMsg('키워드를 입력하세요.')
      return
    }
    setKeyword(target)
    setLoading(true)
    setErrMsg(null)
    try {
      const r = await KeywordDnaApi.graph(target, { max_nodes: maxNodes, min_edge_weight: 1.0 })
      setResult(r)
      setSeed((s) => s + 1)
      if (r.stats.matched === 0) {
        setErrMsg(`'${target}'을(를) 포함하는 등록 상호가 없습니다.`)
      }
    } catch (e: any) {
      setErrMsg(e instanceof ApiError ? e.message : (e?.message || '그래프 생성 실패'))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  // 시뮬레이션 실행 (메모이즈 — seed/result 변경 시 재계산)
  const positions = useMemo(() => {
    if (!result || result.nodes.length === 0) return null
    return simulate(result.nodes, result.edges, result.normalized)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, seed])

  const downloadExcel = () => {
    if (!result) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.nodes.map((n) => ({
          토큰: n.id,
          카테고리: CAT_LABEL[n.category],
          중심노드: n.is_center ? 'Y' : '',
          출현_상호수: n.df,
          가중치: Math.round(n.weight),
        })),
      ),
      '노드',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.edges.map((e) => ({
          토큰1: e.source,
          토큰2: e.target,
          동시출현_상호수: e.df,
          가중치: Math.round(e.weight),
        })),
      ),
      '엣지',
    )
    XLSX.writeFile(
      wb,
      `타지역_네트워크_${safeFilename(result.normalized)}_${todayKstDate()}.xlsx`,
    )
  }

  const downloadSvg = () => {
    if (!svgRef.current) return
    const serializer = new XMLSerializer()
    const blob = new Blob([serializer.serializeToString(svgRef.current)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `타지역_네트워크_${safeFilename(result?.normalized || '')}_${todayKstDate()}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <Card variant="white" className="p-5">
        <div className="flex items-start gap-2 mb-3">
          <Network className="text-blue-600 mt-0.5" size={20} />
          <div>
            <div className="text-base font-bold text-slate-800">동시출현 네트워크 그래프</div>
            <div className="text-xs text-slate-500">
              키워드를 포함하는 상호의 토큰을 노드로, 같은 상호에서 함께 등장한 토큰 쌍을 엣지로 시각화합니다.
              노드 크기 = 회선수 가중치 / 엣지 굵기 = 동시출현 강도.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-stretch">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="중심 키워드"
            className="flex-1 min-w-[220px] px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={30}
          />
          <button
            onClick={() => submit()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 rounded-lg shadow-sm"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" />생성 중...</> : <><Sparkles size={16} />그래프 생성</>}
          </button>
          <select
            value={maxNodes}
            onChange={(e) => setMaxNodes(Number(e.target.value))}
            className="px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value={20}>노드 20개</option>
            <option value={30}>노드 30개</option>
            <option value={50}>노드 50개</option>
            <option value={80}>노드 80개</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-500 self-center mr-1">빠른 시작:</span>
          {SAMPLE_KEYWORDS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="px-2.5 py-1 text-xs rounded-full bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-700 ring-1 ring-slate-200"
            >
              {s}
            </button>
          ))}
        </div>

        {errMsg && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800">{errMsg}</div>
          </div>
        )}
      </Card>

      {result && positions && result.nodes.length > 0 && (
        <Card variant="white" className="p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex flex-wrap gap-4">
              <div>
                <div className="text-[11px] text-slate-500">중심 키워드</div>
                <div className="text-base font-bold text-blue-700">{result.normalized}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">매칭 상호</div>
                <div className="text-base font-bold text-slate-800">{fmtNum(result.stats.matched)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">노드</div>
                <div className="text-base font-bold text-slate-800">{result.stats.node_count}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">엣지</div>
                <div className="text-base font-bold text-slate-800">{result.stats.edge_count}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">생성 시간</div>
                <div className="text-base font-bold text-slate-800">{result.stats.elapsed_ms}<span className="text-xs text-slate-500 ml-0.5">ms</span></div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSeed((s) => s + 1)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs bg-slate-100 hover:bg-blue-100 rounded-lg border border-slate-300"
              >
                <RefreshCw size={14} />재배치
              </button>
              <button
                onClick={downloadSvg}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg border-2 border-emerald-700 shadow-sm"
              >
                <Download size={14} />SVG
              </button>
              <button
                onClick={downloadExcel}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg border-2 border-blue-700 shadow-sm"
              >
                <Download size={14} />Excel
              </button>
            </div>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-3 mb-2 text-[11px]">
            {(Object.keys(CAT_FILL) as DnaCategory[]).map((c) => (
              <span key={c} className="inline-flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: CAT_FILL[c] }} />
                <span className="text-slate-600">{CAT_LABEL[c]}</span>
              </span>
            ))}
          </div>

          {/* SVG 캔버스 */}
          <div className="relative bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height={H}
              style={{ maxHeight: H }}
            >
              {/* 엣지 */}
              {result.edges.map((e, i) => {
                const a = positions.get(e.source)
                const b = positions.get(e.target)
                if (!a || !b) return null
                const maxEW = Math.max(1, ...result.edges.map((x) => x.weight))
                const ratio = e.weight / maxEW
                const stroke = 0.5 + ratio * 3.5
                const opacity = 0.15 + ratio * 0.5
                const isHi = hover && (e.source === hover || e.target === hover)
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={isHi ? '#2563eb' : '#94a3b8'}
                    strokeWidth={isHi ? stroke + 1 : stroke}
                    strokeOpacity={isHi ? 0.85 : opacity}
                  />
                )
              })}
              {/* 노드 */}
              {result.nodes.map((n) => {
                const p = positions.get(n.id)
                if (!p) return null
                const isHi = hover === n.id
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x}, ${p.y})`}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={n.size}
                      fill={CAT_FILL[n.category]}
                      stroke={n.is_center ? '#0f172a' : '#fff'}
                      strokeWidth={n.is_center ? 3 : 1.5}
                      opacity={isHi ? 1 : 0.88}
                    />
                    <text
                      textAnchor="middle"
                      dy={n.size + 12}
                      fontSize={n.is_center ? 13 : 11}
                      fontWeight={n.is_center ? 700 : 600}
                      fill="#0f172a"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {n.id}
                    </text>
                  </g>
                )
              })}
            </svg>

            {/* 호버 정보 */}
            {hover && (
              <div className="absolute top-2 left-2 bg-white px-3 py-1.5 rounded shadow border border-slate-200 text-xs">
                {(() => {
                  const n = result.nodes.find((x) => x.id === hover)
                  if (!n) return null
                  return (
                    <>
                      <div className="font-bold text-slate-800">{n.id}</div>
                      <div className="text-slate-500">
                        {CAT_LABEL[n.category]} · {n.df}건 · 가중치 {fmtNum(n.weight)}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          {/* 상위 엣지 테이블 */}
          <div className="mt-4">
            <div className="text-sm font-bold text-slate-800 mb-2">🔗 상위 동시출현 토큰 쌍</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-2 py-1.5 w-10 text-right">#</th>
                    <th className="px-2 py-1.5">토큰 A</th>
                    <th className="px-2 py-1.5">토큰 B</th>
                    <th className="px-2 py-1.5 text-right w-24">동시출현</th>
                    <th className="px-2 py-1.5 text-right w-28">가중치</th>
                  </tr>
                </thead>
                <tbody>
                  {result.edges.slice(0, 20).map((e, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-blue-50/40">
                      <td className="px-2 py-1 text-right tabular-nums text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1 font-bold text-slate-800">{e.source}</td>
                      <td className="px-2 py-1 font-bold text-slate-800">{e.target}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{e.df}건</td>
                      <td className="px-2 py-1 text-right tabular-nums text-emerald-700 font-bold">{fmtNum(e.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
