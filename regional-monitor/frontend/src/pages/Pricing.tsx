/**
 * 요금제 안내 페이지 (/pricing)
 *
 * 네이버노출 자동체크솔루션의 무료/유료 11종 요금제를 한 페이지에서 보여준다.
 * - 결제/문의 버튼은 모두 카카오톡 상담 채널(KAKAO_CHAT_URL)로 연결
 * - 자동체크는 매일 1회(KST 새벽) 실행됨을 명시
 * - SEO: PageSeo 컴포넌트로 title/description/canonical/OG 메타 주입
 */
import { Link } from 'react-router-dom'
import {
  CreditCard,
  Gift,
  Zap,
  MessageCircle,
  CheckCircle2,
  Clock,
  Crown,
  ArrowRight,
} from 'lucide-react'
import clsx from 'clsx'

import { TopBar } from '@/components/layout/TopBar'
import PageSeo, { buildFaqJsonLd } from '@/components/seo/PageSeo'
import { KAKAO_CHAT_URL, EXTERNAL_LINK_PROPS } from '@/utils/contact'

// ──────────────────────────────────────────────────────────────
// 요금제 데이터
// ──────────────────────────────────────────────────────────────
interface PricingPlan {
  /** 플랜 식별 키 */
  key: string
  /** 플랜 이름 */
  name: string
  /** 한 줄 설명 */
  desc: string
  /** 상세 안내 (없으면 미노출) */
  detail?: string
  /** 가격 표시 */
  price: string
  /** 강조 색상 분류 */
  variant: 'free' | 'paid' | 'contact'
  /** 회선수 — 정렬 및 표시용 */
  lines?: number
}

const PRICING_PLANS: PricingPlan[] = [
  // 1. 솔루션 4종 무료 플랜
  {
    key: 'free-4tools',
    name: '솔루션 4종 무료플랜',
    desc: '타지역서비스 등록관리 · 타지역닷컴 등록관리 시',
    detail:
      '키워드 DNA · 키워드 발굴 · 지역 경쟁도 · 노출관리 자동체크 4종 솔루션을 무료로 사용하실 수 있습니다.',
    price: '무료',
    variant: 'free',
  },
  // 2. 노출 자동체크 무료 체험 플랜
  {
    key: 'free-trial',
    name: '노출 자동체크 무료체험',
    desc: '50개 회선 · 1주일 무료체험',
    detail:
      '플레이스 ID 기반 4중 검증(페이지 생존 · 070 일치 · 등록 동 일치 · 상호명 일치)을 1주일 무료로 체험하세요.',
    price: '무료',
    variant: 'free',
  },
  // 3 ~ 10. 회선 수 기반 유료 플랜
  { key: 'plan-500',  name: '500플랜',  desc: '500회선까지',  price: '월 3만원',  variant: 'paid', lines: 500  },
  { key: 'plan-1000', name: '1000플랜', desc: '1000회선까지', price: '월 6만원',  variant: 'paid', lines: 1000 },
  { key: 'plan-1500', name: '1500플랜', desc: '1500회선까지', price: '월 9만원',  variant: 'paid', lines: 1500 },
  { key: 'plan-2000', name: '2000플랜', desc: '2000회선까지', price: '월 12만원', variant: 'paid', lines: 2000 },
  { key: 'plan-2500', name: '2500플랜', desc: '2500회선까지', price: '월 15만원', variant: 'paid', lines: 2500 },
  { key: 'plan-3000', name: '3000플랜', desc: '3000회선까지', price: '월 18만원', variant: 'paid', lines: 3000 },
  { key: 'plan-3500', name: '3500플랜', desc: '3500회선까지', price: '월 21만원', variant: 'paid', lines: 3500 },
  { key: 'plan-4000', name: '4000플랜', desc: '4000회선까지', price: '월 24만원', variant: 'paid', lines: 4000 },
  // 11. 대량 노출체크 관리는 문의
  {
    key: 'contact',
    name: '대량 노출체크 관리',
    desc: '4000회선 초과 · 맞춤 견적',
    detail: '대량 회선 운영, 다중 지점, 맞춤 검증 주기가 필요하시면 타지역닷컴으로 문의주세요.',
    price: '문의',
    variant: 'contact',
  },
]

