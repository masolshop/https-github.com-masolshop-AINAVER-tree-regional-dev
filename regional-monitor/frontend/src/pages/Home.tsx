/**
 * 홈 (대시보드)
 * 구성:
 *  1) Hero 4카드 비대칭 그리드 (등록/24h/알림/CTA)
 *  2) KPI 메트릭 타일 (4개 - 정확도/검증건수/평균응답/처리량)
 *  3) DATA DRIVEN 섹션 - 실시간 데이터 기반 노출 모니터링
 *  4) 작동 원리 (3-step 워크플로우)
 *  5) 하단 CTA
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import PageSeo from '@/components/seo/PageSeo'
import {
  ArrowRight,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
  ShieldCheck,
  BellRing,
  TrendingUp,
  AlertTriangle,
  Dna,
  Sparkles,
  MapPin,
  Radio,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KAKAO_CHAT_URL } from '@/utils/contact'

import { usePlacesSummary } from '@/hooks/usePlaces'

export default function Home() {
  // 실시간 등록 현황 — 데이터 있으면 실수치로, 없으면 데모 수치
  const summaryQuery = usePlacesSummary()
  const summary = summaryQuery.data
  const hasRealData = (summary?.total ?? 0) > 0
  // 정상률 = (정상 노출 + 변경 노출) / 등록갯수 — 변경 노출도 정상 분류 (Place ID 살아있음)
  const okRate =
    summary && summary.total > 0
      ? (((summary.ok + summary.warning) / summary.total) * 100).toFixed(1)
      : '99.2'

  return (
    <div className="space-y-10">
      <PageSeo
        title="타지역서비스 네이버 노출 자동 체크 및 1페이지 최적화 솔루션"
        description="타지역서비스(070) 사장님을 위한 네이버 플레이스 노출 자동 체크 + 1페이지 노출 최적화 4종 솔루션. 키워드 DNA 분석·발굴·지역 경쟁도·노출관리까지 한 번에."
        path="/"
        keywords={[
          '타지역서비스',
          '타지역닷컴',
          '네이버 플레이스',
          '네이버 1페이지',
          '노출 자동체크',
          '070 가상번호',
          '키워드 DNA',
          '키워드 발굴',
          '지역 경쟁도',
          '플레이스 모니터링',
        ]}
      />
      <TopBar
        title="국내 최초 타지역서비스 최적화 4종 솔루션 무료 플랜 받으세요."
        subtitle="네이버 노출 키워드 DNA 분석, SEO 최적화, 지역 경쟁도 분석, 네이버 노출 자동 체크, 노출 상황을 날마다 알림 받으세요."
      />

      {/* ───────────────────────── 1) Hero 4카드 — 4종 솔루션 컨셉 ───────────────────────── */}
      <section className="grid grid-cols-12 gap-4">
        {/* 01 - 키워드 DNA 분석 (큰 좌측, 화이트) */}
        <Card variant="white" watermarkNumber="01" className="col-span-12 md:col-span-7 min-h-[230px]">
          <div className="pt-12">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-bold mb-3">
              <Dna size={14} /> SOLUTION 01
            </div>
            <h3 className="text-h2 text-ink mb-3 break-keep">
              네이버 노출
              <br />
              키워드 DNA 분석
            </h3>
            <p className="text-body-sm text-ink-muted leading-relaxed max-w-md break-keep">
              상호명을 6대 DNA(MAIN·ACTION·MATERIAL·PLACE·BRAND·TAG)로 1초 만에 분해.
              내 상호가 왜 검색에 안 잡히는지 데이터로 알려드립니다.
            </p>
            <div className="mt-6 flex items-center gap-2 text-caption text-ink-soft">
              <ShieldCheck size={14} className="text-brand-500" />
              <span>1,875개 등록 업체 · 3,574개 키워드 사전 검증</span>
            </div>
          </div>
        </Card>

        {/* 02 - SEO 최적화 (우측, 딥네이비) */}
        <Card
          variant="dark"
          watermarkNumber="02"
          className="col-span-12 md:col-span-5 min-h-[230px]"
        >
          <div className="pt-12">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-white/10 text-white text-caption font-bold mb-3">
              <Sparkles size={14} /> SOLUTION 02
            </div>
            <h3 className="text-h2 text-white mb-3 break-keep">
              네이버 1페이지
              <br />
              SEO 최적화
            </h3>
            <p className="text-body-sm text-white/70 leading-relaxed break-keep">
              레드오션 검색량 키워드는 그만.
              회선수 50만건이 검증한 청정 황금 키워드만 골라드립니다.
            </p>
          </div>
        </Card>

        {/* 03 - 지역 경쟁도 분석 (연그레이) */}
        <Card
          variant="subtle"
          watermarkNumber="03"
          className="col-span-12 md:col-span-5 min-h-[230px]"
        >
          <div className="pt-12">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-teal-50 text-teal-700 text-caption font-bold mb-3">
              <MapPin size={14} /> SOLUTION 03
            </div>
            <h3 className="text-h2 text-ink mb-2 break-keep">
              지역 경쟁도 분석
            </h3>
            <p className="text-body-sm text-ink-muted leading-relaxed break-keep">
              전국 4,819곳 동 단위 4단계 등급으로 진입 우선순위 결정.
              사장님이 들어갈 수 있는 "빈 자리"를 데이터로 찾아드립니다.
            </p>
          </div>
        </Card>

        {/* 04 - 노출 자동 체크 + 일일 알림 (CTA, 큰 우측) */}
        <Card variant="cta" className="col-span-12 md:col-span-7 min-h-[230px]">
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-white/15 text-white text-caption font-bold mb-3">
                <Radio size={14} /> SOLUTION 04
              </div>
              <h3 className="text-h1 text-white mb-2 break-keep">
                네이버 노출 자동 체크
                <br />
                노출 상황을 날마다 알림
              </h3>
              <p className="text-body-sm text-white/85 break-keep">
                매일 새벽 3시 4중 자동 검증. 노출 변경 즉시 이메일·카카오 알림으로
                내 매장의 상태를 매일 받아보세요.
              </p>
            </div>
            <div className="mt-5">
              <a
                href={KAKAO_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-cta-white"
              >
                카카오톡 무료 상담 <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </Card>
      </section>

      {/* ───────────────────────── 2) KPI 메트릭 타일 ───────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
              real-time metrics
            </div>
            <h2 className="text-h2 text-ink">신뢰할 수 있는 검증 성능</h2>
          </div>
          <span className="text-caption text-ink-soft">
            {hasRealData ? '내 등록 기준 실시간' : '최근 30일 누적 기준 (데모)'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {hasRealData && summary ? (
            <>
              <MetricTile
                icon={<Activity size={18} />}
                label="등록 070 번호"
                value={summary.total.toLocaleString()}
                unit="건"
                trend={`pending ${summary.pending}`}
                tone="info"
              />
              <MetricTile
                icon={<CheckCircle2 size={18} />}
                label="정상 노출률"
                value={okRate}
                unit="%"
                trend={`${summary.ok}/${summary.total}`}
                tone="success"
              />
              <MetricTile
                icon={<AlertTriangle size={18} />}
                label="변경 노출"
                value={summary.warning.toLocaleString()}
                unit="건"
                trend="재노출 과정의 데이터 변경"
                tone={summary.warning > 0 ? 'info' : 'info'}
              />
              <MetricTile
                icon={<Zap size={18} />}
                label="네이버 미노출"
                value={summary.danger.toLocaleString()}
                unit="건"
                trend="즉시 조치 필요"
                tone={summary.danger > 0 ? 'danger' : 'info'}
              />
            </>
          ) : (
            <>
              <MetricTile
                icon={<CheckCircle2 size={18} />}
                label="검증 정확도"
                value="99.2"
                unit="%"
                trend="+0.4"
                tone="success"
              />
              <MetricTile
                icon={<Activity size={18} />}
                label="누적 검증 건수"
                value="5,420"
                unit="건"
                trend="+312"
                tone="info"
              />
              <MetricTile
                icon={<Clock size={18} />}
                label="평균 응답 시간"
                value="223"
                unit="ms"
                trend="-18ms"
                tone="success"
              />
              <MetricTile
                icon={<Zap size={18} />}
                label="처리량 (병렬 10)"
                value="18.2"
                unit="req/s"
                trend="안정"
                tone="info"
              />
            </>
          )}
        </div>
      </section>

      {/* ───────────────────────── 3) DATA DRIVEN 섹션 ───────────────────────── */}
      <section className="grid grid-cols-12 gap-4">
        {/* 좌측 - DATA DRIVEN 워터마크 + 설명 */}
        <Card
          variant="white"
          className="col-span-12 lg:col-span-5 min-h-[280px] relative"
        >
          <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
            DATA <br />
            DRIVEN
          </div>
          <div className="pt-28">
            <h3 className="text-h2 text-ink mb-3">
              데이터로 증명하는
              <br />
              노출 모니터링
            </h3>
            <p className="text-body-sm text-ink-muted leading-relaxed">
              플레이스 ID, 등록 동, 등록 상호명을 4중으로 검증해
              <br />
              실제 노출 상태를 정확하게 판정합니다.
            </p>
          </div>
        </Card>

        {/* 우측 - 검증 분포 시각화 (간단 막대 차트) */}
        <Card variant="white" className="col-span-12 lg:col-span-7 min-h-[280px]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
                verdict distribution
              </div>
              <h3 className="text-h3 text-ink">최근 검증 결과 분포</h3>
            </div>
            <span className="inline-flex items-center gap-1 text-caption text-status-success font-medium">
              <TrendingUp size={12} /> 정상 비율 +2.1%
            </span>
          </div>

          <div className="space-y-4">
            <DistBar label="정상 노출" count={87} total={100} colorClass="bg-status-success" />
            <DistBar label="변경 노출" count={6} total={100} colorClass="bg-status-info" />
            <DistBar label="상호 불일치" count={4} total={100} colorClass="bg-brand-400" />
            <DistBar label="네이버 미노출" count={3} total={100} colorClass="bg-status-danger" />
          </div>

          <div className="mt-6 pt-4 border-t border-bg-subtle flex items-center justify-between text-caption text-ink-muted">
            <span>전체 100건 기준</span>
            <Link to="/history" className="text-brand-600 font-medium hover:underline inline-flex items-center gap-1">
              전체 이력 보기 <ArrowRight size={12} />
            </Link>
          </div>
        </Card>
      </section>

      {/* ───────────────────────── 4) 4종 솔루션 풀퍼널 워크플로우 ───────────────────────── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            how it works
          </div>
          <h2 className="text-h2 text-ink break-keep">발굴 → 분석 → 진입 → 유지 4단계 풀퍼널</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StepCard
            step="STEP 01"
            icon={<Dna size={20} />}
            title="키워드 DNA 분석"
            desc="상호명을 6대 DNA로 분해해 내 매장이 어떤 키워드로 검색에 잡히는지 즉시 분석합니다."
          />
          <StepCard
            step="STEP 02"
            icon={<Sparkles size={20} />}
            title="SEO 최적화 발굴"
            desc="시드 키워드 1개 → 12~50개 후보 + 4단계 경쟁도(청정/경쟁/과열/포화)로 황금 키워드만 골라드립니다."
          />
          <StepCard
            step="STEP 03"
            icon={<MapPin size={20} />}
            title="지역 경쟁도 분석"
            desc="전국 4,819개 동 단위 4단계 등급으로 진입 우선순위 결정. 등록 작업 리스트 엑셀 다운로드."
          />
          <StepCard
            step="STEP 04"
            icon={<BellRing size={20} />}
            title="일일 노출 자동 알림"
            desc="매일 새벽 3시 4중 자동 검증. 노출 변경 즉시 이메일·카카오로 알려드립니다."
          />
        </div>
      </section>

      {/* ───────────────────────── 5) 하단 CTA — 3종 카톡 상담 ───────────────────────── */}
      <section>
        <Card variant="dark" className="min-h-[200px]">
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="text-h1 text-white mb-2 break-keep">
                국내 최초 타지역서비스 4종 솔루션 무료 플랜
              </h3>
              <p className="text-body-sm text-white/75 break-keep">
                키워드 DNA 분석 · SEO 최적화 · 지역 경쟁도 분석 · 노출 자동 체크까지
                4종을 모두 무료로 체험하실 수 있습니다.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <a
                href={KAKAO_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-pill bg-white text-ink font-bold text-body hover:bg-amber-50 transition-colors"
              >
                <Sparkles size={16} className="text-amber-500" />
                골든키워드 발굴 무료 상담
                <ArrowRight size={16} />
              </a>
              <a
                href={KAKAO_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-pill bg-white text-ink font-bold text-body hover:bg-teal-50 transition-colors"
              >
                <MapPin size={16} className="text-teal-500" />
                지역 경쟁도 무료 상담
                <ArrowRight size={16} />
              </a>
              <a
                href={KAKAO_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-pill bg-white text-ink font-bold text-body hover:bg-rose-50 transition-colors"
              >
                <Radio size={16} className="text-rose-500" />
                노출 자동 체크 무료 상담
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}

/* ───────────────────────── 서브 컴포넌트 ───────────────────────── */

interface MetricTileProps {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  trend: string
  tone: 'success' | 'info' | 'warning' | 'danger'
}

function MetricTile({ icon, label, value, unit, trend, tone }: MetricTileProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    info: 'text-brand-600 bg-brand-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
  }[tone]

  return (
    <Card variant="white" className="min-h-[140px]">
      <div className="flex items-start justify-between">
        <div
          className={`w-9 h-9 rounded-2xl flex items-center justify-center ${toneClass}`}
        >
          {icon}
        </div>
        <span className="text-caption text-ink-soft font-medium">{trend}</span>
      </div>
      <div className="mt-4">
        <div className="text-caption text-ink-muted mb-1">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-[32px] font-bold text-ink leading-none tracking-tight">
            {value}
          </span>
          <span className="text-body-sm text-ink-muted">{unit}</span>
        </div>
      </div>
    </Card>
  )
}

interface DistBarProps {
  label: string
  count: number
  total: number
  colorClass: string
}

function DistBar({ label, count, total, colorClass }: DistBarProps) {
  const pct = (count / total) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-body-sm text-ink font-medium">{label}</span>
        <span className="text-caption text-ink-muted tabular-nums">
          {count}건 ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 bg-bg-subtle rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

interface StepCardProps {
  step: string
  icon: React.ReactNode
  title: string
  desc: string
}

function StepCard({ step, icon, title, desc }: StepCardProps) {
  return (
    <Card variant="white" className="min-h-[200px]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-caption text-ink-muted font-bold tracking-wider">
          {step}
        </span>
      </div>
      <h4 className="text-h3 text-ink mb-2">{title}</h4>
      <p className="text-body-sm text-ink-muted leading-relaxed">{desc}</p>
    </Card>
  )
}
