/**
 * 타지역서비스란 무엇인가? — 도식·인포그래픽 중심 풀버전
 * (원문 문구 최대 보존 / 마케팅 감정 호소 톤)
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import PageSeo, { buildBreadcrumbJsonLd } from '@/components/seo/PageSeo'
import { RelatedLinks, ALL_RELATED_LINKS } from '@/components/seo/RelatedLinks'
import { KAKAO_CHAT_URL } from '@/utils/contact'
import {
  Sparkles,
  MapPin,
  Search,
  Building2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Target,
  Wallet,
  Wrench,
  ShieldCheck,
  ArrowRight,
  ArrowDown,
  Eye,
  EyeOff,
  Users,
  Megaphone,
  Lightbulb,
  Compass,
  ChevronRight,
  Star,
  Zap,
} from 'lucide-react'

export default function WhatIs() {
  return (
    <div className="space-y-12">
      <PageSeo
        title="타지역서비스란 무엇인가? — 네이버플레이스 확장 전략"
        description="타지역서비스는 영업 깃발을 여러 지역에 꽂아 고객 통로를 넓히는 네이버 플레이스 확장 전략입니다."
        path="/about/what-is"
        keywords={[
          '타지역서비스',
          '타지역서비스란',
          '네이버플레이스 확장',
          '플레이스 노출 전략',
          '070 가상번호',
          '지역 확장',
          '타지역닷컴',
        ]}
        jsonLd={buildBreadcrumbJsonLd([
          { name: '홈', path: '/' },
          { name: '타지역서비스 안내', path: '/about/what-is' },
          { name: '타지역서비스란?', path: '/about/what-is' },
        ])}
      />
      <TopBar
        title="타지역서비스란 무엇인가?"
        subtitle="고객을 여러 지역에서 만나게 하는 네이버플레이스 확장 전략"
      />

      {/* ───────────────── 1) HERO ───────────────── */}
      <Card variant="white" className="min-h-[280px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          WHAT <br /> IS IT?
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-semibold mb-3">
            <Sparkles size={14} /> 네이버플레이스 지역 확장 전략
          </span>
          <h1 className="text-hero-sm text-ink mb-4 leading-tight">
            타지역서비스는<br />
            네이버 플레이스에 사장님의 <span className="text-brand-600">영업 깃발</span>을<br />
            여러 지역에 꽂아 <span className="text-brand-600">고객을 만나는 통로</span>를<br />
            확장하는 전략입니다.
          </h1>
          <p className="text-xl text-ink-muted leading-relaxed">
            넓은 지역에서 사장님의 플레이스가 <strong className="text-ink">고객에게 발견되게 해야</strong><br />
            <strong className="text-ink">문의 전화가 늘어납니다.</strong>
          </p>
        </div>
      </Card>

      {/* ───────────────── 2) 문제 인식 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">problem</div>
          <h2 className="text-h2 text-ink">하지만 현실은 어떨까요?</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            출장수리, 설치, 공사, 렌탈, 배달, 방문상담 업종은 사무실 근처에서만 영업하지 않습니다.
          </p>
        </div>

        {/* 영업 가능 지역 vs 실제 노출 도식 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 좌: 실제 영업 가능 지역 */}
          <Card variant="white" className="border border-emerald-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold">
                ✅ 실제 영업 가능 지역
              </span>
            </div>
            <h3 className="text-h3 text-ink mb-4">사장님은 어디든 갈 수 있습니다</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {['강남도 갈 수 있고', '송파도 갈 수 있고', '수원도 갈 수 있고', '인천도 갈 수 있습니다'].map((t) => (
                <div key={t} className="flex items-center gap-2 px-3 py-3 rounded-card bg-emerald-50/60 border border-emerald-100">
                  <MapPin size={16} className="text-emerald-600 shrink-0" />
                  <span className="text-lg text-ink font-medium">{t}</span>
                </div>
              ))}
            </div>
            <p className="text-lg text-ink-muted leading-relaxed mt-4">
              실제 영업 가능 지역은 <strong className="text-ink">매우 넓습니다.</strong>
            </p>
          </Card>

          {/* 우: 네이버 노출 한계 */}
          <Card variant="white" className="border border-rose-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-body-sm font-bold">
                🚫 네이버 지도 노출 현실
              </span>
            </div>
            <h3 className="text-h3 text-ink mb-4">하지만 네이버는 한 곳만 보여줍니다</h3>
            <div className="relative h-[140px] rounded-card bg-rose-50/40 border border-rose-100 flex items-center justify-center">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1 p-3 opacity-30">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="rounded bg-rose-100/60" />
                ))}
              </div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-card">
                  <MapPin size={22} />
                </div>
                <div className="text-base font-bold text-rose-700 mt-2">사무실 주소 한 곳</div>
              </div>
            </div>
            <p className="text-lg text-ink-muted leading-relaxed mt-4">
              실제 영업 가능 지역은 넓은데, 네이버 지도에는 <strong className="text-rose-700">주소지 한 곳에서만 노출</strong>된다면?
            </p>
          </Card>
        </div>

        {/* 결론 메시지 */}
        <Card variant="white" className="mt-5 bg-gradient-to-r from-amber-50 via-rose-50 to-amber-50 border border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle size={26} className="text-amber-600 shrink-0 mt-1" />
            <div>
              <h3 className="text-2xl text-ink font-bold mb-3 leading-snug">사장님은 지금도 잠재고객의 상당수를 조용히 놓치고 있을 수 있습니다.</h3>
              <p className="text-xl text-ink leading-relaxed">
                <strong className="text-rose-700">고객이 없는 것이 아닙니다.</strong><br />
                <strong className="text-rose-700">고객이 사장님을 못 찾고 있는 것입니다.</strong>
              </p>
              <p className="text-lg text-ink-muted leading-relaxed mt-3">
                이 구조적 문제를 해결하는 방법, 그것이 바로 <strong className="text-brand-700">타지역서비스</strong>입니다.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* ───────────────── 3) 고객 검색 행동 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">customer behavior</div>
          <h2 className="text-h2 text-ink">고객은 사장님 주소를 검색하지 않습니다</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">고객은 이렇게 검색합니다.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
          {[
            '부천 보일러 수리',
            '인천 에어컨 설치',
            '송파 누수 탐지',
            '강남 출장 수리',
            '수원 입주청소',
            '분당 렌탈 상담',
            '일산 철거 공사',
          ].map((q) => (
            <Card key={q} variant="white" className="border border-bg-subtle hover:border-brand-300 transition-colors">
              <div className="flex items-center gap-2">
                <Search size={18} className="text-brand-500 shrink-0" />
                <span className="text-lg text-ink font-semibold">{q}</span>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BulletCard tone="muted" title="고객은 내 회사 이름을 모릅니다" />
          <BulletCard tone="muted" title="내 사무실 주소도 모릅니다" />
          <BulletCard tone="muted" title="내가 얼마나 오래 일했는지도 모릅니다" />
        </div>

        <Card variant="white" className="mt-5 bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200">
          <div className="flex items-start gap-3">
            <Eye size={26} className="text-brand-600 shrink-0 mt-1" />
            <div>
              <div className="text-base text-brand-700 font-bold uppercase tracking-wider mb-2">고객이 보는 것은 단 하나</div>
              <h3 className="text-2xl text-ink font-bold mb-4 leading-snug">"지금 내가 찾는 지역에 이 업체가 보이는가?"</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center gap-2 px-4 py-3.5 rounded-card bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                  <span className="text-lg text-ink">보이면 → <strong className="text-emerald-700">전화합니다</strong></span>
                </div>
                <div className="flex items-center gap-2 px-4 py-3.5 rounded-card bg-rose-50 border border-rose-200">
                  <XCircle size={20} className="text-rose-600 shrink-0" />
                  <span className="text-lg text-ink">안 보이면 → <strong className="text-rose-700">경쟁사에 전화합니다</strong></span>
                </div>
              </div>
              <p className="text-lg text-ink-muted leading-relaxed mt-4">
                네이버 지도에서 보이지 않는다는 것은 단순히 노출이 안 되는 문제가 아닙니다.<br />
                <strong className="text-rose-700">그 지역 고객의 선택지에서 우리 업체가 사라지는 것</strong>입니다.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* ───────────────── 4) 타지역서비스란? — 정의 + 깃발 도식 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">definition</div>
          <h2 className="text-h2 text-ink">타지역서비스란?</h2>
        </div>

        <Card variant="white" className="bg-gradient-to-br from-brand-50/50 to-white border border-brand-100">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
            {/* 좌: 정의 텍스트 */}
            <div className="lg:col-span-3">
              <p className="text-xl text-ink leading-relaxed mb-4">
                타지역서비스는 <strong className="text-brand-700">본사나 사무실은 한 곳만 운영하더라도</strong><br />
                가상번호 또는 지역별 전화번호를 활용해<br />
                원하는 지역의 네이버플레이스에 내 업체를 등록하고 노출시키는<br />
                <strong className="text-brand-700">지역 확장형 플레이스 마케팅 전략</strong>입니다.
              </p>
              <p className="text-lg text-ink-muted leading-relaxed mb-4">
                기존 네이버플레이스 구조에서는 사업장 주소지를 기준으로 노출이 제한되는 경우가 많습니다.
                문제는 출장, 방문, 배달, 설치, 공사, 상담 업종처럼 <strong className="text-ink">실제 영업 범위가 넓은 사업자</strong>도
                주소지 주변 고객에게만 노출되는 한계를 겪는다는 것입니다.
              </p>
              <p className="text-lg text-ink-muted leading-relaxed">
                타지역서비스는 이 물리적 한계를 넘어섭니다.<br />
                <strong className="text-ink">실제 매장을 새로 임대하지 않아도, 직원을 지역마다 상주시킬 필요가 없어도,</strong>
                사장님이 원하는 지역에 온라인 영업 거점을 만들어 고객 접점을 늘릴 수 있습니다.
              </p>
            </div>

            {/* 우: 깃발 도식 */}
            <div className="lg:col-span-2">
              <FlagDiagram />
            </div>
          </div>
        </Card>

        {/* 한 줄 요약 */}
        <Card variant="white" className="mt-5 bg-brand-600 text-white">
          <div className="flex items-center gap-3">
            <Lightbulb size={32} className="shrink-0" />
            <p className="text-2xl leading-snug font-medium">
              쉽게 말해, 타지역서비스는 <strong>네이버 지도 위에 사장님의 영업 깃발을 여러 지역에 꽂는 전략</strong>입니다.
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 5) 왜 지금 필요한가? 3가지 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">why now</div>
          <h2 className="text-h2 text-ink">왜 지금 타지역서비스가 필요한가?</h2>
        </div>

        <div className="space-y-5">
          {/* 1 */}
          <ReasonCard
            num="01"
            tone="brand"
            title="주소지 한계를 넘어 노출 범위를 넓힐 수 있습니다"
            lead="대부분의 사장님이 네이버플레이스 마케팅 효과를 제대로 보지 못하는 이유는 실력이 부족해서가 아닙니다. 노출 지역이 너무 좁기 때문입니다."
            bullets={[
              '네이버 지도는 사용자의 위치와 검색 지역을 기반으로 가까운 업체를 우선 노출하는 구조',
              '아무리 실력이 좋아도 해당 지역에 등록되어 있지 않으면 고객은 우리 업체를 발견할 수 없음',
              '출동 가능한 지역, 상담 가능한 지역, 영업하고 싶은 지역에 우리 업체를 노출시켜 줍니다',
              '한 곳의 사업장으로도 여러 행정동, 여러 상권, 여러 지역에 내 업체의 존재를 알릴 수 있습니다',
            ]}
            icon={<Compass size={24} />}
          />
          {/* 2 */}
          <ReasonCard
            num="02"
            tone="amber"
            title="고객이 검색하는 순간에 우리 업체가 보입니다"
            lead="고객은 막연하게 검색하지 않습니다. 대부분은 지역명 + 서비스명으로 검색합니다."
            customBlock={<IntentTable />}
            bullets={[
              '우리 업체가 그 지역 플레이스에 노출되면 고객이 자연스럽게 클릭하고 전화할 가능성이 높아집니다',
              '단순 업체명 노출이 아니라 "지역명 + 핵심 키워드 조합"을 공략해 문의 전환율을 높이는 전략',
              '"우리 동네에서 바로 가능한 업체"로 인식되어 전화 문의 확률이 훨씬 높아집니다',
            ]}
            icon={<Target size={24} />}
          />
          {/* 3 */}
          <ReasonCard
            num="03"
            tone="teal"
            title="지점을 늘리지 않고도 온라인 영업소를 확장할 수 있습니다"
            lead="오프라인 지점을 하나 더 내는 것은 쉽지 않습니다. 임대료, 보증금, 직원, 간판, 관리비… 매달 고정비가 계속 나갑니다."
            bullets={[
              '실제 지점을 무리하게 늘리는 방식이 아니라 온라인상에 지역별 노출 거점을 확보하는 방식',
              '하나의 사업장을 운영하면서도 여러 지역 고객에게 업체를 알릴 수 있습니다',
              '지점은 늘리지 않고, 고객 접점은 늘리는 방식 — 플레이스 마케팅의 새로운 패러다임',
            ]}
            icon={<Building2 size={24} />}
          />
        </div>
      </section>

      {/* ───────────────── 6) 핵심 효과 5가지 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">5 effects</div>
          <h2 className="text-h2 text-ink">타지역서비스의 핵심 효과 5가지</h2>
        </div>

        <div className="space-y-4">
          <EffectRow
            num="1"
            tone="brand"
            icon={<MapPin size={22} />}
            title="원하는 지역을 선택해 노출할 수 있습니다"
            body="사장님이 실제로 영업 가능한 지역을 선택해 네이버플레이스에 업체를 등록하고 노출시키는 방식입니다."
            example="예: 본사는 부천에 있어도 인천, 시흥, 광명, 안산, 수원, 강남, 송파 등 서비스 가능한 지역을 전략적으로 선택"
            highlight="단순 등록이 아닙니다. 고객이 있는 지역에 사장님의 업체를 미리 배치하는 것입니다."
          />
          <EffectRow
            num="2"
            tone="amber"
            icon={<Users size={22} />}
            title="여러 지역에서 전화문의 기회를 만들 수 있습니다"
            body="노출 지역이 늘어나면 고객이 사장님의 번호를 발견할 기회도 늘어납니다."
            example="한 지역에만 보이는 업체와 10개 지역에 보이는 업체의 문의 기회는 다를 수밖에 없습니다."
            highlight='"보이는 순간"을 여러 지역으로 확장시켜 줍니다.'
          />
          <EffectRow
            num="3"
            tone="emerald"
            icon={<Wallet size={22} />}
            title="광고비 부담을 줄이면서 운영할 수 있습니다"
            body="검색광고는 클릭할 때마다 비용이 발생합니다. 실수 클릭, 비교만 하고 나가도, 전화 연결 안 돼도 비용이 나갑니다."
            example="동 하나에 단돈 1,000원이면 됩니다. 가상 전화번호 회선 기반의 예측 가능한 고정비 구조."
            highlight="플레이스를 몇 번 보든, 클릭하든, 전화하든 — 클릭당 비용이 계속 빠지는 구조와 다릅니다."
          />
          <EffectRow
            num="4"
            tone="rose"
            icon={<Wrench size={22} />}
            title="출장·방문·공사·수리·상담 업종에 강합니다"
            body="고객이 있는 곳으로 갈 수 있는 업종이라면, 고객이 검색하는 지역에도 보여야 합니다."
            customBlock={<IndustryTable />}
          />
          <EffectRow
            num="5"
            tone="indigo"
            icon={<ShieldCheck size={22} />}
            title="전문 관리가 필요합니다"
            body="타지역서비스는 단순히 업체 정보를 입력한다고 끝나는 작업이 아닙니다. 네이버 정책·로직·등록 기준은 계속 바뀝니다."
            example="중요한 것은 대량 등록 자체가 아니라 안정적인 등록, 노출 유지, 키워드 관리, 지역 전략, 문의 전환 관리입니다."
            highlight="목적은 하나입니다 — 고객 문의를 늘리고, 매출을 만드는 것."
          />
        </div>
      </section>

      {/* ───────────────── 7) 단순 꼼수가 아닙니다 ───────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-indigo-50 to-brand-50 border border-indigo-200">
          <div className="text-center max-w-3xl mx-auto py-4">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white text-indigo-700 text-body-sm font-bold mb-4 shadow-sm">
              <Star size={14} /> THE TRUTH
            </span>
            <h2 className="text-h2 text-ink mb-4">타지역서비스는 단순한 꼼수가 아닙니다</h2>
            <p className="text-xl text-ink-muted leading-relaxed mb-5">
              타지역서비스를 단순히 "여러 지역에 업체를 등록하는 방법" 정도로 생각하면 안 됩니다.<br />
              진짜 핵심은 <strong className="text-ink">고객의 검색 행동을 이해하는 것</strong>입니다.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {['필요할 때 검색합니다', '가까운 곳을 찾습니다', '바로 전화 가능한 업체를 찾습니다', '지도에 보이는 업체를 믿습니다'].map((t) => (
                <div key={t} className="px-3 py-4 rounded-card bg-white border border-indigo-100 shadow-sm">
                  <CheckCircle2 size={22} className="text-indigo-500 mx-auto mb-2" />
                  <span className="text-base text-ink font-medium">{t}</span>
                </div>
              ))}
            </div>

            <p className="text-xl text-ink leading-relaxed">
              <strong className="text-indigo-700">사장님은 고객이 검색하는 그 지역에 있어야 합니다.</strong><br />
              물리적으로 매장이 없어도, 실제로 서비스를 제공할 수 있다면 온라인상에서 고객에게 보여야 합니다.<br />
              <span className="text-3xl text-ink font-bold mt-3 inline-block">이것이 타지역서비스의 본질입니다.</span>
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 8) 사장님이 놓치는 것 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">missing</div>
          <h2 className="text-h2 text-ink">사장님이 지금 놓치고 있는 것</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            사장님이 놓치고 있는 것은 고객이 아닐 수 있습니다.<br />
            사장님이 놓치고 있는 것은 <strong className="text-rose-700">고객에게 발견될 기회</strong>입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          {[
            { icon: <EyeOff size={20} />, t: '우리 업체가 보이지 않으면 고객은 우리 실력을 알 수 없습니다' },
            { icon: <EyeOff size={20} />, t: '우리 업체가 보이지 않으면 고객은 가격을 물어볼 수 없습니다' },
            { icon: <EyeOff size={20} />, t: '우리 업체가 보이지 않으면 고객은 상담할 수도 없습니다' },
            { icon: <EyeOff size={20} />, t: '우리 업체가 보이지 않으면 그 고객은 경쟁사에게 갑니다' },
          ].map((b) => (
            <Card key={b.t} variant="white" className="border border-rose-100 bg-rose-50/30">
              <div className="flex items-start gap-3">
                <span className="text-rose-500 mt-0.5">{b.icon}</span>
                <span className="text-lg text-ink leading-relaxed">{b.t}</span>
              </div>
            </Card>
          ))}
        </div>

        <Card variant="white" className="bg-emerald-50 border border-emerald-200">
          <p className="text-xl text-ink leading-relaxed text-center">
            결국 타지역서비스는 <strong className="text-rose-700">고객을 억지로 끌어오는 광고가 아니라</strong><br />
            <strong className="text-emerald-700">이미 검색하고 있는 고객 앞에 우리 업체를 보여주는 전략</strong>입니다.
          </p>
        </Card>
      </section>

      {/* ───────────────── 9) 비교표 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">comparison</div>
          <h2 className="text-h2 text-ink">기존 플레이스 마케팅과 타지역서비스 비교</h2>
        </div>

        <Card variant="white" className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-bg-subtle">
                <th className="px-4 py-3.5 text-left text-base font-bold text-ink-muted uppercase tracking-wider w-[20%]">구분</th>
                <th className="px-4 py-3.5 text-left text-base font-bold text-rose-700 uppercase tracking-wider w-[40%]">기존 플레이스 마케팅</th>
                <th className="px-4 py-3.5 text-left text-base font-bold text-emerald-700 uppercase tracking-wider w-[40%]">타지역서비스</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-subtle">
              {[
                ['노출 기준', '사업장 주소지 중심', '원하는 지역 중심'],
                ['영업 범위', '사무실 주변에 제한', '실제 서비스 가능 지역으로 확장'],
                ['문의 기회', '한정적', '여러 지역에서 문의 확보'],
                ['비용 부담', '광고비 증가 가능', '회선 기반 고정비 운영 가능'],
                ['고객 접근', '고객이 우리를 찾아야 함', '고객 검색 지역에 우리가 보임'],
                ['확장성', '지점 없으면 한계', '온라인 영업소 확장 가능'],
                ['적합 업종', '매장 방문형', '출장·방문·수리·상담형'],
              ].map(([label, a, b]) => (
                <tr key={label} className="hover:bg-bg-subtle/40">
                  <td className="px-4 py-3.5 text-lg font-bold text-ink">{label}</td>
                  <td className="px-4 py-3.5 text-lg text-ink-muted">
                    <div className="flex items-center gap-2">
                      <XCircle size={18} className="text-rose-400 shrink-0" />
                      {a}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-lg text-ink">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                      <strong>{b}</strong>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ───────────────── 10) 이런 사장님께 꼭 필요합니다 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">for whom</div>
          <h2 className="text-h2 text-ink">이런 사장님께 꼭 필요합니다</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            '사무실은 하나지만 여러 지역에서 문의를 받고 싶은 사장님',
            '출장·방문·설치·수리·상담 업종을 운영하는 사장님',
            '네이버플레이스 노출이 매출에 직접적인 영향을 주는 업종',
            '광고비는 쓰는데 전화문의가 부족한 업체',
            '지역별로 고객을 선점하고 싶은 사업자',
            '지점을 늘리기엔 부담스럽지만 영업 지역은 확장하고 싶은 대표님',
            '경쟁사가 이미 여러 지역에서 보이고 있어 위기감을 느끼는 사장님',
            '한 달 몇 건의 문의만 늘어도 수익 구조가 달라지는 업종',
          ].map((t, i) => (
            <Card key={t} variant="white" className="border border-bg-subtle hover:border-brand-300 transition-colors">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-9 h-9 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-base">
                  {i + 1}
                </span>
                <span className="text-lg text-ink leading-relaxed">{t}</span>
              </div>
            </Card>
          ))}
        </div>

        <Card variant="white" className="mt-5 bg-brand-50 border border-brand-200 text-center">
          <p className="text-xl text-ink leading-relaxed">
            이런 분들에게 타지역서비스는 <strong className="text-brand-700">선택이 아니라</strong>
            <br className="md:hidden" />
            <span className="text-3xl text-brand-700 font-bold"> 매출 확장을 위한 현실적인 전략입니다.</span>
          </p>
        </Card>
      </section>

      {/* ───────────────── 11) 임팩트 5단 메시지 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">impact</div>
          <h2 className="text-h2 text-ink">사장님, 고객이 없는 게 아닙니다.</h2>
          <p className="text-h3 text-rose-700 mt-1 font-bold">고객이 사장님을 못 찾고 있는 것입니다.</p>
        </div>

        <Card variant="white" className="mb-5">
          <p className="text-xl text-ink leading-relaxed mb-4">
            오늘도 고객은 네이버에서 검색하고 있습니다.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {['수리할 업체', '설치할 업체', '상담할 업체', '출장 가능한 업체'].map((t) => (
              <div key={t} className="px-3 py-3 rounded-card bg-bg-subtle text-center">
                <Search size={20} className="text-brand-500 mx-auto mb-1" />
                <span className="text-lg text-ink font-medium">{t}</span>
              </div>
            ))}
          </div>
          <p className="text-xl text-ink-muted leading-relaxed">
            그런데 그 검색 결과에 우리 업체가 없다면? <strong className="text-rose-700">그 고객은 우리 고객이 될 수 없습니다.</strong>
          </p>
        </Card>

        {/* 3단 if not visible */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {[
            '아무리 실력이 좋아도',
            '아무리 친절해도',
            '아무리 가격이 좋아도',
          ].map((t) => (
            <Card key={t} variant="white" className="border border-rose-100 bg-rose-50/30 text-center py-4">
              <span className="text-xl font-bold text-ink">{t}</span>
            </Card>
          ))}
        </div>
        <p className="text-xl text-ink leading-relaxed text-center mb-6">
          고객 눈앞에 보이지 않으면 <strong className="text-rose-700">기회조차 생기지 않습니다.</strong>
        </p>

        {/* 효과 체인 */}
        <Card variant="white" className="bg-gradient-to-r from-emerald-50 via-brand-50 to-amber-50">
          <div className="text-center mb-3">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-100 text-emerald-700 text-body-sm font-bold">
              <Zap size={14} /> 보이면 일어나는 일
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-7 items-center gap-2">
            <ChainStep label="보이면" sub="네이버 노출" tone="brand" />
            <ArrowConnector />
            <ChainStep label="문의가 생깁니다" sub="전화 / 톡" tone="amber" />
            <ArrowConnector />
            <ChainStep label="상담이 열립니다" sub="견적 / 일정" tone="emerald" />
            <ArrowConnector />
            <ChainStep label="매출 기회" sub="계약 / 수주" tone="rose" />
          </div>
          <p className="text-lg text-ink-muted leading-relaxed text-center mt-4">
            반대로 보이지 않으면 <strong className="text-ink">아무 일도 일어나지 않습니다.</strong>
          </p>
        </Card>
      </section>

      {/* ───────────────── 12) 5가지 명언 카드 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">5 messages</div>
          <h2 className="text-h2 text-ink">기억해 주세요</h2>
        </div>

        <div className="space-y-3">
          <QuoteCard
            num="01"
            text="고객은 검색하고, 보이는 업체에 전화합니다. 안 보이는 업체는 선택받지 못합니다."
            sub="타지역서비스는 사장님의 업체를 고객이 검색하는 지역에 보여주는 가장 현실적인 플레이스 확장 전략입니다."
            tone="brand"
          />
          <QuoteCard
            num="02"
            text="사장님은 갈 수 있는데, 고객은 사장님을 못 찾고 있습니다."
            sub="그 차이를 메우는 것이 바로 타지역서비스입니다."
            tone="amber"
          />
          <QuoteCard
            num="03"
            text="사무실은 하나여도 영업 지역은 하나일 필요가 없습니다."
            sub="타지역서비스로 고객이 있는 지역마다 우리 업체의 노출 거점을 만드세요."
            tone="teal"
          />
          <QuoteCard
            num="04"
            text="광고비를 더 쓰기 전에 먼저 확인해야 할 것이 있습니다."
            sub="우리 업체가 고객이 검색하는 지역에 제대로 보이고 있는가? 타지역서비스는 보이지 않아서 놓치는 고객을 줄이는 전략입니다."
            tone="indigo"
          />
          <QuoteCard
            num="05"
            text="고객은 기다려주지 않습니다. 검색합니다. 비교합니다. 보이는 업체에 전화합니다."
            sub="그 순간 우리 업체가 안 보이면 그 매출은 경쟁사에게 넘어갑니다."
            tone="rose"
          />
        </div>
      </section>

      {/* ───────────────── 13) 최종 마무리 ───────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto text-center py-6">
            <Megaphone size={36} className="mx-auto mb-4 text-white/90" />
            <h2 className="text-h1 text-white mb-4 leading-tight">
              지금 필요한 것은 더 많은 광고비가 아닙니다.<br />
              <span className="text-white/90">고객이 검색하는 지역에 보이는 구조입니다.</span>
            </h2>
            <p className="text-xl text-white/90 leading-relaxed mb-6">
              타지역서비스는 사장님이 실제로 영업할 수 있는 지역에<br />
              우리 업체를 노출시켜 전화문의 기회를 넓히는 플레이스 마케팅 전략입니다.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {[
                ['보이는 업체가', '전화를 받습니다'],
                ['전화 받는 업체가', '상담을 만듭니다'],
                ['상담하는 업체가', '매출을 가져갑니다'],
              ].map(([a, b]) => (
                <div key={a} className="rounded-card bg-white/10 backdrop-blur-sm px-4 py-5 border border-white/20">
                  <div className="text-base text-white/80 mb-1">{a}</div>
                  <div className="text-2xl text-white font-bold">{b}</div>
                </div>
              ))}
            </div>
            <p className="text-lg text-white/90 leading-relaxed">
              한 곳의 사업장으로 여러 지역 고객을 만나고 싶다면,<br />
              <strong className="text-white">지금 바로 타지역서비스를 검토해보세요.</strong>
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 14) CTA 박스 3개 ───────────────── */}
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
            tone="brand"
            icon={<Sparkles size={22} />}
          />
          <CtaBox
            num="02"
            title="지역별 키워드"
            highlight="경쟁도 무료 분석 신청하기"
            tone="teal"
            icon={<Target size={22} />}
          />
          <CtaBox
            num="03"
            title="등록한 타지역서비스"
            highlight="노출 자동체크 무료 플랜 신청하기"
            tone="rose"
            icon={<ShieldCheck size={22} />}
          />
        </div>
      </section>

      {/* ───────────────── 관련 페이지 (SEO 내부 링크) ───────────────── */}
      <RelatedLinks currentPath="/about/what-is" items={ALL_RELATED_LINKS} />
    </div>
  )
}

