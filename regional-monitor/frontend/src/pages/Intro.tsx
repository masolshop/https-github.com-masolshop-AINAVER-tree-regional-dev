/**
 * 타지역 4종솔루션 소개 (Public)
 *
 * 4개 솔루션을 무엇/왜/효과 3-블록으로 일관 안내:
 *   1) 타지역키워드 DNA 파싱솔루션          → /keyword-dna
 *   2) 네이버1페이지 노출 키워드 발굴솔루션  → /keyword
 *   3) 지역별 노출경쟁도 분석솔루션          → /competition
 *   4) 네이버노출관리 자동체크솔루션         → /monitor
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  Dna,
  Sparkles,
  MapPin,
  Radio,
  ArrowRight,
  HelpCircle,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  Layers,
} from 'lucide-react'
import { Link } from 'react-router-dom'

interface SolutionData {
  id: string
  num: string
  to: string
  title: string
  shortLabel: string
  tagline: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  accent: string  // tailwind brand color hex/class hint
  what: { headline: string; bullets: string[] }
  why: { headline: string; bullets: string[] }
  effect: { headline: string; metrics: { label: string; value: string }[]; bullets: string[] }
}

const SOLUTIONS: SolutionData[] = [
  {
    id: 'keyword-dna',
    num: '01',
    to: '/keyword-dna',
    title: '타지역키워드 DNA 파싱솔루션',
    shortLabel: 'DNA 파싱',
    tagline: '상호명을 6개 카테고리 DNA로 분해해 노출 로직을 가시화합니다.',
    icon: Dna,
    accent: 'from-brand-500 to-indigo-500',
    what: {
      headline: '상호명 = 키워드의 결합체. 그 DNA를 분해합니다.',
      bullets: [
        '실제 등록 업체 1,875개 상호 + 회선수 가중치(508,854)로 사전 구축',
        '시드 250개 + 자동 n-gram(2~6자, 빈도≥3) → 최장일치 가지치기로 3,574 토큰 라벨링',
        '6 카테고리 분류: MAIN(중심) / ACTION(동작) / MATERIAL(재료) / PLACE(장소) / BRAND(브랜드) / TAG(수식어)',
        '규칙 기반 형태소 분석(AI 0%) — 결과 재현 가능, 분석 시간 평균 8~125ms',
      ],
    },
    why: {
      headline: '왜 필요한가요?',
      bullets: [
        '네이버는 상호명을 단순 문자열이 아닌 토큰 단위로 분해해 검색어와 매칭합니다',
        '"하수구막힘변기뚫음" 같은 결합형 상호가 어떤 키워드에 반응하는지 직관으로는 알 수 없습니다',
        '경쟁사 상호 패턴을 분석하지 못하면 자기 상호 작명·등록이 비효율로 끝납니다',
        '네이버 봇이 인식하는 키워드 풀을 모르면 노출 영역을 의도적으로 설계할 수 없습니다',
      ],
    },
    effect: {
      headline: '어떤 효과가 있나요?',
      metrics: [
        { label: '분석 토큰 수', value: '3,574' },
        { label: '대상 상호', value: '1,875' },
        { label: '평균 응답', value: '< 130ms' },
      ],
      bullets: [
        '경쟁사가 어떤 키워드 조합으로 노출되고 있는지 한눈에 파악 (골든 콤보)',
        '다중 키워드 동시 비교(매트릭스), 토큰 네트워크 그래프, 미커버 영역 자동 추천 제공',
        '내 상호 작명 시 어떤 토큰을 더해야 노출 점수가 오르는지 데이터로 결정',
        'Excel(3시트: DNA 요약 / 골든 콤보 / 매칭 업체) 자동 다운로드',
      ],
    },
  },
  {
    id: 'keyword-discover',
    num: '02',
    to: '/keyword',
    title: '네이버1페이지 노출 키워드 발굴솔루션',
    shortLabel: '키워드 발굴',
    tagline: '실제 회선수 기반으로 1페이지 진입 가능한 신규 키워드를 발굴합니다.',
    icon: Sparkles,
    accent: 'from-amber-500 to-pink-500',
    what: {
      headline: '회선수 데이터로 검증된 황금 키워드를 찾아냅니다.',
      bullets: [
        '실제 등록 업체 회선수(508,854) 가중치를 적용한 키워드 시장 규모 측정',
        '단순 검색량이 아닌 "수익화 가능성" 기준으로 키워드 점수화',
        '시드 키워드 입력 → 자동으로 수식어/장소/브랜드 조합 후보 생성',
        '경쟁도 4단계 분류: 청정(1~5) / 경쟁(6~10) / 과열(11~15) / 포화(16+)',
      ],
    },
    why: {
      headline: '왜 필요한가요?',
      bullets: [
        '검색량만 보고 키워드를 고르면 경쟁이 과열되어 1페이지 진입 자체가 불가능합니다',
        '"내 사업장에서 진입 가능한 틈새 키워드"를 사람이 일일이 떠올리기 어렵습니다',
        '키워드 후보가 100개 이상이면 우선순위 판단에 며칠이 소요됩니다',
        '엑셀 작업으로는 회선수·경쟁도·기회점수를 동시 비교할 수 없습니다',
      ],
    },
    effect: {
      headline: '어떤 효과가 있나요?',
      metrics: [
        { label: '발굴 후보 수', value: '12~50개' },
        { label: '회선수 기준', value: '508K' },
        { label: '경쟁도 단계', value: '4단계' },
      ],
      bullets: [
        '"하수구 → 하수구 화장실막힘"처럼 경쟁 6, 회선 2,341의 청정 키워드를 즉시 발견',
        '기회점수(Opportunity Score = market / (1+log(competition+1))) 자동 산정',
        '시드 1개 입력 → 추천 매트릭스 자동 생성, 의사결정 시간 95% 단축',
        '청정·경쟁 등급 위주의 우선 진입 리스트로 단기간 1페이지 노출률 상승',
      ],
    },
  },
  {
    id: 'competition',
    num: '03',
    to: '/competition',
    title: '지역별 노출경쟁도 분석솔루션',
    shortLabel: '경쟁도 분석',
    tagline: '시군구·동/리 단위로 네이버 1페이지 경쟁업체 수를 정밀 측정합니다.',
    icon: MapPin,
    accent: 'from-teal-500 to-cyan-500',
    what: {
      headline: '키워드 × 지역의 경쟁 강도를 정량화합니다.',
      bullets: [
        '17개 시도 / 약 230개 시군구 / 약 4,819개 동·리 단위 정밀 스캔',
        '두 가지 모드: Fast(시군구 prefix, 5~30초) / Precise(동·리 prefix, 30초~5분)',
        '5단계 경쟁 등급: 청정(1~5) / 경쟁(6~10) / 과열(11~15) / 포화(16+) / 무경쟁(0)',
        '네이버 지도 API 기반 — 동일 노출 기준으로 일원화',
      ],
    },
    why: {
      headline: '왜 필요한가요?',
      bullets: [
        '같은 키워드라도 강남구는 포화, 강원도 정선군은 청정 — 지역마다 진입 난이도가 다릅니다',
        '"우리 지역에 어떤 업종이 비어 있나"를 모르면 타지역 진출 결정을 미룰 수밖에 없습니다',
        '동/리 단위 정밀 데이터가 없으면 진입 가능한 타지역서비스 영역을 찾기 어렵습니다',
        '지역 단위 경쟁도가 한눈에 안 보이면 광고비·등록비를 비효율 영역에 쏟게 됩니다',
      ],
    },
    effect: {
      headline: '어떤 효과가 있나요?',
      metrics: [
        { label: '커버리지', value: '4,819개 동·리' },
        { label: '스캔 모드', value: 'Fast / Precise' },
        { label: '경쟁 등급', value: '5단계' },
      ],
      bullets: [
        '"흥신소 × 정선군 정선읍" 같은 청정 영역을 즉시 발견 → 우선 진입 결정',
        '히트맵으로 시도/시군구별 진입 가능성 시각화',
        '경쟁업체 명단(상호·전화·플레이스 ID·도로명 주소)까지 함께 추출',
        '예상 ROI가 높은 지역부터 070·플레이스 등록 우선순위 자동 정렬',
      ],
    },
  },
  {
    id: 'monitor',
    num: '04',
    to: '/monitor',
    title: '네이버노출관리 자동체크솔루션',
    shortLabel: '노출관리',
    tagline: '한 번 등록하면 매일 자동으로 검증 — 노출 사라짐을 24시간 이내 감지합니다.',
    icon: Radio,
    accent: 'from-rose-500 to-orange-500',
    what: {
      headline: '플레이스 ID 기반 4중 검증 — 변하지 않는 고유키로 직접 조회.',
      bullets: [
        '070 번호 한 개만 등록하면 플레이스 ID·등록 동·상호명을 자동 추출',
        '4중 검증: 페이지 생존 / 070 일치 / 등록 동 일치 / 상호명 일치',
        '매일 새벽 03:00 KST 자동 실행 — 변경 발생 시 즉시 이메일 알림',
        '응답 0.2~0.3초/건, 정확도 99% 이상, 차단 위험 거의 없음',
      ],
    },
    why: {
      headline: '왜 필요한가요?',
      bullets: [
        '통신사 변경 → 070 번호 변경 → 플레이스 ID 변경 → 노출 사라짐이 빈번하게 발생합니다',
        '네이버 로직 변경으로 며칠 뒤 노출이 사라져도 직접 검색하지 않으면 알 수 없습니다',
        '"070 서초동 등록인데 인계동 노출" 같은 변경 노출을 수작업으로 잡기 어렵습니다',
        '매번 엑셀 업로드 → 1회성 검증 → 결과 확인은 시간만 잡아먹고 누락이 잦습니다',
      ],
    },
    effect: {
      headline: '어떤 효과가 있나요?',
      metrics: [
        { label: '감지 지연', value: '< 24시간' },
        { label: '검증 정확도', value: '97.2%' },
        { label: '응답 속도', value: '0.2~0.3초/건' },
      ],
      bullets: [
        '노출 사라짐을 다음 날 알림으로 인지 → 매출 누락 최소화',
        'DEAD / DONG_MISMATCH / REGION_MISMATCH / OK 4종 verdict로 즉시 원인 파악',
        '구글시트 실시간 연동(Pro+) → 사내 대시보드와 즉시 연결',
        '7일 무료 체험 — 카드 등록 없이 5개 번호까지 자동 검증 시작 가능',
      ],
    },
  },
]

export default function Intro() {
  return (
    <div className="space-y-10">
      <TopBar
        title="타지역 4종솔루션 소개"
        subtitle="타지역서비스 운영에 꼭 필요한 4개 솔루션 — 무엇이고, 왜 필요하고, 어떤 효과가 있는지 안내합니다."
      />

      {/* ─── Hero ─── */}
      <Card variant="white" className="min-h-[220px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          4 IN ONE <br /> SUITE
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-semibold mb-3">
            <Layers size={12} /> 타지역서비스 4종 통합 솔루션
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            발굴 → 분석 → 진입 → 유지<br />
            전 단계를 4개 솔루션이 책임집니다.
          </h2>
          <p className="text-body text-ink-muted leading-relaxed">
            DNA 파싱으로 <strong className="text-ink">키워드 구조를 해부</strong>하고,
            발굴 솔루션으로 <strong className="text-ink">진입 가능한 황금 키워드</strong>를 찾고,
            경쟁도 분석으로 <strong className="text-ink">청정 지역</strong>을 식별하고,
            노출관리 솔루션으로 <strong className="text-ink">매출 누락을 24시간 이내 차단</strong>합니다.
          </p>
        </div>
      </Card>

      {/* ─── 솔루션 인덱스 (퀵 점프) ─── */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SOLUTIONS.map((s) => {
            const Icon = s.icon
            return (
              <a
                key={s.id}
                href={`#sol-${s.id}`}
                className="group flex flex-col items-start gap-2 p-4 rounded-card bg-white shadow-card hover:shadow-card-lg transition-shadow"
              >
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${s.accent} text-white flex items-center justify-center shrink-0`}>
                  <Icon size={20} />
                </div>
                <div className="text-caption text-ink-muted font-mono">{s.num}</div>
                <div className="text-body font-bold text-ink leading-tight">
                  {s.shortLabel}
                </div>
              </a>
            )
          })}
        </div>
      </section>

      {/* ─── 4개 솔루션 상세 ─── */}
      {SOLUTIONS.map((s) => (
        <SolutionSection key={s.id} data={s} />
      ))}

      {/* ─── 통합 효과 ─── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            integrated workflow
          </div>
          <h2 className="text-h2 text-ink">4종 통합 사용 시 워크플로우</h2>
        </div>
        <Card variant="white">
          <ol className="space-y-3 text-body-sm text-ink leading-relaxed">
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-brand-500 text-white font-bold flex items-center justify-center text-caption">1</span>
              <div>
                <strong className="text-ink">DNA 파싱</strong>으로 진출하려는 업종의 토큰 구조 파악
                <span className="text-ink-muted"> — 어떤 카테고리 키워드가 노출의 중심인지 식별</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-amber-500 text-white font-bold flex items-center justify-center text-caption">2</span>
              <div>
                <strong className="text-ink">키워드 발굴</strong>로 청정/경쟁 등급의 황금 키워드 수집
                <span className="text-ink-muted"> — 기회점수 기반 우선순위 결정</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-teal-500 text-white font-bold flex items-center justify-center text-caption">3</span>
              <div>
                <strong className="text-ink">경쟁도 분석</strong>으로 동·리 단위 진입 가능 지역 매핑
                <span className="text-ink-muted"> — 시군구별 청정 영역 우선 선택</span>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-rose-500 text-white font-bold flex items-center justify-center text-caption">4</span>
              <div>
                <strong className="text-ink">노출관리 자동체크</strong>로 등록 후 매일 검증
                <span className="text-ink-muted"> — 노출 사라짐 24시간 이내 감지로 매출 보호</span>
              </div>
            </li>
          </ol>
        </Card>
      </section>

      {/* ─── 하단 CTA ─── */}
      <Card variant="cta" className="min-h-[180px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div>
            <h3 className="text-h1 text-white mb-2">
              4종 솔루션, 지금 무료로 시작해 보세요
            </h3>
            <p className="text-body-sm text-white/85">
              7일 무료 체험 · 카드 등록 불필요 · DNA 파싱·키워드 발굴·경쟁도·노출관리 모두 포함
            </p>
          </div>
          <Link to="/keyword-dna" className="btn-cta-white">
            DNA 파싱 시작하기 <ArrowRight size={16} />
          </Link>
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────── 서브 컴포넌트 ───────────────────────── */

function SolutionSection({ data }: { data: SolutionData }) {
  const Icon = data.icon
  return (
    <section id={`sol-${data.id}`} className="scroll-mt-6">
      {/* 헤더 */}
      <Card variant="white" className="relative overflow-hidden">
        <div className="absolute top-5 right-7 text-[60px] leading-none font-light text-ink-watermark/40 select-none pointer-events-none tracking-tight">
          {data.num}
        </div>
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${data.accent} text-white flex items-center justify-center shrink-0 shadow-card`}>
            <Icon size={26} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-caption text-ink-muted font-mono mb-1">SOLUTION {data.num}</div>
            <h2 className="text-h2 text-ink leading-tight">{data.title}</h2>
            <p className="text-body-sm text-ink-muted mt-2 leading-relaxed">{data.tagline}</p>
            <Link
              to={data.to}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-pill bg-brand-500 text-white text-caption font-semibold hover:bg-brand-600 transition-colors"
            >
              솔루션으로 이동 <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </Card>

      {/* 무엇 / 왜 / 효과 3-블록 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <BlockCard
          tone="brand"
          icon={<HelpCircle size={18} />}
          tag="WHAT"
          title="무엇인지"
          headline={data.what.headline}
          bullets={data.what.bullets}
        />
        <BlockCard
          tone="warning"
          icon={<AlertTriangle size={18} />}
          tag="WHY"
          title="왜 필요한가요?"
          headline={data.why.headline}
          bullets={data.why.bullets}
        />
        <EffectCard
          tone="success"
          icon={<TrendingUp size={18} />}
          tag="EFFECT"
          title="어떤 효과가 있나요?"
          headline={data.effect.headline}
          metrics={data.effect.metrics}
          bullets={data.effect.bullets}
        />
      </div>
    </section>
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

const TONE_CLASS: Record<BlockCardProps['tone'], { bg: string; text: string; border: string }> = {
  brand: {
    bg: 'bg-brand-50',
    text: 'text-brand-700',
    border: 'border-brand-200',
  },
  warning: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
  success: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
}

function BlockCard({ tone, icon, tag, title, headline, bullets }: BlockCardProps) {
  const t = TONE_CLASS[tone]
  return (
    <Card variant="white" className="h-full flex flex-col">
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill ${t.bg} ${t.text} text-[10px] font-bold tracking-wider self-start mb-3`}>
        {icon}
        {tag}
      </div>
      <h3 className="text-body font-bold text-ink mb-1">{title}</h3>
      <p className="text-body-sm text-ink leading-relaxed mb-4 font-medium">{headline}</p>
      <ul className="space-y-2 mt-auto">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-caption text-ink-muted leading-relaxed">
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

function EffectCard({ tone, icon, tag, title, headline, metrics, bullets }: EffectCardProps) {
  const t = TONE_CLASS[tone]
  return (
    <Card variant="white" className="h-full flex flex-col">
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill ${t.bg} ${t.text} text-[10px] font-bold tracking-wider self-start mb-3`}>
        {icon}
        {tag}
      </div>
      <h3 className="text-body font-bold text-ink mb-1">{title}</h3>
      <p className="text-body-sm text-ink leading-relaxed mb-3 font-medium">{headline}</p>

      {/* 지표 */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {metrics.map((m) => (
          <div key={m.label} className={`rounded-xl border ${t.border} ${t.bg}/40 px-2 py-2 text-center`}>
            <div className={`text-body font-bold ${t.text}`}>{m.value}</div>
            <div className="text-[10px] text-ink-muted leading-tight mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <ul className="space-y-2 mt-auto">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-caption text-ink-muted leading-relaxed">
            <CheckCircle2 size={14} className={`shrink-0 mt-0.5 ${t.text}`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
