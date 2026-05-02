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
    tagline: '“왜 옆 가게만 1페이지에 뜰까?” 그 비밀을 1초 만에 풀어드립니다.',
    icon: Dna,
    accent: 'from-brand-500 to-indigo-500',
  },
  {
    id: 'keyword',
    num: '02',
    to: '/intro/keyword-discover',
    title: '네이버1페이지 노출 키워드 발굴솔루션',
    shortLabel: '키워드 발굴',
    tagline: '검색량 큰 레드오션은 그만. 회선수 50만 건이 검증한 청정 황금 키워드만 골라드립니다.',
    icon: Sparkles,
    accent: 'from-amber-500 to-pink-500',
  },
  {
    id: 'competition',
    num: '03',
    to: '/intro/competition',
    title: '지역별 노출경쟁도 분석솔루션',
    shortLabel: '경쟁도 분석',
    tagline: '전국 4,819곳 중 사장님이 들어갈 수 있는 “빈 자리”, 데이터로 찾아드립니다.',
    icon: MapPin,
    accent: 'from-teal-500 to-cyan-500',
  },
  {
    id: 'monitor',
    num: '04',
    to: '/intro/monitor',
    title: '네이버노출관리 자동체크솔루션',
    shortLabel: '노출관리',
    tagline: '노출 사라진 걸 일주일 뒤에 알면 늦습니다. 매일 새벽 3시, 사장님 대신 깨어 있습니다.',
    icon: Radio,
    accent: 'from-rose-500 to-orange-500',
  },
]