/* ════════════════════ 하위 컴포넌트 ════════════════════ */

function BulletCard({ title }: { tone: 'muted'; title: string }) {
  return (
    <Card variant="white" className="border border-bg-subtle">
      <div className="flex items-center gap-2">
        <XCircle size={18} className="text-ink-muted shrink-0" />
        <span className="text-base text-ink-muted">{title}</span>
      </div>
    </Card>
  )
}

/** 영업 깃발 도식 — SVG로 지도 위 깃발 표현 */
function FlagDiagram() {
  const cities = [
    { x: 60, y: 35, name: '강남' },
    { x: 130, y: 50, name: '송파' },
    { x: 35, y: 90, name: '인천' },
    { x: 95, y: 120, name: '수원' },
    { x: 155, y: 100, name: '분당' },
    { x: 80, y: 160, name: '부천' },
  ]
  return (
    <div className="relative aspect-square max-w-[320px] mx-auto">
      <svg viewBox="0 0 200 200" className="w-full h-full" role="img" aria-label="서울 중심 수도권 주요 지역 분포도 - 타지역서비스 노출 영역 시각화"><title>서울 중심 수도권 타지역서비스 노출 지도</title>
        <defs>
          <linearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eef2ff" />
            <stop offset="100%" stopColor="#e0e7ff" />
          </linearGradient>
        </defs>
        <rect width="200" height="200" rx="14" fill="url(#mapBg)" />
        {/* grid */}
        {Array.from({ length: 5 }).map((_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 40} x2="200" y2={i * 40} stroke="#c7d2fe" strokeWidth="0.5" />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="200" stroke="#c7d2fe" strokeWidth="0.5" />
        ))}
        {/* connecting lines from center */}
        {cities.map((c) => (
          <line key={`l-${c.name}`} x1="100" y1="100" x2={c.x} y2={c.y} stroke="#6366f1" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5" />
        ))}
        {/* center HQ */}
        <circle cx="100" cy="100" r="9" fill="#4f46e5" />
        <circle cx="100" cy="100" r="14" fill="none" stroke="#4f46e5" strokeWidth="1" opacity="0.4" />
        <text x="100" y="103" textAnchor="middle" fontSize="7" fill="white" fontWeight="700">본사</text>
        {/* flags */}
        {cities.map((c) => (
          <g key={c.name}>
            <line x1={c.x} y1={c.y} x2={c.x} y2={c.y + 14} stroke="#1f2937" strokeWidth="1.2" />
            <polygon points={`${c.x},${c.y} ${c.x + 11},${c.y + 4} ${c.x},${c.y + 8}`} fill="#ef4444" />
            <text x={c.x + 1} y={c.y + 21} fontSize="6.5" fill="#1f2937" fontWeight="600">{c.name}</text>
          </g>
        ))}
      </svg>
      <div className="text-center text-base text-ink-muted mt-2 font-medium">
        본사 1곳 → 영업 깃발 N개 지역
      </div>
    </div>
  )
}

