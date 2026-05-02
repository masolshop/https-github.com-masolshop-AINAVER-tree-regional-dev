/**
 * 솔루션별 상세 페이지 공통 레이아웃 컴포넌트.
 * - SolutionDetailLayout: TopBar + Hero + 무엇/왜/효과 3블록 + 사용 가이드 + CTA
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  TrendingUp,
  PlayCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import PageSeo, { buildServiceJsonLd } from '@/components/seo/PageSeo'
import { RelatedLinks, ALL_RELATED_LINKS } from '@/components/seo/RelatedLinks'
import { KAKAO_CHAT_URL } from '@/utils/contact'

export interface SolutionDetailProps {
  num: string
  title: string
  subtitle: string
  shortLabel: string
  tagline: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  accent: string
  ctaTo: string
  ctaLabel: string
  what: { headline: string; bullets: string[] }
  why: { headline: string; bullets: string[] }
  effect: {
    headline: string
    metrics: { label: string; value: string }[]
    bullets: string[]
  }
  howToUse: { step: string; title: string; desc: string }[]
  /** SEO: 현재 페이지 경로(예: "/intro/keyword-dna") */
  seoPath?: string
  /** SEO: 메타 description (없으면 tagline 앞부분 사용) */
  seoDescription?: string
  /** SEO: 키워드 배열 */
  seoKeywords?: string[]
  /** SEO: 서비스 분류 (예: "키워드 분석") */
  seoServiceType?: string
}

