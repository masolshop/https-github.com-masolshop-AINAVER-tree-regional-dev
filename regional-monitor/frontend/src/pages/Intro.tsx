/**
 * 타지역 4종솔루션 소개 — 통합적 관점
 *
 * 페이지 구성:
 *  1) Hero: 4종 통합 메시지
 *  2) 4종 시너지 (퍼널 구조: 발굴 → 분석 → 진입 → 유지)
 *  3) 4개 솔루션 카드 (서브메뉴 진입점)
 *  4) 요금제 (무료 / 유료)
 *  5) FAQ
 *  6) CTA
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  Dna,
  Sparkles,
  MapPin,
  Radio,
  ArrowRight,
  Layers,
  CheckCircle2,
  Gift,
  CreditCard,
  Coins,
  ChevronRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'

interface SolutionLink {
  id: string
  num: string
  to: string
  title: string
  shortLabel: string
  tagline: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  accent: string
}

const SOLUTIONS: SolutionLink[] = [
  {
    id: 'dna',
    num: '01',
    to: '/intro/keyword-dna',
    title: '타지역키워드 DNA 파싱솔루션',
    shortLabel: 'DNA 파싱',
    tagline: '상호명을 6 카테고리 DNA로 분해해 노출 로직을 가시화',
    icon: Dna,
    accent: 'from-brand-500 to-indigo-500',
  },
  {
    id: 'keyword',
    num: '02',
    to: '/intro/keyword-discover',
    title: '네이버1페이지 노출 키워드 발굴솔루션',
    shortLabel: '키워드 발굴',
    tagline: '실제 회선수 기반으로 1페이지 진입 가능한 황금 키워드 발굴',
    icon: Sparkles,
    accent: 'from-amber-500 to-pink-500',
  },
  {
    id: 'competition',
    num: '03',
    to: '/intro/competition',
    title: '지역별 노출경쟁도 분석솔루션',
    shortLabel: '경쟁도 분석',
    tagline: '시군구·동/리 단위 4,819개 영역 정밀 경쟁도 측정',
    icon: MapPin,
    accent: 'from-teal-500 to-cyan-500',
  },
  {
    id: 'monitor',
    num: '04',
    to: '/intro/monitor',
    title: '네이버노출관리 자동체크솔루션',
    shortLabel: '노출관리',
    tagline: '한 번 등록하면 매일 자동 검증 — 노출 사라짐 24시간 내 감지',
    icon: Radio,
    accent: 'from-rose-500 to-orange-500',
  },
]

export default function Intro() {
  return (
    <div className="space-y-10">
      <TopBar
        title="타지역 4종솔루션 소개"
        subtitle="4개 솔루션이 발굴 → 분석 → 진입 → 유지의 전 단계를 책임지는 통합 SaaS입니다."
      />

      {/* ─── 1) Hero ─── */}
      <Card variant="white" className="min-h-[240px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          4 IN ONE <br /> SUITE
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-semibold mb-3">
            <Layers size={12} /> 타지역서비스 통합 운영 플랫폼
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            상호 작명 → 키워드 발굴 → 지역 진입 → 노출 유지<br />
            전 주기를 4개 솔루션이 한 번에.
          </h2>
          <p className="text-body text-ink-muted leading-relaxed">
            타지역서비스는 <strong className="text-ink">단일 작업이 아닌 4단계 운영 프로세스</strong>입니다.
            한 단계라도 빠지면 등록·노출·매출이 새기 시작합니다. 본 SaaS는 4개 솔루션이
            <strong className="text-ink"> 동일한 데이터(1,875 상호 / 216 카테고리 / 회선수 508K / 4,819 동·리)</strong>를
            공유하여 의사결정을 일관성 있게 자동화합니다.
          </p>
        </div>
      </Card>

      {/* ─── 2) 4종 시너지 (퍼널) ─── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            integrated funnel
          </div>
          <h2 className="text-h2 text-ink">4종 통합 워크플로우</h2>
          <p className="text-body-sm text-ink-muted mt-1">
            각 솔루션은 단독으로도 작동하지만, 4개를 함께 사용할 때 데이터가 누적되어
            의사결정 정확도가 비약적으로 상승합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <FunnelStep
            num="STEP 1"
            title="키워드 구조 해부"
            desc="DNA 파싱으로 진출하려는 업종의 토큰 구조 파악. 어떤 카테고리 키워드가 노출의 중심인지 식별."
            tone="brand"
            arrow
          />
          <FunnelStep
            num="STEP 2"
            title="진입 키워드 발굴"
            desc="청정/경쟁 등급 황금 키워드 자동 수집. 기회점수 기반 우선순위로 진입 키워드 결정."
            tone="amber"
            arrow
          />
          <FunnelStep
            num="STEP 3"
            title="청정 지역 매핑"
            desc="동·리 단위 경쟁도 측정으로 진입 가능한 지역 자동 매핑. 시군구별 청정 영역 우선 선택."
            tone="teal"
            arrow
          />
          <FunnelStep
            num="STEP 4"
            title="노출 지속 유지"
            desc="등록 후 매일 자동 검증. 070·플레이스 ID·동·상호 변경 즉시 감지로 매출 누락 차단."
            tone="rose"
          />
        </div>
      </section>

      {/* ─── 3) 4개 솔루션 진입 카드 ─── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            solutions
          </div>
          <h2 className="text-h2 text-ink">4개 솔루션 — 각각 자세히 보기</h2>
          <p className="text-body-sm text-ink-muted mt-1">
            카드를 클릭하면 솔루션별 "무엇 / 왜 / 효과" 상세 페이지로 이동합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SOLUTIONS.map((s) => (
            <SolutionCard key={s.id} sol={s} />
          ))}
        </div>
      </section>

      {/* ─── 4) 요금제 ─── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            pricing
          </div>
          <h2 className="text-h2 text-ink">요금제</h2>
          <p className="text-body-sm text-ink-muted mt-1">
            타지역닷컴에 등록·관리를 위탁하시는 경우 4종 솔루션 전체를 무료로 이용하실 수 있습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 무료 플랜 */}
          <Card variant="white" className="relative overflow-hidden">
            <div className="absolute top-5 right-5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-caption font-bold">
                <Gift size={12} /> FREE
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <Gift size={22} />
            </div>
            <h3 className="text-h2 text-ink mb-1">무료 플랜</h3>
            <p className="text-body-sm text-ink-muted mb-4 leading-relaxed">
              타지역닷컴에 <strong className="text-ink">타지역서비스 등록·관리를 위탁</strong>하시는 경우
              <br className="hidden md:block" />
              4종 솔루션 전체를 <strong className="text-emerald-700">무료</strong>로 이용 가능합니다.
            </p>

            <div className="rounded-card bg-emerald-50/60 border border-emerald-100 p-4 mb-4">
              <div className="text-caption font-bold text-emerald-700 mb-2">
                위탁 운영 시 무료 제공 항목
              </div>
              <ul className="space-y-1.5">
                {[
                  '4종 솔루션 전체 이용 (DNA / 발굴 / 경쟁도 / 노출관리)',
                  '070 가상번호·플레이스 등록 대행',
                  '청정 지역·황금 키워드 추천 리포트 정기 제공',
                  '매일 자동 노출 검증 + 변경 시 즉시 알림',
                  '구글시트 실시간 연동',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-caption text-ink leading-relaxed">
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-caption text-ink-muted leading-relaxed">
              ※ 등록·관리 위탁은 별도 운영 계약을 통해 진행됩니다. 자세한 사항은 문의해주세요.
            </div>
          </Card>

          {/* 유료 플랜 */}
          <Card variant="white" className="relative overflow-hidden ring-1 ring-brand-200">
            <div className="absolute top-5 right-5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-bold">
                <CreditCard size={12} /> PAID
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
              <CreditCard size={22} />
            </div>
            <h3 className="text-h2 text-ink mb-1">유료 플랜</h3>
            <p className="text-body-sm text-ink-muted mb-4 leading-relaxed">
              자체 운영하시는 경우 <strong className="text-ink">월정 구독</strong> 또는
              <strong className="text-ink"> 크레딧 구매</strong> 방식으로 4종 솔루션을 사용하실 수 있습니다.
            </p>

            <div className="space-y-3">
              {/* 월정 구독 */}
              <div className="rounded-card bg-brand-50/40 border border-brand-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard size={14} className="text-brand-600" />
                  <span className="text-caption font-bold text-brand-700">월정 구독료</span>
                </div>
                <p className="text-caption text-ink leading-relaxed mb-2">
                  매월 정액으로 4종 솔루션을 무제한 이용. 정기적으로 분석·검증을 수행하시는 경우 적합.
                </p>
                <ul className="space-y-1">
                  {[
                    '4종 솔루션 무제한 호출',
                    '매일 자동 노출 검증 (등록 번호 기준)',
                    '구글시트 실시간 연동',
                    '이메일·카카오 알림',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-caption text-ink-muted">
                      <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-brand-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 크레딧 구매형 */}
              <div className="rounded-card bg-amber-50/40 border border-amber-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Coins size={14} className="text-amber-600" />
                  <span className="text-caption font-bold text-amber-700">크레딧 구매형</span>
                </div>
                <p className="text-caption text-ink leading-relaxed mb-2">
                  분석 1건당 크레딧 차감. 비정기적으로 사용하시거나 프로젝트 단위 분석에 적합.
                </p>
                <ul className="space-y-1">
                  {[
                    'DNA 분석 1회 = 1 크레딧',
                    '경쟁도 Fast 스캔 1회 = 2 크레딧',
                    '경쟁도 Precise 스캔 1회 = 5 크레딧',
                    '추천·매트릭스·그래프 = 1 크레딧',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-caption text-ink-muted">
                      <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-amber-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 text-caption text-ink-muted leading-relaxed">
              ※ 정확한 단가는 운영 정책에 따라 안내됩니다. 가입 후 마이페이지에서 구독·크레딧을 선택하실 수 있습니다.
            </div>
          </Card>
        </div>
      </section>

      {/* ─── 5) FAQ ─── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            faq
          </div>
          <h2 className="text-h2 text-ink">통합 관점 자주 묻는 질문</h2>
        </div>

        <div className="space-y-3">
          <FaqRow
            q="4종 솔루션 중 한 개만 사용해도 되나요?"
            a="네. 각 솔루션은 단독 사용 가능합니다. 다만 통합 사용 시 DNA 파싱 결과 → 키워드 발굴 → 경쟁도 분석 → 노출관리로 데이터가 자연스럽게 흐르며, 의사결정 정확도가 크게 상승합니다."
          />
          <FaqRow
            q="무료 플랜은 어떻게 시작하나요?"
            a="타지역닷컴에 070·플레이스 등록·관리 운영을 위탁하시면 4종 솔루션 전체가 무료로 제공됩니다. 별도 위탁 계약 후 솔루션 접근 권한이 부여됩니다."
          />
          <FaqRow
            q="유료 플랜의 월정 구독료와 크레딧 구매형 차이는?"
            a="월정 구독료는 매월 정액으로 4종 솔루션을 무제한 사용하는 방식이며, 크레딧 구매형은 분석 1회마다 크레딧이 차감되는 방식입니다. 정기적·반복적 사용은 월정, 단발성 분석은 크레딧이 유리합니다."
          />
          <FaqRow
            q="4개 솔루션이 같은 데이터로 동작하나요?"
            a="네. 1,875개 등록 상호 / 216개 카테고리 / 회선수 508,854 / 4,819개 동·리 데이터를 4개 솔루션이 공유합니다. DNA 파싱에서 발견한 토큰이 키워드 발굴 추천에 그대로 반영되는 구조입니다."
          />
        </div>
      </section>

      {/* ─── 6) CTA ─── */}
      <Card variant="cta" className="min-h-[180px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div>
            <h3 className="text-h1 text-white mb-2">
              4종 솔루션, 지금 시작해 보세요
            </h3>
            <p className="text-body-sm text-white/85">
              위탁 운영 = 무료 / 자체 운영 = 월정 또는 크레딧 — 운영 방식에 맞춰 선택하실 수 있습니다.
            </p>
          </div>
          <Link to="/intro/keyword-dna" className="btn-cta-white">
            DNA 파싱 솔루션부터 보기 <ArrowRight size={16} />
          </Link>
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────── 서브 컴포넌트 ───────────────────────── */

function FunnelStep({
  num, title, desc, tone, arrow,
}: {
  num: string
  title: string
  desc: string
  tone: 'brand' | 'amber' | 'teal' | 'rose'
  arrow?: boolean
}) {
  const tc = {
    brand: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[tone]
  return (
    <div className="relative">
      <Card variant="white" className="h-full border border-bg-subtle">
        <div className={`inline-flex items-center px-2.5 py-1 rounded-pill text-[10px] font-bold tracking-wider ${tc} mb-3`}>
          {num}
        </div>
        <h4 className="text-h3 text-ink mb-2">{title}</h4>
        <p className="text-caption text-ink-muted leading-relaxed">{desc}</p>
      </Card>
      {arrow && (
        <ChevronRight
          size={20}
          className="hidden lg:block absolute top-1/2 -right-2.5 -translate-y-1/2 text-ink-soft"
        />
      )}
    </div>
  )
}

function SolutionCard({ sol }: { sol: SolutionLink }) {
  const Icon = sol.icon
  return (
    <Link
      to={sol.to}
      className="group block rounded-card bg-white shadow-card hover:shadow-card-lg transition-shadow overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${sol.accent} text-white flex items-center justify-center shrink-0 shadow-card`}>
            <Icon size={26} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-caption text-ink-muted font-mono mb-1">SOLUTION {sol.num}</div>
            <h3 className="text-h3 text-ink leading-tight mb-2 group-hover:text-brand-600 transition-colors">
              {sol.title}
            </h3>
            <p className="text-body-sm text-ink-muted leading-relaxed">{sol.tagline}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-caption font-semibold text-brand-600 group-hover:gap-2 transition-all">
              자세히 보기 <ArrowRight size={14} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function FaqRow({ q, a }: { q: string; a: string }) {
  return (
    <Card variant="white">
      <h4 className="text-body font-bold text-ink mb-2 flex items-start gap-2">
        <span className="text-brand-500 shrink-0">Q.</span>
        <span>{q}</span>
      </h4>
      <p className="text-body-sm text-ink-muted leading-relaxed pl-6">{a}</p>
    </Card>
  )
}
