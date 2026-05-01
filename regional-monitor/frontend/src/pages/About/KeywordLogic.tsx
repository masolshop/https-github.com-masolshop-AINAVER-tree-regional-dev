/**
 * 타지역 키워드로직
 * - 타지역서비스의 키워드 노출 메커니즘과 DNA 파싱 솔루션 로직 안내
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  Search,
  Layers,
  Cpu,
  GitBranch,
  Target,
  ArrowRight,
} from 'lucide-react'

export default function KeywordLogic() {
  return (
    <div className="space-y-8">
      <TopBar
        title="타지역 키워드로직"
        subtitle="네이버 봇이 타지역 업체 상호를 어떻게 파싱·매칭하는지 — 6 카테고리 DNA 규칙 기반 형태소 분석"
      />

      {/* Hero - 핵심 개념 */}
      <Card variant="white" className="min-h-[220px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          KEYWORD <br /> LOGIC
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-semibold mb-3">
            <Cpu size={12} /> 규칙 기반 (AI 0%)
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            상호 = 키워드의 결합체.<br />
            결합 패턴이 노출을 좌우합니다.
          </h2>
          <p className="text-body text-ink-muted leading-relaxed">
            네이버는 상호명을 단순 문자열이 아닌 <strong className="text-ink">형태소(토큰) 단위</strong>로
            분해하여 카테고리·지역·서비스 키워드와 매칭합니다.
            본 솔루션은 1,875개 등록 상호와 216개 업종 데이터로 <strong className="text-ink">3,574개 토큰 사전</strong>을
            구축하고, 6 카테고리 DNA로 분류해 노출 로직을 가시화합니다.
          </p>
        </div>
      </Card>

      {/* 6 카테고리 DNA */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            6-category dna
          </div>
          <h2 className="text-h2 text-ink">키워드 6 카테고리 DNA</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DnaCard tag="MAIN" title="중심 키워드"
            desc="상호의 핵심 업종어. 하수구·흥신소·누수·보일러·열쇠 등." count={2838} />
          <DnaCard tag="ACTION" title="동작/서비스"
            desc="업무 행위 키워드. 막힘·뚫음·설치·수리·청소·출장 등." count={503} />
          <DnaCard tag="MATERIAL" title="재료/원인"
            desc="대상 자재/원인물. 변기·싱크대·도어락·폐기물 등." count={57} />
          <DnaCard tag="PLACE" title="장소/대상"
            desc="시공 위치. 가정·아파트·상가·공장·화장실 등." count={66} />
          <DnaCard tag="BRAND" title="브랜드"
            desc="제조사/브랜드명. LG·삼성·경동·린나이·귀뚜라미 등." count={40} />
          <DnaCard tag="TAG" title="수식어/태그"
            desc="강조 표현. 24시·전문·업체·센터·당일·긴급 등." count={70} />
        </div>
      </section>

      {/* 파이프라인 */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            pipeline
          </div>
          <h2 className="text-h2 text-ink">파싱 파이프라인 4단계</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StepCard num="1" icon={<Layers size={18} />} title="사전 구축"
            desc="시드 250개 + 자동 n-gram(2-6자, 빈도≥3) → 최장일치 가지치기로 3,574 토큰 라벨링." />
          <StepCard num="2" icon={<GitBranch size={18} />} title="최장일치 토크나이저"
            desc="Trie 기반 Pure Python. 예: 하수구막힘변기뚫음 → [하수구, 막힘, 변기, 뚫음]." />
          <StepCard num="3" icon={<Search size={18} />} title="필터·집계"
            desc="입력 키워드 포함 상호만 추출, 회선수 가중 토큰 빈도 계산." />
          <StepCard num="4" icon={<Target size={18} />} title="DNA 출력"
            desc="6 카테고리 DNA + 골든 콤보(main+modifier) + 매칭 업체 샘플 반환." />
        </div>
      </section>

      {/* 골든 콤보 예시 */}
      <Card variant="white">
        <h3 className="text-h3 text-ink mb-3">골든 콤보 예시 (실제 분석 결과)</h3>
        <div className="space-y-2 text-body-sm">
          <Combo seed="흥신소" combos={['흥신소 찾기', '흥신소 사람찾기', '흥신소 조사', '흥신소 미행']} />
          <Combo seed="하수구" combos={['하수구 고압세척', '하수구 뚫음', '하수구 막힘', '하수구 누수탐지']} />
          <Combo seed="누수" combos={['누수 누수탐지', '누수 방수', '누수 동파', '누수 고압세척']} />
          <Combo seed="보일러" combos={['보일러 누수탐지', '보일러 설치', '보일러 수리', '경동·린나이·귀뚜라미']} />
        </div>
        <p className="text-caption text-ink-muted mt-4">
          ※ 골든 콤보는 main 카테고리 키워드 + 다른 카테고리(action/place/material/tag) 키워드가
          동시 출현하는 가중치 상위 조합입니다. 노출 가능성이 가장 높은 상호 패턴을 의미합니다.
        </p>
      </Card>
    </div>
  )
}

function DnaCard({ tag, title, desc, count }: {
  tag: string; title: string; desc: string; count: number
}) {
  return (
    <Card variant="white" className="h-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-bold tracking-wider">
          {tag}
        </span>
        <span className="text-body font-semibold text-ink">{title}</span>
      </div>
      <p className="text-caption text-ink-muted leading-relaxed mb-3">{desc}</p>
      <div className="text-caption text-ink-muted">
        토큰 수 <span className="font-mono font-semibold text-ink">{count.toLocaleString()}</span>
      </div>
    </Card>
  )
}

function StepCard({ num, icon, title, desc }: {
  num: string; icon: React.ReactNode; title: string; desc: string
}) {
  return (
    <Card variant="white" className="h-full relative">
      <div className="absolute top-3 right-3 text-[28px] leading-none font-light text-ink-watermark/60 select-none">
        {num}
      </div>
      <div className="flex items-center gap-2 mb-2 text-brand-600">
        {icon}
        <span className="text-body font-semibold text-ink">{title}</span>
      </div>
      <p className="text-caption text-ink-muted leading-relaxed">{desc}</p>
    </Card>
  )
}

function Combo({ seed, combos }: { seed: string; combos: string[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5 border-b border-bg-subtle last:border-b-0">
      <span className="font-semibold text-ink min-w-[60px]">{seed}</span>
      <ArrowRight size={14} className="text-ink-muted" />
      {combos.map((c) => (
        <span key={c} className="text-caption px-2 py-0.5 rounded-md bg-bg-subtle text-ink">
          {c}
        </span>
      ))}
    </div>
  )
}
