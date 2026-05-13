/**
 * RelatedLinks — 페이지 하단 "관련 페이지" 내부 링크 섹션
 *
 * 목적
 *  · SEO: 내부 링크 강화 → 검색엔진의 페이지 발견·중요도 평가 개선
 *  · UX : 관련 콘텐츠 자연스러운 회유 → 체류시간 증가
 *
 * 사용 예
 *   <RelatedLinks
 *     currentPath="/about/what-is"
 *     items={[
 *       { to: '/about/keyword-logic', title: '...', desc: '...' },
 *       ...
 *     ]}
 *   />
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'

export interface RelatedLinkItem {
  to: string
  title: string
  desc: string
  badge?: string
}

interface RelatedLinksProps {
  /** 현재 페이지 경로 (자기 자신은 표시하지 않기 위함) */
  currentPath?: string
  /** 헤더 라벨 */
  label?: string
  /** 헤더 제목 */
  title?: string
  items: RelatedLinkItem[]
}

export function RelatedLinks({
  currentPath,
  label = 'RELATED',
  title = '함께 보면 좋은 페이지',
  items,
}: RelatedLinksProps) {
  const filtered = currentPath ? items.filter((it) => it.to !== currentPath) : items
  if (filtered.length === 0) return null

  return (
    <section aria-labelledby="related-links-heading" className="mt-2">
      <div className="mb-5">
        <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
          {label}
        </div>
        <h2 id="related-links-heading" className="text-h2 text-ink">
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <Link key={item.to} to={item.to} className="group">
            <Card
              variant="white"
              className="h-full p-5 transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5 ring-1 ring-slate-200 group-hover:ring-brand-300"
            >
              {item.badge && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-pill bg-brand-50 text-brand-700 text-[11px] font-bold mb-2">
                  {item.badge}
                </span>
              )}
              <h3 className="text-h3 text-ink mb-2 leading-snug group-hover:text-brand-700 transition-colors">
                {item.title}
              </h3>
              <p className="text-body-sm text-ink-muted leading-relaxed mb-3 line-clamp-3">
                {item.desc}
              </p>
              <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-brand-600 group-hover:text-brand-700">
                자세히 보기 <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** About 4종 + Solutions 5종 통합 후보군 (필요 시 import 해서 재사용) */
export const ALL_RELATED_LINKS: RelatedLinkItem[] = [
  // About
  {
    to: '/about/what-is',
    title: '타지역서비스란 무엇인가?',
    desc: '고객을 여러 지역에서 만나게 하는 네이버플레이스 확장 전략. 타지역서비스의 정의·원리·필요성을 사례로 정리한 입문 가이드.',
    badge: 'GUIDE',
  },
  {
    to: '/about/essential-categories',
    title: '타지역서비스 등록 필수업종',
    desc: '회선 수 기준 시장 규모 정렬. 출장수리·설치·공사·렌탈·방문상담 등 타지역서비스가 강력하게 작동하는 업종 리스트.',
    badge: 'GUIDE',
  },
  {
    to: '/about/keyword-logic',
    title: '타지역서비스 키워드 로직 최적화',
    desc: '네이버 1페이지 노출의 메커니즘. 30자 상호 키워드 조합 싸움, 분절·매칭·070 룰·주소 룰 등 핵심 로직 분석.',
    badge: 'GUIDE',
  },
  {
    to: '/about/exposure-management',
    title: '타지역서비스 노출 최적화 관리',
    desc: '등록보다 유지가 어려운 이유. 노출이 갑자기 빠지는 7가지 원인과 24시간 모니터링으로 매출을 지키는 방법.',
    badge: 'GUIDE',
  },
  // Solutions
  {
    to: '/intro/keyword-dna',
    title: '타지역서비스 키워드 DNA 파싱솔루션',
    desc: '상호명을 6대 DNA(MAIN·ACTION·MATERIAL·PLACE·BRAND·TAG)로 1초 만에 분해. 1,875개 등록 업체·3,574개 키워드 사전 기반.',
    badge: 'SOLUTION 01',
  },
  {
    to: '/intro/keyword-discover',
    title: '네이버1페이지 노출 타지역서비스 키워드 발굴솔루션',
    desc: '시드 키워드 1개 → 12~50개 후보 키워드 + 4단계 경쟁도(청정/경쟁/과열/포화) 자동 분류. 508,854개 회선 데이터 검증.',
    badge: 'SOLUTION 02',
  },
  {
    to: '/intro/competition',
    title: '타지역서비스 지역별 노출 경쟁도 분석솔루션',
    desc: '동(洞) 단위 4단계 등급으로 진입 우선순위 결정. Fast 5~30초, Precise 30초~5분. 등록 작업 리스트 엑셀 다운로드.',
    badge: 'SOLUTION 03',
  },
  {
    to: '/intro/monitor',
    title: '타지역서비스 노출관리 자동체크솔루션',
    desc: '24시간 노출 보초병. 매일 1회 자동 검증(페이지/070/동/상호명 4중). 변동 즉시 이메일·카카오 알림.',
    badge: 'SOLUTION 04',
  },
]