export function SolutionDetailLayout(props: SolutionDetailProps) {
  const Icon = props.icon
  const seoDesc =
    props.seoDescription || props.tagline.replace(/\s+/g, ' ').slice(0, 155)
  return (
    <div className="space-y-10">
      {props.seoPath && (
        <PageSeo
          title={props.title}
          description={seoDesc}
          path={props.seoPath}
          keywords={props.seoKeywords}
          jsonLd={buildServiceJsonLd({
            name: props.title,
            description: seoDesc,
            path: props.seoPath,
            serviceType: props.seoServiceType || '네이버 플레이스 노출 솔루션',
          })}
        />
      )}
      <TopBar title={props.title} subtitle={props.subtitle} />

      {/* Hero */}
      <Card variant="white" className="relative overflow-hidden">
        <div className="absolute top-5 right-7 text-[60px] leading-none font-light text-ink-watermark/40 select-none pointer-events-none tracking-tight">
          {props.num}
        </div>
        <div className="flex items-start gap-4">
          <div
            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${props.accent} text-white flex items-center justify-center shrink-0 shadow-card`}
          >
            <Icon size={30} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-body text-ink-muted font-mono mb-1">
              SOLUTION {props.num}
            </div>
            <h2 className="text-ink leading-tight font-bold" style={{ fontSize: '30px', lineHeight: '1.3' }}>{props.shortLabel}</h2>
            <p className="text-ink-muted mt-3 leading-relaxed" style={{ fontSize: '22px', lineHeight: '1.75' }}>
              {props.tagline}
            </p>
          </div>
        </div>
      </Card>

      {/* 무엇 / 왜 / 효과 3-블록 (세로 스택, 1박스/행) */}
      <section>
        <div className="grid grid-cols-1 gap-6">
          <BlockCard
            tone="brand"
            icon={<HelpCircle size={22} />}
            tag="WHAT"
            title="이 솔루션이 무엇인가요?"
            headline={props.what.headline}
            bullets={props.what.bullets}
          />
          <BlockCard
            tone="warning"
            icon={<AlertTriangle size={22} />}
            tag="WHY"
            title="왜 필요한가요?"
            headline={props.why.headline}
            bullets={props.why.bullets}
          />
          <EffectCard
            tone="success"
            icon={<TrendingUp size={22} />}
            tag="EFFECT"
            title="어떤 효과가 있나요?"
            headline={props.effect.headline}
            metrics={props.effect.metrics}
            bullets={props.effect.bullets}
          />
        </div>
      </section>

      {/* 사용 가이드 */}
      <section>
        <div className="mb-5">
          <div className="text-ink-muted uppercase tracking-wider font-semibold mb-2" style={{ fontSize: '16px' }}>
            how to use
          </div>
          <h2 className="text-ink font-bold" style={{ fontSize: '30px', lineHeight: '1.3' }}>사용 흐름</h2>
        </div>
        <Card variant="white">
          <ol className="space-y-5">
            {props.howToUse.map((s, i) => (
              <li key={i} className="flex gap-4">
                <span className="shrink-0 w-10 h-10 rounded-full bg-brand-500 text-white font-bold flex items-center justify-center text-xl">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-base text-ink-muted uppercase tracking-wider font-semibold mb-0.5">
                    {s.step}
                  </div>
                  <div className="font-bold text-ink" style={{ fontSize: '26px', lineHeight: '1.4' }}>{s.title}</div>
                  <p className="text-ink-muted leading-relaxed mt-2" style={{ fontSize: '21px', lineHeight: '1.75' }}>
                    {s.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      {/* CTA — 무료 강조형 */}
      <Card variant="cta" className="min-h-[200px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div className="flex-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/20 text-white text-body font-bold mb-3 backdrop-blur-sm">
              🎁 타지역닷컴 위탁 시 100% 무료
            </span>
            <h3 className="text-white mb-3 leading-tight font-bold" style={{ fontSize: '28px', lineHeight: '1.3' }}>
              망설이는 사이, 옆 가게는 이미 시작했습니다.
            </h3>
            <p className="text-white/90 leading-relaxed" style={{ fontSize: '22px', lineHeight: '1.7' }}>
              <strong className="text-white">등록·관리만 맡기시면 4종 솔루션 전부 무료</strong>로 사용하실 수 있습니다.
              지금 신청하시면 청정 키워드·진입 가능 지역까지 함께 분석해 드립니다.
            </p>
          </div>
          <a
            href={KAKAO_CHAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-cta-white whitespace-nowrap shrink-0"
          >
            <PlayCircle size={18} /> {props.ctaLabel} <ArrowRight size={18} />
          </a>
        </div>
      </Card>

      {/* 4종 솔루션 통합 소개로 돌아가기 */}
      <Card variant="white">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/intro"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-pill bg-bg-subtle text-ink hover:bg-brand-50 hover:text-brand-700 text-body font-medium transition-colors"
          >
            ← 4종 솔루션 통합 소개로 돌아가기
          </Link>
        </div>
      </Card>

      {/* 관련 페이지 (SEO 내부 링크 - 양방향 100% 완성) */}
      {props.seoPath && (
        <RelatedLinks currentPath={props.seoPath} items={ALL_RELATED_LINKS} />
      )}
    </div>
  )
}

interface BlockCardProps {
  tone: 'brand' | 'warning' | 'success'
  icon: React.ReactNode
  tag: string
  title: string
  headline: string
  bullets: string[]
}

const TONE_CLASS: Record<
  BlockCardProps['tone'],
  { bg: string; text: string; border: string }
> = {
  brand: { bg: 'bg-brand-50', text: 'text-brand-700', border: 'border-brand-200' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
}

function BlockCard({ tone, icon, tag, title, headline, bullets }: BlockCardProps) {
  const t = TONE_CLASS[tone]
  return (
    <Card variant="white" className="flex flex-col p-7">
      <div
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-pill ${t.bg} ${t.text} text-lg font-bold tracking-wider self-start mb-5`}
      >
        {icon}
        {tag}
      </div>
      <h3 className="font-bold text-ink mb-4" style={{ fontSize: '32px', lineHeight: '1.3' }}>{title}</h3>
      <p className="text-ink leading-relaxed mb-6 font-medium" style={{ fontSize: '24px', lineHeight: '1.65' }}>
        {headline}
      </p>
      <ul className="space-y-4">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-ink-muted leading-relaxed"
            style={{ fontSize: '21px', lineHeight: '1.75' }}
          >
            <CheckCircle2 size={20} className={`shrink-0 mt-0.5 ${t.text}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

interface EffectCardProps extends BlockCardProps {
  metrics: { label: string; value: string }[]
}

function EffectCard({
  tone, icon, tag, title, headline, metrics, bullets,
}: EffectCardProps) {
  const t = TONE_CLASS[tone]
  return (
    <Card variant="white" className="flex flex-col p-7">
      <div
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-pill ${t.bg} ${t.text} text-lg font-bold tracking-wider self-start mb-5`}
      >
        {icon}
        {tag}
      </div>
      <h3 className="font-bold text-ink mb-4" style={{ fontSize: '32px', lineHeight: '1.3' }}>{title}</h3>
      <p className="text-ink leading-relaxed mb-5 font-medium" style={{ fontSize: '24px', lineHeight: '1.65' }}>
        {headline}
      </p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={`rounded-xl border ${t.border} ${t.bg}/40 px-4 py-5 text-center`}
          >
            <div className={`font-bold ${t.text}`} style={{ fontSize: '40px', lineHeight: '1.1' }}>{m.value}</div>
            <div className="text-ink-muted leading-snug mt-2" style={{ fontSize: '19px', lineHeight: '1.45' }}>
              {m.label}
            </div>
          </div>
        ))}
      </div>

      <ul className="space-y-4">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-ink-muted leading-relaxed"
            style={{ fontSize: '21px', lineHeight: '1.75' }}
          >
            <CheckCircle2 size={20} className={`shrink-0 mt-0.5 ${t.text}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
