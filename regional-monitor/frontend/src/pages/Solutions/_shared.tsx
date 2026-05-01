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
}

export function SolutionDetailLayout(props: SolutionDetailProps) {
  const Icon = props.icon
  return (
    <div className="space-y-10">
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
            <div className="text-caption text-ink-muted font-mono mb-1">
              SOLUTION {props.num}
            </div>
            <h2 className="text-h2 text-ink leading-tight">{props.shortLabel}</h2>
            <p className="text-body text-ink-muted mt-2 leading-relaxed">
              {props.tagline}
            </p>
          </div>
        </div>
      </Card>

      {/* 무엇 / 왜 / 효과 3-블록 */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <BlockCard
            tone="brand"
            icon={<HelpCircle size={18} />}
            tag="WHAT"
            title="이 솔루션이 무엇인가요?"
            headline={props.what.headline}
            bullets={props.what.bullets}
          />
          <BlockCard
            tone="warning"
            icon={<AlertTriangle size={18} />}
            tag="WHY"
            title="왜 필요한가요?"
            headline={props.why.headline}
            bullets={props.why.bullets}
          />
          <EffectCard
            tone="success"
            icon={<TrendingUp size={18} />}
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
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            how to use
          </div>
          <h2 className="text-h2 text-ink">사용 흐름</h2>
        </div>
        <Card variant="white">
          <ol className="space-y-3">
            {props.howToUse.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand-500 text-white font-bold flex items-center justify-center text-caption">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold">
                    {s.step}
                  </div>
                  <div className="text-body font-bold text-ink">{s.title}</div>
                  <p className="text-body-sm text-ink-muted leading-relaxed mt-0.5">
                    {s.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      {/* CTA */}
      <Card variant="cta" className="min-h-[160px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div>
            <h3 className="text-h2 text-white mb-1">지금 사용해 보세요</h3>
            <p className="text-body-sm text-white/85">
              위탁 운영 시 무료 · 자체 운영 시 월정 구독 또는 크레딧 구매로 이용 가능합니다.
            </p>
          </div>
          <Link to={props.ctaTo} className="btn-cta-white">
            <PlayCircle size={16} /> {props.ctaLabel} <ArrowRight size={16} />
          </Link>
        </div>
      </Card>

      {/* 다른 솔루션 보러 가기 */}
      <Card variant="white">
        <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-2">
          related
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/intro"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-pill bg-bg-subtle text-ink hover:bg-brand-50 hover:text-brand-700 text-caption font-medium transition-colors"
          >
            ← 4종 솔루션 통합 소개로 돌아가기
          </Link>
        </div>
      </Card>
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
    <Card variant="white" className="h-full flex flex-col">
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill ${t.bg} ${t.text} text-[10px] font-bold tracking-wider self-start mb-3`}
      >
        {icon}
        {tag}
      </div>
      <h3 className="text-body font-bold text-ink mb-1">{title}</h3>
      <p className="text-body-sm text-ink leading-relaxed mb-4 font-medium">
        {headline}
      </p>
      <ul className="space-y-2 mt-auto">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-caption text-ink-muted leading-relaxed"
          >
            <CheckCircle2 size={14} className={`shrink-0 mt-0.5 ${t.text}`} />
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
    <Card variant="white" className="h-full flex flex-col">
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill ${t.bg} ${t.text} text-[10px] font-bold tracking-wider self-start mb-3`}
      >
        {icon}
        {tag}
      </div>
      <h3 className="text-body font-bold text-ink mb-1">{title}</h3>
      <p className="text-body-sm text-ink leading-relaxed mb-3 font-medium">
        {headline}
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={`rounded-xl border ${t.border} ${t.bg}/40 px-2 py-2 text-center`}
          >
            <div className={`text-body font-bold ${t.text}`}>{m.value}</div>
            <div className="text-[10px] text-ink-muted leading-tight mt-0.5">
              {m.label}
            </div>
          </div>
        ))}
      </div>

      <ul className="space-y-2 mt-auto">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-caption text-ink-muted leading-relaxed"
          >
            <CheckCircle2 size={14} className={`shrink-0 mt-0.5 ${t.text}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