// ──────────────────────────────────────────────────────────────
// FAQ — JSON-LD 리치 스니펫 + 페이지 하단 안내
// ──────────────────────────────────────────────────────────────
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: '자동체크는 얼마나 자주 실행되나요?',
    answer:
      '모든 유료 플랜은 매일 1회 자동으로 실행되어 플레이스 ID·070 번호·등록 동·상호명 4중 검증을 수행합니다. 변경 발생 시 즉시 이메일/카카오 알림으로 알려드립니다.',
  },
  {
    question: '결제는 어떻게 진행하나요?',
    answer:
      '각 요금제 카드의 "결제" 또는 "문의하기" 버튼을 누르시면 타지역닷컴 카카오톡 상담 채널(pf.kakao.com/_qemTX)로 연결됩니다. 회선 수 확인 후 결제/세금계산서 발행을 안내해드립니다.',
  },
  {
    question: '무료 체험과 4종 무료플랜은 어떻게 다른가요?',
    answer:
      '솔루션 4종 무료플랜은 타지역서비스/타지역닷컴 등록관리 회원에게 키워드 DNA·발굴·경쟁도·자동체크 4종을 무료로 제공하는 플랜입니다. 노출 자동체크 무료체험은 50개 회선을 1주일간 자동체크 기능만 무료로 체험하는 플랜입니다.',
  },
  {
    question: '회선 수를 초과하면 어떻게 되나요?',
    answer:
      '플랜별 회선 한도(예: 500플랜 = 500회선) 내에서 자동체크가 실행됩니다. 초과 회선이 생기면 한 단계 위 플랜으로 업그레이드하거나, 4000회선을 초과하는 대량 운영의 경우 별도 견적으로 문의주세요.',
  },
]