interface ReasonCardProps {
  num: string
  tone: 'brand' | 'amber' | 'teal'
  title: string
  lead: string
  bullets: string[]
  customBlock?: React.ReactNode
  icon: React.ReactNode
}

function ReasonCard({ num, tone, title, lead, bullets, customBlock, icon }: ReasonCardProps) {
  const tc = {
    brand: { bg: 'bg-brand-50', text: 'text-brand-700', border: 'border-brand-200', accent: 'from-brand-500 to-indigo-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', accent: 'from-amber-500 to-orange-500' },
    teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', accent: 'from-teal-500 to-cyan-500' },
  }[tone]
  return (
    <Card variant="white" className={`border ${tc.border}`}>
      <div className="flex items-start gap-4">
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center shrink-0 shadow-card`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-body-sm font-mono font-bold ${tc.text} mb-1`}>REASON {num}</div>
          <h3 className="text-h3 text-ink mb-3">{title}</h3>
          <p className={`text-lg text-ink leading-relaxed mb-4 px-3.5 py-2.5 rounded-card ${tc.bg}`}>{lead}</p>
          {customBlock}
          <ul className="space-y-2.5 mt-4">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-base text-ink-muted leading-relaxed">
                <CheckCircle2 size={18} className={`shrink-0 mt-0.5 ${tc.text}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}

function IntentTable() {
  const rows = [
    ['부천 보일러 수리', '지금 바로 수리 가능한 업체 필요'],
    ['인천 에어컨 설치', '해당 지역 설치 가능 업체 탐색'],
    ['송파 누수 탐지', '긴급 문제 해결 업체 검색'],
    ['강남 출장 수리', '방문 가능한 업체 문의'],
    ['수원 입주청소', '지역 기반 청소업체 비교'],
  ]
  return (
    <div className="rounded-card overflow-hidden border border-amber-200">
      <table className="w-full">
        <thead>
          <tr className="bg-amber-50">
            <th className="px-3 py-2.5 text-left text-base font-bold text-amber-700">고객 검색어</th>
            <th className="px-3 py-2.5 text-left text-base font-bold text-amber-700">고객 의도</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-100 bg-white">
          {rows.map(([q, intent]) => (
            <tr key={q}>
              <td className="px-3 py-2.5 text-base text-ink font-medium">
                <Search size={14} className="inline text-amber-500 mr-1" />{q}
              </td>
              <td className="px-3 py-2.5 text-base text-ink-muted">→ {intent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IndustryTable() {
  const rows = [
    ['출장·방문 서비스', '출장수리, 방문설치, 에어컨청소, 보일러수리'],
    ['공사·수리 업종', '누수탐지, 인테리어, 철거, 방수, 전기공사'],
    ['배달·렌탈 업종', '배달서비스, 렌탈, 장비대여, 생활서비스'],
    ['상담 업종', '보험상담, 법률상담, 기업상담, 방문견적'],
    ['중고·매입 업종', '중고매입, 폐기물, 고물, 재활용 수거'],
  ]
  return (
    <div className="rounded-card overflow-hidden border border-rose-200 mt-3">
      <table className="w-full">
        <thead>
          <tr className="bg-rose-50">
            <th className="px-3 py-2.5 text-left text-base font-bold text-rose-700">업종 유형</th>
            <th className="px-3 py-2.5 text-left text-base font-bold text-rose-700">예시</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rose-100 bg-white">
          {rows.map(([t, ex]) => (
            <tr key={t}>
              <td className="px-3 py-2.5 text-base text-ink font-bold">{t}</td>
              <td className="px-3 py-2.5 text-base text-ink-muted">{ex}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3.5 py-3 bg-rose-50/60 text-base text-ink leading-relaxed">
        <strong className="text-rose-700">공통점은 하나입니다 — </strong>
        고객이 있는 곳으로 갈 수 있는 업종이라는 점입니다.
      </div>
    </div>
  )
}

interface EffectRowProps {
  num: string
  tone: 'brand' | 'amber' | 'emerald' | 'rose' | 'indigo'
  icon: React.ReactNode
  title: string
  body: string
  example?: string
  highlight?: string
  customBlock?: React.ReactNode
}

function EffectRow({ num, tone, icon, title, body, example, highlight, customBlock }: EffectRowProps) {
  const tc = {
    brand: { bg: 'bg-brand-50', text: 'text-brand-700', accent: 'from-brand-500 to-indigo-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', accent: 'from-amber-500 to-orange-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', accent: 'from-emerald-500 to-teal-500' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-700', accent: 'from-rose-500 to-orange-500' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', accent: 'from-indigo-500 to-purple-500' },
  }[tone]
  return (
    <Card variant="white">
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center shrink-0">
          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center shadow-card`}>
            {icon}
          </div>
          <div className={`mt-2 text-h3 font-bold ${tc.text}`}>{num}</div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-h3 text-ink mb-2">{title}</h3>
          <p className="text-lg text-ink leading-relaxed mb-2">{body}</p>
          {example && (
            <div className={`px-3.5 py-2.5 rounded-card ${tc.bg} text-base text-ink leading-relaxed mb-2`}>
              {example}
            </div>
          )}
          {customBlock}
          {highlight && (
            <p className={`text-lg font-bold ${tc.text} leading-relaxed mt-2`}>
              👉 {highlight}
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

function ChainStep({ label, sub, tone }: { label: string; sub: string; tone: 'brand' | 'amber' | 'emerald' | 'rose' }) {
  const tc = {
    brand: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[tone]
  return (
    <div className={`rounded-card border ${tc} px-3 py-3.5 text-center`}>
      <div className="text-lg font-bold">{label}</div>
      <div className="text-base opacity-80 mt-0.5">{sub}</div>
    </div>
  )
}

function ArrowConnector() {
  return (
    <div className="flex items-center justify-center">
      <ChevronRight size={18} className="text-ink-soft hidden md:block" />
      <ArrowDown size={18} className="text-ink-soft md:hidden" />
    </div>
  )
}

interface QuoteCardProps {
  num: string
  text: string
  sub: string
  tone: 'brand' | 'amber' | 'teal' | 'indigo' | 'rose'
}

function QuoteCard({ num, text, sub, tone }: QuoteCardProps) {
  const tc = {
    brand: { bg: 'bg-brand-50/40', border: 'border-brand-200', text: 'text-brand-700' },
    amber: { bg: 'bg-amber-50/40', border: 'border-amber-200', text: 'text-amber-700' },
    teal: { bg: 'bg-teal-50/40', border: 'border-teal-200', text: 'text-teal-700' },
    indigo: { bg: 'bg-indigo-50/40', border: 'border-indigo-200', text: 'text-indigo-700' },
    rose: { bg: 'bg-rose-50/40', border: 'border-rose-200', text: 'text-rose-700' },
  }[tone]
  return (
    <Card variant="white" className={`border ${tc.border} ${tc.bg}`}>
      <div className="flex items-start gap-4">
        <div className={`text-[42px] leading-none font-light ${tc.text} shrink-0 select-none`}>{num}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold text-ink leading-relaxed mb-2">"{text}"</p>
          <p className="text-base text-ink-muted leading-relaxed">{sub}</p>
        </div>
      </div>
    </Card>
  )
}

interface CtaBoxProps {
  num: string
  title: string
  highlight: string
  tone: 'brand' | 'teal' | 'rose'
  icon: React.ReactNode
}

function CtaBox({ num, title, highlight, tone, icon }: CtaBoxProps) {
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
      <a
        href={KAKAO_CHAT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-pill text-white font-bold text-base ${tc.btn} transition-colors`}
      >
        카카오톡 무료 상담 <ArrowRight size={16} />
      </a>
    </Card>
  )
}
