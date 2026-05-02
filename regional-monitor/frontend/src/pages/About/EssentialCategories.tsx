/**
 * 타지역 필수업종
 * - 타지역서비스가 필수/유효한 업종 리스트와 회선수(시장규모) 시각화
 * - 데이터 소스: /api/v1/keyword-dna/health 의 dictionary 통계
 */
import { useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  Briefcase,
  TrendingUp,
  AlertCircle,
  Search,
  MapPin,
  Phone,
  Truck,
  Wrench,
  Hammer,
  PackageCheck,
  MessageSquare,
  Recycle,
  XCircle,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
  Zap,
  Megaphone,
  Sparkles,
  Target,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KeywordDnaApi } from '@/api/keywordDna'

interface CategoryRow {
  category: string
  count: number
}

// 필수업종 시드 (출장/긴급출동형 서비스)
const ESSENTIAL_HINTS = [
  '하수구', '누수', '열쇠', '보일러', '이사', '이삿짐', '청소', '폐기물',
  '심부름', '흥신소', '에어컨', '배관', '수도', '도어', '유품정리',
  '특수청소', '철거', '용달', '퀵', '고소', '사다리', '크레인', '스카이',
  '자동문', '셔터', '샤시', '창호', '유리', '거울', 'CCTV', '전기공사',
  '운전대행', '꽃집', '꽃배달', '중고차', '컴퓨터수리', '누수탐지',
]

function isEssential(name: string): boolean {
  return ESSENTIAL_HINTS.some((h) => name.includes(h))
}