const ALL_FEATURES = [
  '플레이스 ID 기반 4중 검증 (페이지 생존 · 070 일치 · 등록 동 일치 · 상호명 일치)',
  '매일 1회 자동 검증 — 사장님 잠든 사이 검증 완료',
  '변경 발생 시 즉시 이메일·카카오 알림',
  'verdict 4종 분류 (OK / DEAD / DONG_MISMATCH / REGION_MISMATCH)',
  '검증 이력 보관 — 노출 트렌드 분석에 그대로 활용',
]

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────
export default function Pricing() {
  const faqJsonLd = buildFaqJsonLd(
    FAQ_ITEMS.map((item) => ({ q: item.question, a: item.answer })),
  )

  return (
    <div className="space-y-8">
      <PageSeo
        title="네이버노출 자동체크솔루션 요금제"
        description="타지역서비스 네이버노출 자동체크솔루션 무료·유료 요금제 11종 안내. 50개 1주일 무료체험부터 4000회선 월 24만원까지."
        path="/pricing"
        keywords={[
          '타지역서비스',
          '네이버 노출 자동체크',
          '요금제',
          '무료체험',
          '유료 플랜',
          '회선 관리',
          '플레이스 ID 검증',
          '타지역닷컴',
        ]}
        jsonLd={faqJsonLd}
      />

      <TopBar
        title="네이버노출 자동체크솔루션 요금제"
        subtitle="50개 1주일 무료체험부터 4000회선 월 24만원까지 — 모든 플랜은 매일 1회 자동체크 포함"
      />

      {/* Hero — 안내 배지 */}
      <section className="rounded-card bg-gradient-to-br from-amber-50 via-white to-amber-50 ring-1 ring-amber-200 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
            <CreditCard className="text-amber-700" size={24} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <h1 className="text-h2 font-bold text-ink leading-tight">
              네이버노출 자동체크솔루션 — 무료 · 유료 요금제 11종
            </h1>
            <p className="text-body text-ink-muted leading-relaxed">
              플레이스 ID 기반 4중 검증을 매일 자동 실행하여 노출 누락에 의한 매출 손실을 차단합니다.
              아래 11종 플랜 중 회선 수에 맞는 플랜을 선택하시고, 결제 버튼을 누르시면 카카오톡으로 안내해드립니다.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-caption font-semibold">
                <Clock size={13} /> 매일 1회 자동체크
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200 text-caption font-semibold">
                <CheckCircle2 size={13} /> 4중 검증 모든 플랜 공통
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200 text-caption font-semibold">
                <MessageCircle size={13} /> 결제·문의 모두 카카오톡
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 요금제 카드 그리드 — 11종 */}
      <section className="space-y-4">
        <h2 className="text-h3 font-bold text-ink px-1">요금제 11종 한눈에 보기</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRICING_PLANS.map((plan) => {
            const PlanIcon =
              plan.variant === 'free'
                ? Gift
                : plan.variant === 'contact'
                  ? Crown
                  : Zap
            const wrapperCls = clsx(
              'rounded-card p-5 ring-1 transition-all hover:-translate-y-0.5 hover:shadow-card flex flex-col',
              plan.variant === 'free' && 'bg-emerald-50 ring-emerald-200',
              plan.variant === 'paid' && 'bg-white ring-bg-subtle',
              plan.variant === 'contact' && 'bg-violet-50 ring-violet-200',
            )
            const iconWrapCls = clsx(
              'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
              plan.variant === 'free' && 'bg-emerald-100 text-emerald-700',
              plan.variant === 'paid' && 'bg-brand-50 text-brand-600',
              plan.variant === 'contact' && 'bg-violet-100 text-violet-700',
            )
            const priceCls = clsx(
              'text-xl font-bold',
              plan.variant === 'free' && 'text-emerald-700',
              plan.variant === 'paid' && 'text-brand-700',
              plan.variant === 'contact' && 'text-violet-700',
            )
            const buttonCls = clsx(
              'w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-colors',
              plan.variant === 'free' && 'bg-emerald-600 text-white hover:bg-emerald-700',
              plan.variant === 'paid' && 'bg-brand-500 text-white hover:bg-brand-600',
              plan.variant === 'contact' && 'bg-violet-600 text-white hover:bg-violet-700',
            )
            const buttonLabel = plan.variant === 'contact' ? '문의하기' : '결제'
            return (
              <article key={plan.key} className={wrapperCls}>
                <header className="flex items-start gap-3">
                  <div className={iconWrapCls}>
                    <PlanIcon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body font-bold text-ink leading-tight">
                      {plan.name}
                    </h3>
                    <p className="mt-0.5 text-caption text-ink-muted leading-snug">
                      {plan.desc}
                    </p>
                  </div>
                </header>

                <div className="mt-4 pb-4 border-b border-bg-subtle">
                  <div className={priceCls}>{plan.price}</div>
                  {plan.lines && (
                    <div className="text-caption text-ink-muted mt-0.5">
                      회선당 약 {Math.round((parseInt(plan.price.replace(/[^0-9]/g, ''), 10) * 10000) / plan.lines).toLocaleString()}원/월
                    </div>
                  )}
                </div>

                {plan.detail && (
                  <p className="mt-3 text-caption text-ink-soft leading-relaxed flex-1">
                    {plan.detail}
                  </p>
                )}

                <div className="mt-4">
                  <a
                    href={KAKAO_CHAT_URL}
                    {...EXTERNAL_LINK_PROPS}
                    className={buttonCls}
                  >
                    <MessageCircle size={14} />
                    {buttonLabel}
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* 모든 플랜 공통 기능 */}
      <section className="rounded-card bg-white ring-1 ring-bg-subtle p-6 sm:p-8">
        <h2 className="text-h3 font-bold text-ink">모든 유료 플랜 공통 기능</h2>
        <p className="mt-1 text-caption text-ink-muted">
          회선 수와 무관하게 모든 유료 플랜이 동일한 검증 품질을 제공합니다.
        </p>
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {ALL_FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2 text-body text-ink leading-relaxed"
            >
              <CheckCircle2
                size={18}
                className="shrink-0 mt-0.5 text-emerald-600"
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="rounded-card bg-bg-subtle/40 ring-1 ring-bg-subtle p-6 sm:p-8">
        <h2 className="text-h3 font-bold text-ink">자주 묻는 질문</h2>
        <div className="mt-4 space-y-4">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question} className="rounded-lg bg-white ring-1 ring-bg-subtle p-4">
              <h3 className="text-body font-bold text-ink">Q. {item.question}</h3>
              <p className="mt-2 text-body text-ink-muted leading-relaxed">
                {item.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 마지막 CTA */}
      <section className="rounded-card bg-gradient-to-r from-brand-600 to-brand-700 text-white p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
        <div className="flex-1">
          <h2 className="text-h3 font-bold">아직 어떤 플랜이 좋을지 고민되시나요?</h2>
          <p className="mt-1 text-body opacity-90">
            관리하실 회선 수만 알려주시면 — 가장 적합한 플랜을 안내해드립니다.
            먼저 50개 1주일 무료체험으로 자동체크 품질부터 확인해보세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/intro/monitor"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors text-sm font-bold ring-1 ring-white/30"
          >
            솔루션 자세히 보기 <ArrowRight size={14} />
          </Link>
          <a
            href={KAKAO_CHAT_URL}
            {...EXTERNAL_LINK_PROPS}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white text-brand-700 hover:bg-brand-50 transition-colors text-sm font-bold"
          >
            <MessageCircle size={14} /> 카카오톡 상담
          </a>
        </div>
      </section>
    </div>
  )
}