export default function Intro() {
  return (
    <div className="space-y-10">
      <TopBar
        title="타지역 4종솔루션 소개"
        subtitle="“똑같이 등록했는데 왜 우리만 안 뜰까?” — 그 답답함을 이제 데이터로 풀어드립니다."
      />

      {/* ─── 1) Hero ─── */}
      <Card variant="white" className="min-h-[240px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          4 IN ONE <br /> SUITE
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-semibold mb-3">
            <Layers size={12} /> 타지역서비스 통합 운영 플랫폼
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            상호 작명부터 노출 유지까지,<br />
            사장님이 “느낌”으로 결정하던 모든 순간을 데이터로 바꿔드립니다.
          </h2>
          <p className="text-base text-ink-muted leading-relaxed">
            타지역서비스는 <strong className="text-ink">단일 작업이 아니라 4단계 운영 프로세스</strong>입니다.
            한 단계라도 빠지면 — 등록비도, 광고비도, 매출도 그대로 새어 나갑니다. 본 SaaS는 4개 솔루션이
            <strong className="text-ink"> 동일한 데이터(1,875 상호 / 216 카테고리 / 회선수 508K / 4,819 동·리)</strong>를
            공유하여, 사장님 의사결정이 “감”이 아닌 “증거”로 흐르게 만듭니다.
          </p>
        </div>
      </Card>

      {/* ─── 2) 4종 시너지 (퍼널) ─── */}
      <section>
        <div className="mb-4">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            integrated funnel
          </div>
          <h2 className="text-h2 text-ink">4종 통합 워크플로우</h2>
          <p className="text-body text-ink-muted mt-1">
            각 솔루션은 단독으로도 작동하지만, 4개를 함께 사용할 때 데이터가 누적되어
            의사결정 정확도가 비약적으로 상승합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <FunnelStep
            num="STEP 1"
            title="키워드 구조 해부"
            desc="“왜 옆 가게만 1페이지에 뜰까?” 그 비밀을 1초 만에 풀어드립니다. 경쟁사 상호 DNA를 6가지로 분해해 노출의 정답을 보여드립니다."
            tone="brand"
            arrow
          />
          <FunnelStep
            num="STEP 2"
            title="진입 키워드 발굴"
            desc="검색량 큰 레드오션은 버리세요. 회선수 50만 건이 검증한 “돈 되는 청정 키워드”만 골라 우선순위까지 매겨드립니다."
            tone="amber"
            arrow
          />
          <FunnelStep
            num="STEP 3"
            title="청정 지역 매핑"
            desc="강남구는 포화, 정선군은 청정. 전국 4,819곳 중 사장님이 들어갈 수 있는 “빈 자리”를 지도 위에 그려드립니다."
            tone="teal"
            arrow
          />
          <FunnelStep
            num="STEP 4"
            title="노출 지속 유지"
            desc="네이버는 말없이 노출을 거두어 갑니다. 매일 새벽 3시 자동 검증 — 변경 즉시 알림으로 매출 누락을 24시간 안에 차단합니다."
            tone="rose"
          />
        </div>
      </section>

      {/* ─── 3) 4개 솔루션 진입 카드 ─── */}
      <section>
        <div className="mb-4">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            solutions
          </div>
          <h2 className="text-h2 text-ink">4개 솔루션 — 각각 자세히 보기</h2>
          <p className="text-body text-ink-muted mt-1">
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
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            pricing
          </div>
          <h2 className="text-h2 text-ink">요금제</h2>
          <p className="text-body text-ink-muted mt-1">
            등록·관리만 맡기시면 — 4종 솔루션 전체를 <strong className="text-emerald-700">100% 무료</strong>로 사용하실 수 있습니다. 사장님이 잃을 게 없습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 무료 플랜 */}
          <Card variant="white" className="relative overflow-hidden">
            <div className="absolute top-5 right-5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold">
                <Gift size={12} /> FREE
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <Gift size={22} />
            </div>
            <h3 className="text-h2 text-ink mb-1">무료 플랜</h3>
            <p className="text-body text-ink-muted mb-4 leading-relaxed">
              타지역닷컴에 <strong className="text-ink">등록·관리만 맡기시면</strong>
              <br className="hidden md:block" />
              4종 솔루션 전체를 <strong className="text-emerald-700">평생 무료</strong>로 — 사장님은 결과만 받으시면 됩니다.
            </p>

            <div className="rounded-card bg-emerald-50/60 border border-emerald-100 p-4 mb-4">
              <div className="text-body-sm font-bold text-emerald-700 mb-2">
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
                  <li key={f} className="flex items-start gap-2 text-body-sm text-ink leading-relaxed">
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-body-sm text-ink-muted leading-relaxed">
              ※ 등록·관리 위탁은 별도 운영 계약을 통해 진행됩니다. 자세한 사항은 문의해주세요.
            </div>
          </Card>

          {/* 유료 플랜 */}
          <Card variant="white" className="relative overflow-hidden ring-1 ring-brand-200">
            <div className="absolute top-5 right-5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-bold">
                <CreditCard size={12} /> PAID
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
              <CreditCard size={22} />
            </div>
            <h3 className="text-h2 text-ink mb-1">유료 플랜</h3>
            <p className="text-body text-ink-muted mb-4 leading-relaxed">
              자체 운영하시는 경우 <strong className="text-ink">월정 구독</strong> 또는
              <strong className="text-ink"> 크레딧 구매</strong> 방식으로 4종 솔루션을 사용하실 수 있습니다.
            </p>

            <div className="space-y-3">
              {/* 월정 구독 */}
              <div className="rounded-card bg-brand-50/40 border border-brand-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard size={14} className="text-brand-600" />
                  <span className="text-body-sm font-bold text-brand-700">월정 구독료</span>
                </div>
                <p className="text-body-sm text-ink leading-relaxed mb-2">
                  매월 정액으로 4종 솔루션을 무제한 이용. 정기적으로 분석·검증을 수행하시는 경우 적합.
                </p>
                <ul className="space-y-1">
                  {[
                    '4종 솔루션 무제한 호출',
                    '매일 자동 노출 검증 (등록 번호 기준)',
                    '구글시트 실시간 연동',
                    '이메일·카카오 알림',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-body-sm text-ink-muted">
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
                  <span className="text-body-sm font-bold text-amber-700">크레딧 구매형</span>
                </div>
                <p className="text-body-sm text-ink leading-relaxed mb-2">
                  분석 1건당 크레딧 차감. 비정기적으로 사용하시거나 프로젝트 단위 분석에 적합.
                </p>
                <ul className="space-y-1">
                  {[
                    'DNA 분석 1회 = 1 크레딧',
                    '경쟁도 Fast 스캔 1회 = 2 크레딧',
                    '경쟁도 Precise 스캔 1회 = 5 크레딧',
                    '추천·매트릭스·그래프 = 1 크레딧',
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-body-sm text-ink-muted">
                      <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-amber-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 text-body-sm text-ink-muted leading-relaxed">
              ※ 정확한 단가는 운영 정책에 따라 안내됩니다. 가입 후 마이페이지에서 구독·크레딧을 선택하실 수 있습니다.
            </div>
          </Card>
        </div>
      </section>

      {/* ─── 5) FAQ ─── */}
      <section>
        <div className="mb-4">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            faq
          </div>
          <h2 className="text-h2 text-ink">통합 관점 자주 묻는 질문</h2>
        </div>

        <div className="space-y-3">
          <FaqRow
            q="4종 중에 한 개만 써도 되나요?"
            a="네, 각 솔루션은 단독으로도 충분히 강력합니다. 다만 4개를 함께 쓰시면 — DNA 파싱에서 찾은 키워드가 발굴 솔루션으로, 거기서 추린 키워드가 경쟁도 분석으로, 그리고 등록 후엔 노출관리로 자연스럽게 흘러갑니다. 사장님 의사결정 정확도가 비교할 수 없을 만큼 올라갑니다."
          />
          <FaqRow
            q="무료 플랜은 어떻게 시작하나요?"
            a="간단합니다. 타지역닷컴에 070·플레이스 등록·관리만 맡기시면 4종 솔루션 전체가 평생 무료입니다. 별도 위탁 계약 후 바로 솔루션 접근 권한이 열립니다 — 사장님은 결과만 받으시면 됩니다."
          />
          <FaqRow
            q="유료 플랜의 월정 구독과 크레딧 구매형, 뭐가 다른가요?"
            a="매일·매주 분석을 돌리신다면 월정 구독이 가장 저렴합니다. 가끔 한 번씩, 프로젝트 단위로만 쓰신다면 크레딧 구매형이 훨씬 합리적입니다. 사장님 사용 패턴에 맞게 선택하세요."
          />
          <FaqRow
            q="4개 솔루션이 정말 같은 데이터를 쓰나요?"
            a="네. 1,875개 등록 상호 / 216개 카테고리 / 회선수 508,854 / 4,819개 동·리 — 모두 한 데이터베이스를 공유합니다. DNA 파싱에서 발견한 토큰이 키워드 발굴 추천에 그대로 반영되고, 그 결과가 경쟁도·노출관리로 이어집니다. 분석할 때마다 데이터가 바뀌지 않습니다."
          />
        </div>
      </section>

      {/* ─── 6) CTA ─── */}
      <Card variant="cta" className="min-h-[180px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/20 text-white text-body-sm font-bold mb-3 backdrop-blur-sm">
              🎁 위탁만 맡기시면 4종 모두 평생 무료
            </span>
            <h3 className="text-h1 text-white mb-2">
              망설이는 사이, 옆 가게는 이미 시작했습니다.
            </h3>
            <p className="text-body text-white/85">
              등록·관리만 맡기시면 4종 솔루션 전부 무료. 사장님이 잃을 게 없습니다 — 지금 한 발만 떼어 보세요.
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
        <p className="text-body-sm text-ink-muted leading-relaxed">{desc}</p>
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
            <div className="text-body-sm text-ink-muted font-mono mb-1">SOLUTION {sol.num}</div>
            <h3 className="text-h3 text-ink leading-tight mb-2 group-hover:text-brand-600 transition-colors">
              {sol.title}
            </h3>
            <p className="text-body text-ink-muted leading-relaxed">{sol.tagline}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-body-sm font-semibold text-brand-600 group-hover:gap-2 transition-all">
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
      <h4 className="text-base font-bold text-ink mb-2 flex items-start gap-2">
        <span className="text-brand-500 shrink-0">Q.</span>
        <span>{q}</span>
      </h4>
      <p className="text-body text-ink-muted leading-relaxed pl-6">{a}</p>
    </Card>
  )
}