export default function EssentialCategories() {
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    KeywordDnaApi.categories()
      .then((res) => {
        if (!mounted) return
        setRows(res?.categories ?? [])
      })
      .catch((err: any) => {
        if (!mounted) return
        setErrMsg(err?.message || '카테고리 정보를 불러오지 못했습니다.')
      })
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [])

  const filtered = rows
    .filter((r) => isEssential(r.category))
    .sort((a, b) => b.count - a.count)

  const totalWeight = filtered.reduce((s, r) => s + r.count, 0)
  const maxCount = filtered[0]?.count ?? 1

  return (
    <div className="space-y-12">
      <TopBar
        title="타지역 필수업종"
        subtitle="타지역서비스 운영이 필수/유효한 업종 리스트 (회선수 기준 시장규모 정렬)"
      />

      {/* ════════════════════════════════════════════════════════════════
          NEW SECTION: 타지역서비스 최적 업종은? (도식·인포그래픽)
          ════════════════════════════════════════════════════════════════ */}

      {/* ───── 1) HERO ───── */}
      <Card variant="white" className="relative overflow-hidden bg-gradient-to-br from-brand-50/60 via-white to-indigo-50/40 border border-brand-100">
        <div className="absolute top-5 left-6 text-[40px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          BEST <br /> FIT?
        </div>
        <div className="pt-24 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-bold mb-3">
            <Briefcase size={14} /> 타지역서비스 최적 업종
          </span>
          <h2 className="text-hero-sm text-ink mb-4 leading-tight">
            타지역서비스 <span className="text-brand-600">최적 업종</span>은?
          </h2>
          <p className="text-2xl text-ink leading-snug font-bold mb-2">
            "사무실로 고객이 오는 업종"보다<br />
            <span className="text-brand-700">"고객이 있는 곳으로 찾아가는 업종"</span>이 더 강합니다.
          </p>
          <p className="text-lg text-ink-muted leading-relaxed mt-4">
            타지역서비스는 모든 업종에 똑같이 맞는 마케팅이 아닙니다.<br />
            하지만 어떤 업종에는 <strong className="text-ink">정말 강력하게 작동</strong>합니다.
          </p>
        </div>
      </Card>

      {/* ───── 2) 5대 핵심 업종 카드 ───── */}
      <section>
        <div className="text-center mb-5">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-3">
            <Zap size={14} /> POWER FIT
          </span>
          <h3 className="text-h2 text-ink leading-tight">
            바로 <span className="text-brand-700">출장·방문·공사·수리·상담</span> 업종입니다
          </h3>
          <p className="text-lg text-ink-muted mt-3 leading-relaxed">
            고객이 매장에 방문하는 구조가 아니라,<br />
            사장님이 <strong className="text-ink">고객이 있는 지역으로 이동</strong>해 서비스를 제공하는 구조이기 때문입니다.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
          {[
            { icon: <Truck size={26} />, label: '출장', tone: 'from-brand-500 to-indigo-500' },
            { icon: <MapPin size={26} />, label: '방문', tone: 'from-amber-500 to-orange-500' },
            { icon: <Hammer size={26} />, label: '공사', tone: 'from-rose-500 to-pink-500' },
            { icon: <Wrench size={26} />, label: '수리', tone: 'from-emerald-500 to-teal-500' },
            { icon: <MessageSquare size={26} />, label: '상담', tone: 'from-indigo-500 to-purple-500' },
          ].map((c) => (
            <Card key={c.label} variant="white" className="text-center hover:shadow-card transition-shadow">
              <div className={`w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br ${c.tone} text-white flex items-center justify-center mb-3 shadow-card`}>
                {c.icon}
              </div>
              <div className="text-xl font-bold text-ink">{c.label}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* ───── 3) 고객 검색 행동 ───── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">customer search</div>
          <h3 className="text-h2 text-ink">고객은 이렇게 검색합니다</h3>
        </div>

        <Card variant="white" className="bg-gradient-to-br from-amber-50/50 to-white border border-amber-100">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              '우리 동네 에어컨 청소',
              '근처 보일러 수리',
              '부천 누수 탐지',
              '인천 방문 설치',
              '송파 출장 수리',
              '수원 폐기물 수거',
            ].map((q) => (
              <div key={q} className="flex items-center gap-2.5 px-4 py-3.5 rounded-card bg-white border border-amber-200/70 hover:border-amber-400 transition-colors">
                <Search size={20} className="text-amber-500 shrink-0" />
                <span className="text-lg text-ink font-semibold">{q}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* 결과 박스 */}
        <Card variant="white" className="mt-5 bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border border-rose-200">
          <div className="flex items-start gap-3">
            <AlertTriangle size={28} className="text-rose-600 shrink-0 mt-1" />
            <div>
              <p className="text-xl text-ink leading-relaxed mb-2">
                그런데 사장님의 업체가 그 지역 네이버플레이스에 <strong className="text-rose-700">보이지 않는다면?</strong>
              </p>
              <p className="text-lg text-ink-muted leading-relaxed">
                고객은 기다리지 않습니다.<br />
                <strong className="text-rose-700">그냥 검색 결과에 보이는 다른 업체에 전화합니다.</strong>
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* ───── 4) 갈 수 있는데 vs 못 찾고 있다 (양쪽 비교) ───── */}
      <section>
        <div className="text-center mb-6">
          <h3 className="text-h2 text-ink leading-snug">
            사장님은 <span className="text-emerald-700">갈 수 있는데</span>,<br />
            고객은 <span className="text-rose-700">사장님을 못 찾고 있습니다.</span>
          </h3>
          <p className="text-lg text-ink-muted mt-3">이게 가장 큰 문제입니다.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 좌: 갈 수 있다 */}
          <Card variant="white" className="border border-emerald-200">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold">
                ✅ 사장님은 실제로 가능합니다
              </span>
            </div>
            <div className="space-y-2.5">
              {['그 지역에 갈 수 있습니다', '상담도 가능합니다', '설치도 가능합니다', '수리도 가능합니다', '견적도 가능합니다'].map((t) => (
                <div key={t} className="flex items-center gap-2.5 px-4 py-3 rounded-card bg-emerald-50/60 border border-emerald-100">
                  <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                  <span className="text-lg text-ink font-medium">{t}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 우: 그러나 노출은 안 됨 */}
          <Card variant="white" className="border border-rose-200">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-body-sm font-bold">
                🚫 그런데 네이버는…
              </span>
            </div>
            <div className="bg-rose-50/40 rounded-card border border-rose-100 px-5 py-6 text-center mb-4">
              <MapPin size={42} className="text-rose-500 mx-auto mb-3" />
              <p className="text-lg text-ink leading-relaxed">
                네이버 지도에는<br />
                <strong className="text-rose-700">사무실 주소지 근처에서만 노출</strong>
              </p>
            </div>
            <p className="text-lg text-ink-muted leading-relaxed">
              실제 영업 가능 지역의 고객을<br />
              <strong className="text-rose-700">조용히 놓치고 있는 것</strong>입니다.
            </p>
          </Card>
        </div>

        {/* 결론 */}
        <Card variant="white" className="mt-5 bg-brand-600 text-white text-center">
          <p className="text-2xl leading-snug font-bold">
            타지역서비스는 <span className="text-amber-200">이 문제를 해결합니다.</span>
          </p>
          <p className="text-lg text-white/90 leading-relaxed mt-3">
            고객이 있는 지역에 우리 업체를 보이게 만드는 것.<br />
            <strong className="text-white">그것이 타지역서비스의 핵심입니다.</strong>
          </p>
        </Card>
      </section>

      {/* ───── 5) 적합 업종 표 ───── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">industry fit</div>
          <h3 className="text-h2 text-ink">출장·방문·공사·수리·상담 업종에 강합니다</h3>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">타지역서비스는 특히 이런 업종에 적합합니다.</p>
        </div>

        <div className="space-y-3">
          {[
            { icon: <Truck size={22} />, type: '출장·방문 서비스', examples: '출장수리, 방문설치, 에어컨청소, 보일러수리', tone: { bg: 'bg-brand-50', text: 'text-brand-700', accent: 'from-brand-500 to-indigo-500' } },
            { icon: <Hammer size={22} />, type: '공사·수리 업종', examples: '누수탐지, 인테리어, 철거, 방수, 전기공사', tone: { bg: 'bg-amber-50', text: 'text-amber-700', accent: 'from-amber-500 to-orange-500' } },
            { icon: <PackageCheck size={22} />, type: '배달·렌탈 업종', examples: '배달서비스, 렌탈, 장비대여, 생활서비스', tone: { bg: 'bg-emerald-50', text: 'text-emerald-700', accent: 'from-emerald-500 to-teal-500' } },
            { icon: <MessageSquare size={22} />, type: '상담 업종', examples: '보험상담, 법률상담, 기업상담, 방문견적', tone: { bg: 'bg-indigo-50', text: 'text-indigo-700', accent: 'from-indigo-500 to-purple-500' } },
            { icon: <Recycle size={22} />, type: '중고·매입 업종', examples: '중고매입, 폐기물, 고물, 재활용 수거', tone: { bg: 'bg-rose-50', text: 'text-rose-700', accent: 'from-rose-500 to-pink-500' } },
          ].map((row) => (
            <Card key={row.type} variant="white" className="hover:shadow-card transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${row.tone.accent} text-white flex items-center justify-center shrink-0 shadow-card`}>
                  {row.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-lg font-bold ${row.tone.text} mb-1`}>{row.type}</div>
                  <div className="text-base text-ink-muted leading-relaxed">{row.examples}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* 공통점 요약 박스 */}
        <Card variant="white" className="mt-5 bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200 text-center">
          <p className="text-lg text-ink-muted leading-relaxed mb-2">공통점은 하나입니다.</p>
          <p className="text-2xl text-brand-700 font-bold leading-snug">
            "고객이 있는 곳으로 갈 수 있는 업종"
          </p>
          <p className="text-lg text-ink leading-relaxed mt-3">
            고객이 있는 곳으로 갈 수 있다면,<br />
            <strong className="text-brand-700">고객이 검색하는 지역에도 보여야 합니다.</strong>
          </p>
        </Card>
      </section>

      {/* ───── 6) 도미노 — 보이지 않으면 ───── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-body-sm font-bold mb-3">
            <AlertTriangle size={14} /> 보이지 않으면 일어나는 일
          </span>
          <h3 className="text-h2 text-ink leading-tight">보이지 않으면 매출이 사라집니다</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { from: '보이지 않으면', to: '문의가 없습니다', icon: <Search size={22} />, tone: 'rose' },
            { from: '문의가 없으면', to: '상담도 없습니다', icon: <Phone size={22} />, tone: 'rose' },
            { from: '상담이 없으면', to: '매출도 없습니다', icon: <XCircle size={22} />, tone: 'rose' },
          ].map((d, i) => (
            <Card key={i} variant="white" className="border border-rose-200 bg-rose-50/30 text-center">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-500 text-white flex items-center justify-center mb-3 shadow-card">
                {d.icon}
              </div>
              <div className="text-base text-ink-muted mb-1">{d.from}</div>
              <div className="text-xl font-bold text-rose-700">{d.to}</div>
            </Card>
          ))}
        </div>

        <Card variant="white" className="mt-5 bg-emerald-50 border border-emerald-200">
          <p className="text-lg text-ink leading-relaxed text-center">
            타지역서비스는 고객이 검색하는 지역마다<br />
            <strong className="text-emerald-700">사장님의 업체가 선택지 안에 들어가도록 만드는</strong><br />
            <span className="text-xl text-emerald-700 font-bold">지역 확장형 네이버플레이스 전략</span>입니다.
          </p>
        </Card>
      </section>

      {/* ───── 7) 강한 버전 — "우리도 그 지역 갈 수 있는데…" ───── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-amber-50 via-rose-50/50 to-amber-50 border border-amber-200">
          <div className="max-w-3xl mx-auto py-2">
            <div className="text-center mb-5">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white text-amber-700 text-body-sm font-bold shadow-sm">
                💬 사장님의 진짜 속마음
              </span>
            </div>
            <p className="text-3xl md:text-4xl text-ink font-bold leading-tight text-center mb-4">
              "우리도 그 지역 갈 수 있는데…"
            </p>
            <p className="text-xl text-ink-muted text-center leading-relaxed mb-6">
              그런데 네이버에는 <strong className="text-rose-700">안 보이고 있지 않나요?</strong>
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
              {['출장수리도 가능', '방문설치도 가능', '공사도 가능', '상담도 가능'].map((t) => (
                <div key={t} className="px-3 py-3 rounded-card bg-white border border-amber-200 text-center">
                  <CheckCircle2 size={18} className="text-emerald-500 mx-auto mb-1" />
                  <span className="text-base text-ink font-semibold">{t}</span>
                </div>
              ))}
            </div>

            <p className="text-lg text-ink leading-relaxed text-center mb-5">
              그런데 네이버 지도에서 그 지역 고객에게 보이지 않는다면?
            </p>

            <Card variant="white" className="bg-white border-2 border-rose-300">
              <p className="text-xl text-ink leading-snug text-center font-bold">
                <span className="text-ink-muted line-through">영업력이 부족한 게 아닙니다.</span><br />
                <span className="text-rose-700">노출 구조가 막혀 있는 것입니다.</span>
              </p>
            </Card>
          </div>
        </Card>
      </section>

      {/* ───── 8) 고객 검색 패턴 (강한 버전) ───── */}
      <section>
        <div className="mb-5 text-center">
          <h3 className="text-h2 text-ink leading-tight">
            고객은 사장님 사무실 주소를 <span className="text-rose-700">검색하지 않습니다</span>
          </h3>
          <p className="text-lg text-ink-muted mt-3 leading-relaxed">
            고객은 <strong className="text-ink">자기 지역명 + 필요한 서비스</strong>를 함께 검색합니다.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { region: '강남', service: '누수탐지' },
            { region: '부천', service: '에어컨청소' },
            { region: '인천', service: '보일러수리' },
            { region: '수원', service: '폐기물수거' },
          ].map((q) => (
            <Card key={q.region} variant="white" className="border border-brand-200 bg-gradient-to-br from-brand-50/50 to-white">
              <div className="flex items-center gap-2 mb-2">
                <Search size={18} className="text-brand-500" />
                <span className="text-body-sm text-brand-700 font-bold uppercase tracking-wider">검색</span>
              </div>
              <div className="text-2xl font-bold text-ink leading-tight">
                <span className="text-brand-600">{q.region}</span> {q.service}
              </div>
            </Card>
          ))}
        </div>

        {/* 매출 흐름 도식 */}
        <Card variant="white" className="bg-gradient-to-r from-brand-50 via-amber-50 to-emerald-50 border border-brand-100">
          <p className="text-lg text-ink-muted text-center mb-4">그 순간 일어나는 일</p>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <FlowStep tone="brand" title="보이는 업체가" highlight="전화를 받고" />
            <FlowArrow />
            <FlowStep tone="amber" title="전화 받는 업체가" highlight="상담을 만들고" />
            <FlowArrow />
            <FlowStep tone="emerald" title="상담하는 업체가" highlight="매출을 가져갑니다" />
          </div>
        </Card>
      </section>

      {/* ───── 9) 마무리 — 짧은 후킹 ───── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto py-6 text-center">
            <Megaphone size={36} className="mx-auto mb-4 text-white/90" />
            <p className="text-3xl md:text-4xl text-white font-bold leading-tight mb-5">
              갈 수 있는 지역이라면,<br />
              <span className="text-amber-200">보여야 매출이 됩니다.</span>
            </p>
            <p className="text-lg text-white/90 leading-relaxed mb-6">
              출장·방문·공사·수리·상담 업종은<br />
              <strong className="text-white">고객이 찾아오는 업종이 아니라</strong><br />
              <strong className="text-amber-200">사장님이 고객에게 가는 업종</strong>입니다.
            </p>
            <div className="rounded-card bg-white/10 backdrop-blur-sm px-5 py-5 border border-white/20 mb-5">
              <p className="text-xl text-white leading-relaxed">
                그렇다면 네이버에서도<br />
                <strong className="text-amber-200">고객이 있는 지역에 보여야 합니다.</strong>
              </p>
            </div>
            <p className="text-lg text-white/90 leading-relaxed">
              타지역서비스는<br />
              <strong className="text-white">고객이 검색하는 지역마다 우리 업체를 노출시켜</strong><br />
              <span className="text-2xl text-amber-200 font-bold mt-2 inline-block">전화문의 기회를 넓히는 전략</span>입니다.
            </p>
          </div>
        </Card>
      </section>

      {/* ════════════════════════════════════════════════════════════════
          이하 기존 통계 (필수업종 회선수 랭킹)
          ════════════════════════════════════════════════════════════════ */}

      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold mb-3">
            <TrendingUp size={14} /> 시장 데이터
          </span>
          <h3 className="text-h2 text-ink">실제 시장 규모로 본 필수업종 랭킹</h3>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            아래는 타지역업종리스트.xlsx 기준 회선수(시장규모) 정렬입니다.
          </p>
        </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card variant="white">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <Briefcase size={14} /> 필수업종 수
          </div>
          <div className="text-h2 font-bold text-ink mt-1">
            {filtered.length.toLocaleString()}
          </div>
        </Card>
        <Card variant="white">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <TrendingUp size={14} /> 합산 회선수
          </div>
          <div className="text-h2 font-bold text-ink mt-1">
            {totalWeight.toLocaleString()}
          </div>
        </Card>
        <Card variant="white" className="hidden md:block">
          <div className="flex items-center gap-2 text-ink-muted text-caption">
            <AlertCircle size={14} /> 데이터 소스
          </div>
          <div className="text-body font-semibold text-ink mt-1">
            타지역업종리스트.xlsx (216개 카테고리)
          </div>
        </Card>
      </div>

      {/* 에러 */}
      {errMsg && (
        <Card variant="white" className="border border-rose-200 bg-rose-50">
          <p className="text-body-sm text-rose-700">{errMsg}</p>
        </Card>
      )}

      {/* 표 */}
      <Card variant="white" className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-bg-subtle flex items-center justify-between">
          <h3 className="text-h3 text-ink">필수업종 회선수 랭킹</h3>
          {loading && <span className="text-caption text-ink-muted">로딩 중…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-bg-subtle">
              <tr className="text-ink-muted text-caption">
                <th className="text-left px-4 py-2 w-12">순위</th>
                <th className="text-left px-4 py-2">업종</th>
                <th className="text-right px-4 py-2 w-32">회선수</th>
                <th className="text-left px-4 py-2 w-1/3">시장규모</th>
                <th className="text-right px-4 py-2 w-20">비중</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const pct = totalWeight > 0 ? (r.count / totalWeight) * 100 : 0
                const barPct = (r.count / maxCount) * 100
                return (
                  <tr key={r.category} className="border-t border-bg-subtle hover:bg-bg-subtle/40">
                    <td className="px-4 py-2 text-ink-muted">{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-ink">{r.category}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.count.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-ink-muted">{pct.toFixed(1)}%</td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    표시할 필수업종이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </section>

      {/* ───── 마지막 CTA 3개 박스 ───── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-2">
            🎁 타지역닷컴 위탁 시 100% 무료
          </span>
          <h2 className="text-h2 text-ink">지금 바로 무료로 시작하세요</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            등록·관리만 맡기시면 4종 솔루션 전부 무료. 사장님이 잃을 게 없습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CtaBox
            num="01"
            title="네이버1페이지 플레이스 영역 노출"
            highlight="골든키워드 발굴 무료 문의하기"
            to="/intro/keyword-discover"
            tone="brand"
            icon={<Sparkles size={22} />}
          />
          <CtaBox
            num="02"
            title="지역별 키워드"
            highlight="경쟁도 무료 분석 신청하기"
            to="/intro/competition"
            tone="teal"
            icon={<Target size={22} />}
          />
          <CtaBox
            num="03"
            title="등록한 타지역서비스"
            highlight="노출 자동체크 무료 플랜 신청하기"
            to="/intro/monitor"
            tone="rose"
            icon={<ShieldCheck size={22} />}
          />
        </div>
      </section>
    </div>
  )
}

/* ════════════════════ 하위 컴포넌트 ════════════════════ */

interface FlowStepProps {
  tone: 'brand' | 'amber' | 'emerald'
  title: string
  highlight: string
}

function FlowStep({ tone, title, highlight }: FlowStepProps) {
  const tc = {
    brand: { bg: 'bg-brand-50', border: 'border-brand-200', text: 'text-brand-700' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  }[tone]
  return (
    <div className={`flex-1 rounded-card border ${tc.border} ${tc.bg} px-4 py-4 text-center`}>
      <div className="text-base text-ink-muted mb-1">{title}</div>
      <div className={`text-xl font-bold ${tc.text}`}>{highlight}</div>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-ink-soft">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowRight size={22} className="md:hidden rotate-90" />
    </div>
  )
}

interface CtaBoxProps {
  num: string
  title: string
  highlight: string
  to: string
  tone: 'brand' | 'teal' | 'rose'
  icon: React.ReactNode
}

function CtaBox({ num, title, highlight, to, tone, icon }: CtaBoxProps) {
  const tc = {
    brand: { accent: 'from-brand-500 to-indigo-500', ring: 'ring-brand-200', text: 'text-brand-700', btn: 'bg-brand-600 hover:bg-brand-700' },
    teal: { accent: 'from-teal-500 to-cyan-500', ring: 'ring-teal-200', text: 'text-teal-700', btn: 'bg-teal-600 hover:bg-teal-700' },
    rose: { accent: 'from-rose-500 to-orange-500', ring: 'ring-rose-200', text: 'text-rose-700', btn: 'bg-rose-600 hover:bg-rose-700' },
  }[tone]
  return (
    <Card variant="white" className={`relative overflow-hidden ring-1 ${tc.ring} flex flex-col`}>
      <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-[11px] font-bold">
        🎁 FREE
      </span>
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center mb-3 shadow-card`}>
        {icon}
      </div>
      <div className={`text-body-sm font-mono ${tc.text} mb-1`}>CTA {num}</div>
      <h3 className="text-h3 text-ink leading-tight mb-1">{title}</h3>
      <p className={`text-lg font-bold ${tc.text} mb-4 leading-tight`}>{highlight}</p>
      <Link
        to={to}
        className={`mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-pill text-white font-bold text-base ${tc.btn} transition-colors`}
      >
        무료 신청하기 <ArrowRight size={16} />
      </Link>
    </Card>
  )
}
