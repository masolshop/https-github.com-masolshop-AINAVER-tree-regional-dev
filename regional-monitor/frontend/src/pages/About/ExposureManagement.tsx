/**
 * 타지역 노출 관리 — 네이버노출 자동체크 솔루션 요약 페이지
 * - 자동체크솔루션 핵심 가치를 도식·인포그래픽으로 요약
 * - 하단에 CTA: 네이버노출 자동체크 솔루션 무료플랜 신청
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Link } from 'react-router-dom'
import {
  Radio,
  Eye,
  Bell,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  ArrowRight,
  ArrowDown,
  Zap,
  BarChart3,
  Megaphone,
  AlertTriangle,
  Activity,
  Phone,
} from 'lucide-react'

export default function ExposureManagement() {
  return (
    <div className="space-y-12">
      <TopBar
        title="타지역 노출 관리"
        subtitle="네이버 노출은 등록보다 유지가 어렵습니다 — 자동체크솔루션으로 24시간 감시"
      />

      {/* 1) HERO ─────────────────────────────────── */}
      <Card
        variant="white"
        className="min-h-[280px] relative overflow-hidden bg-gradient-to-br from-rose-50/60 via-white to-amber-50/40 border border-rose-100"
      >
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          EXPOSURE <br /> MONITOR
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-body-sm font-bold mb-3">
            <Radio size={14} /> 네이버노출관리 자동체크솔루션
          </span>
          <h2 className="text-hero-sm text-ink mb-4 leading-tight">
            등록만 해놓고 <span className="text-rose-700">손 놓고 있으면</span><br />
            <span className="text-brand-600">노출은 어느 순간 사라집니다.</span>
          </h2>
          <p className="text-xl text-ink-muted leading-relaxed">
            네이버 1페이지 노출은 <strong className="text-ink">변동성이 매우 큽니다.</strong><br />
            오늘 1페이지였던 키워드가 내일은 3페이지로 밀려있을 수 있습니다.<br />
            <strong className="text-rose-700">매일 직접 검색해 확인하기 어려운 사장님</strong>을 위한 솔루션입니다.
          </p>
        </div>
      </Card>

      {/* 2) 노출 변동 현실 ─────────────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            the reality
          </div>
          <h2 className="text-h2 text-ink">왜 노출 관리가 필요할까요?</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            네이버 플레이스 노출은 살아있는 시스템입니다. 한 번 등록했다고 끝나지 않습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: <AlertTriangle size={22} />,
              title: '경쟁 업체 신규 등록',
              desc: '같은 키워드에 더 좋은 30자 조합을 가진 경쟁자가 등장하면 내 순위가 밀립니다.',
            },
            {
              icon: <Activity size={22} />,
              title: '네이버 알고리즘 변동',
              desc: '주기적인 알고리즘 업데이트로 어제 1페이지였던 키워드가 오늘 사라질 수 있습니다.',
            },
            {
              icon: <Clock size={22} />,
              title: '직접 매일 확인 불가',
              desc: '수십 개 키워드 × 수십 개 지역을 매일 손으로 검색해 확인하는 것은 현실적으로 불가능합니다.',
            },
          ].map((it) => (
            <Card key={it.title} variant="white" className="border border-rose-100 h-full">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center mb-3 shadow-card">
                {it.icon}
              </div>
              <h3 className="text-lg font-bold text-ink mb-2 leading-tight">{it.title}</h3>
              <p className="text-base text-ink-muted leading-relaxed">{it.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* 3) 비교: 직접 vs 자동체크 ────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            comparison
          </div>
          <h2 className="text-h2 text-ink">직접 확인 vs 자동체크솔루션</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card variant="white" className="border border-bg-subtle">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold">
                😓 직접 매일 검색
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '하루 30분~1시간 검색에 소비',
                '키워드를 자주 빠뜨리거나 잊어버림',
                '순위 변동 기록이 남지 않음',
                '문제 발생 시 뒤늦게 알게 됨',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-1" />
                  <span className="text-base text-ink-muted leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="white" className="border-2 border-emerald-300 bg-gradient-to-br from-emerald-50/40 to-white">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-emerald-100 text-emerald-700 text-body-sm font-bold">
                ✅ 자동체크솔루션
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '24시간 자동으로 키워드별 순위 체크',
                '등록한 모든 지역·키워드 일괄 모니터링',
                '순위 변동 이력이 자동 기록·시각화',
                '이탈 즉시 알림으로 빠른 대응',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-1" />
                  <span className="text-base text-ink leading-relaxed font-medium">{t}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* 4) 솔루션 4대 핵심 기능 ─────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            core features
          </div>
          <h2 className="text-h2 text-ink">자동체크솔루션 4대 핵심 기능</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            등록한 타지역서비스의 노출 상태를 자동으로 추적하고 관리합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureCard
            num="01"
            tone="brand"
            icon={<Eye size={22} />}
            title="실시간 순위 모니터링"
            desc="등록한 지역·키워드 조합을 매일 자동으로 검색해 네이버 1페이지 노출 여부를 체크합니다."
            bullets={['지역 × 키워드 매트릭스', '플레이스 섹션 순위 추적', '히스토리 누적']}
          />
          <FeatureCard
            num="02"
            tone="amber"
            icon={<Bell size={22} />}
            title="이탈 즉시 알림"
            desc="1페이지에서 사라지거나 순위가 급락하면 즉시 감지합니다. 뒤늦게 알아 매출이 빠지는 일을 막아줍니다."
            bullets={['순위 이탈 감지', '급락 경보', '즉시 대응 가이드']}
          />
          <FeatureCard
            num="03"
            tone="teal"
            icon={<BarChart3 size={22} />}
            title="히스토리 대시보드"
            desc="모든 키워드의 순위 변동 이력이 자동 기록되어 추세를 한눈에 볼 수 있습니다. 어떤 키워드가 안정적인지, 어떤 키워드가 흔들리는지 데이터로 확인."
            bullets={['일별 순위 그래프', '키워드별 안정도', '지역별 노출률']}
          />
          <FeatureCard
            num="04"
            tone="emerald"
            icon={<Target size={22} />}
            title="개선 키워드 제안"
            desc="이탈한 키워드는 새로운 30자 조합으로 재설계하거나 골든 콤보를 다시 발굴해 노출을 회복할 수 있도록 가이드합니다."
            bullets={['재설계 제안', '대체 키워드', '경쟁 분석 연계']}
          />
        </div>
      </section>

      {/* 5) 자동체크 흐름 (5단계) ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            workflow
          </div>
          <h2 className="text-h2 text-ink">자동체크솔루션 작동 흐름</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
          <FlowCard num="1" icon={<Zap size={20} />} label="등록한 키워드·지역 자동 수집" />
          <FlowConnector />
          <FlowCard num="2" icon={<Eye size={20} />} label="매일 네이버 검색 자동 실행" />
          <FlowConnector />
          <FlowCard num="3" icon={<BarChart3 size={20} />} label="순위 결과 기록·분석" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 mt-2.5">
          <FlowCard num="4" icon={<Bell size={20} />} label="이탈·급락 알림 발송" tone="amber" />
          <FlowConnector />
          <FlowCard num="5" icon={<TrendingUp size={20} />} label="개선 가이드 제공" tone="emerald" />
          <div className="hidden md:block" />
          <div className="hidden md:block" />
        </div>
      </section>

      {/* 6) 매출 흐름 ─────────────────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto py-4 text-center">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white/15 backdrop-blur-sm text-amber-200 text-body-sm font-bold mb-4 border border-white/20">
              💡 보여야 매출이 됩니다
            </span>
            <h2 className="text-h1 text-white mb-4 leading-tight">
              유지되는 노출이<br />
              <span className="text-amber-200">진짜 매출이 됩니다.</span>
            </h2>
            <p className="text-xl text-white/95 leading-relaxed mb-6">
              한 번 1페이지에 떴다고 끝이 아닙니다.<br />
              <strong className="text-white">계속 보여야 계속 전화가 옵니다.</strong>
            </p>

            <Card variant="white" className="bg-white/10 backdrop-blur-sm border border-white/20">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
                <FlowStep tone="white" icon={<Eye size={20} />} label="유지된 노출" />
                <FlowArrowWhite />
                <FlowStep tone="white" icon={<Phone size={20} />} label="지속되는 문의" />
                <FlowArrowWhite />
                <FlowStep tone="white" icon={<TrendingUp size={20} />} label="안정적 매출" />
              </div>
            </Card>
          </div>
        </Card>
      </section>

      {/* 7) 강한 후킹 ─────────────────────────── */}
      <section>
        <Card variant="white" className="relative overflow-hidden bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 text-white">
          <div className="max-w-3xl mx-auto py-6 text-center">
            <Megaphone size={42} className="mx-auto mb-4 text-white" />
            <p className="text-3xl md:text-4xl text-white font-bold leading-tight mb-4">
              모르는 사이에 노출이 사라지면<br />
              <span className="text-amber-100">광고비만 새 나갑니다.</span>
            </p>
            <p className="text-xl text-white/95 leading-relaxed mb-5">
              사장님 대신 매일 24시간 노출을 지켜드립니다.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-5">
              {[
                '직접 검색할 시간 0',
                '이탈 감지 자동화',
                '대응 속도 10배',
              ].map((t) => (
                <div
                  key={t}
                  className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-card bg-white/15 backdrop-blur-sm border border-white/30"
                >
                  <CheckCircle2 size={20} className="text-white shrink-0" />
                  <span className="text-base text-white font-bold">{t}</span>
                </div>
              ))}
            </div>

            <p className="text-2xl text-amber-100 font-bold leading-snug">
              보여야 매출이 됩니다.
            </p>
          </div>
        </Card>
      </section>

      {/* 8) CTA — 무료플랜 ────────────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-2">
            🎁 타지역닷컴 위탁 시 100% 무료
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            지금 등록한 키워드,<br />
            <span className="text-rose-700">자동으로 지켜드립니다</span>
          </h2>
          <p className="text-lg text-ink-muted mt-3 leading-relaxed">
            등록·관리만 맡기시면 자동체크솔루션을 무료로 사용할 수 있습니다.<br />
            <strong className="text-ink">노출이 살아있는 동안에만 매출이 발생합니다.</strong>
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <Card
            variant="white"
            className="relative overflow-hidden ring-2 ring-rose-200 bg-gradient-to-br from-rose-50/40 to-white"
          >
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-[11px] font-bold">
              🎁 FREE PLAN
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center mb-4 shadow-card">
              <ShieldCheck size={26} />
            </div>
            <div className="text-body-sm font-mono text-rose-700 mb-1">CTA</div>
            <h3 className="text-h2 text-ink leading-tight mb-2">
              네이버노출 자동체크 솔루션
            </h3>
            <p className="text-xl font-bold text-rose-700 mb-4 leading-tight">
              무료플랜 신청하기
            </p>
            <ul className="space-y-2 mb-5">
              {[
                '등록 키워드 자동 모니터링',
                '이탈·급락 알림 무료 제공',
                '순위 히스토리 대시보드',
                '개선 키워드 가이드',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-1" />
                  <span className="text-base text-ink leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
            <Link
              to="/intro/monitor"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-pill text-white font-bold text-lg bg-rose-600 hover:bg-rose-700 transition-colors shadow-card"
            >
              무료플랜 신청하기 <ArrowRight size={18} />
            </Link>
          </Card>
        </div>
      </section>
    </div>
  )
}

/* ════════════════════ 하위 컴포넌트 ════════════════════ */

interface FeatureCardProps {
  num: string
  tone: 'brand' | 'amber' | 'teal' | 'emerald'
  icon: React.ReactNode
  title: string
  desc: string
  bullets: string[]
}

function FeatureCard({ num, tone, icon, title, desc, bullets }: FeatureCardProps) {
  const tc = {
    brand: { accent: 'from-brand-500 to-indigo-500', text: 'text-brand-700', dot: 'bg-brand-500' },
    amber: { accent: 'from-amber-500 to-orange-500', text: 'text-amber-700', dot: 'bg-amber-500' },
    teal: { accent: 'from-teal-500 to-cyan-500', text: 'text-teal-700', dot: 'bg-teal-500' },
    emerald: { accent: 'from-emerald-500 to-teal-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  }[tone]
  return (
    <Card variant="white" className="h-full relative">
      <div className="absolute top-4 right-4 text-[28px] leading-none font-light text-ink-watermark/60 select-none">
        {num}
      </div>
      <div
        className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center mb-3 shadow-card`}
      >
        {icon}
      </div>
      <h3 className="text-h3 text-ink leading-tight mb-2">{title}</h3>
      <p className="text-base text-ink-muted leading-relaxed mb-3">{desc}</p>
      <ul className="space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`} />
            <span className={`text-base font-semibold ${tc.text}`}>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function FlowCard({
  num,
  icon,
  label,
  tone = 'brand',
}: {
  num: string
  icon: React.ReactNode
  label: string
  tone?: 'brand' | 'amber' | 'emerald'
}) {
  const tc = {
    brand: 'from-brand-500 to-indigo-500',
    amber: 'from-amber-500 to-orange-500',
    emerald: 'from-emerald-500 to-teal-500',
  }[tone]
  return (
    <Card variant="white" className="text-center h-full md:col-span-1">
      <div
        className={`w-11 h-11 mx-auto rounded-2xl bg-gradient-to-br ${tc} text-white flex items-center justify-center mb-2 shadow-card`}
      >
        {icon}
      </div>
      <div className="text-body-sm font-mono text-ink-muted mb-1">STEP {num}</div>
      <p className="text-base text-ink font-semibold leading-snug">{label}</p>
    </Card>
  )
}

function FlowConnector() {
  return (
    <div className="flex items-center justify-center text-ink-soft md:col-span-1">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowDown size={22} className="md:hidden" />
    </div>
  )
}

function FlowStep({
  tone,
  icon,
  label,
}: {
  tone: 'brand' | 'amber' | 'emerald' | 'white'
  icon: React.ReactNode
  label: string
}) {
  const tc = {
    brand: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    white: 'bg-white/15 text-white border-white/30 backdrop-blur-sm',
  }[tone]
  return (
    <div className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-4 rounded-card border ${tc}`}>
      {icon}
      <span className="text-base font-bold text-center">{label}</span>
    </div>
  )
}

function FlowArrowWhite() {
  return (
    <div className="flex items-center justify-center text-white/80">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowDown size={22} className="md:hidden" />
    </div>
  )
}
