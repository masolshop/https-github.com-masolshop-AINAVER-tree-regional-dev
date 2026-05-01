/**
 * 타지역서비스란?
 * - 타지역서비스의 개념·정의 안내 페이지
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { MapPin, Phone, Building2, ShieldCheck, Sparkles } from 'lucide-react'

export default function WhatIs() {
  return (
    <div className="space-y-8">
      <TopBar
        title="타지역서비스란?"
        subtitle="타 지역(도서·산간·인접 시군구 포함)에서 들어오는 콜을 자체 사업장으로 라우팅하여 매출을 발생시키는 영업 모델"
      />

      {/* Hero - 정의 */}
      <Card variant="white" className="min-h-[220px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          WHAT <br /> IS IT?
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-semibold mb-3">
            <Sparkles size={12} /> 타지역서비스 개념
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            한 사업장에서<br />
            전국 단위 콜을 받는 구조입니다.
          </h2>
          <p className="text-body text-ink-muted leading-relaxed">
            타지역서비스는 <strong className="text-ink">사업장이 위치하지 않은 지역</strong>에서
            네이버 지도/플레이스에 노출되도록 070 가상번호와 플레이스 ID를 등록하여
            <strong className="text-ink"> 해당 지역 검색결과에 진입</strong>하는 영업 방식입니다.
            본 솔루션은 그 노출 상태를 실시간/정기 검증하여 매출 누락을 방지합니다.
          </p>
        </div>
      </Card>

      {/* 핵심 요소 */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            core elements
          </div>
          <h2 className="text-h2 text-ink">타지역서비스 4가지 핵심 요소</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ElementCard
            icon={<Phone size={20} />}
            title="070 가상번호"
            desc="타 지역 발신/수신을 위한 가상번호. 통신사별 070 발행, 변경 시 노출 영향 발생."
          />
          <ElementCard
            icon={<MapPin size={20} />}
            title="네이버 플레이스"
            desc="플레이스 ID 단위 노출 관리. 카테고리·지역 키워드 결합으로 진입."
          />
          <ElementCard
            icon={<Building2 size={20} />}
            title="타 지역 진입"
            desc="실 사업장이 없는 시·군·구·동에 노출. 도서·산간·인접지 매출 확보."
          />
          <ElementCard
            icon={<ShieldCheck size={20} />}
            title="자동 검증"
            desc="네이버 로직/070/플레이스 ID 변동을 24시간 이내 감지하여 알림."
          />
        </div>
      </section>

      {/* 적용 업종 예시 */}
      <Card variant="white">
        <h3 className="text-h3 text-ink mb-3">대표 적용 업종</h3>
        <p className="text-body text-ink-muted leading-relaxed">
          하수구·누수·열쇠·보일러·이사·청소·폐기물·심부름센터·흥신소 등
          <strong className="text-ink"> 출장형/긴급출동형 서비스</strong>는
          전 지역 콜을 받기 위해 타지역서비스가 필수적으로 활용됩니다.
        </p>
      </Card>
    </div>
  )
}

function ElementCard({
  icon, title, desc,
}: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card variant="white" className="h-full">
      <div className="flex items-center gap-2 mb-2 text-brand-600">
        {icon}
        <span className="text-body font-semibold text-ink">{title}</span>
      </div>
      <p className="text-caption text-ink-muted leading-relaxed">{desc}</p>
    </Card>
  )
}
