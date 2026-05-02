/**
 * 페이지별 SEO 메타태그 일괄 관리 컴포넌트.
 *
 * SPA(React Router) 환경에서 라우트마다 <title> / description / canonical /
 * OG / Twitter Card / JSON-LD 가 다르게 렌더되도록 react-helmet-async 로 주입.
 *
 * 사용 예:
 *   <PageSeo
 *     title="타지역 키워드 DNA 파싱 솔루션"
 *     description="…"
 *     path="/intro/keyword-dna"
 *     keywords={['타지역서비스', '키워드 DNA', …]}
 *   />
 */
import { Helmet } from 'react-helmet-async'

const SITE_URL = 'https://taziyuk.com'
const SITE_NAME = '타지역닷컴'
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-thumbnail.png`
const SITE_TAGLINE = '타지역서비스 네이버노출 자동체크 솔루션'

export interface PageSeoProps {
  /** 페이지 고유 타이틀 — 자동으로 " | 타지역닷컴" 접미가 붙음 */
  title: string
  /** 메타 description (120~160자 권장) */
  description: string
  /** 사이트 내부 경로 (예: "/intro/keyword-dna"). canonical/OG URL 계산에 사용 */
  path: string
  /** 페이지별 키워드 배열 (네이버 검색 가중치) */
  keywords?: string[]
  /** OG 이미지 (지정 안 하면 사이트 기본 썸네일) */
  ogImage?: string
  /** noindex 처리 필요 시 true */
  noindex?: boolean
  /** 추가 JSON-LD 구조화 데이터 */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

export default function PageSeo({
  title,
  description,
  path,
  keywords = [],
  ogImage = DEFAULT_OG_IMAGE,
  noindex = false,
  jsonLd,
}: PageSeoProps) {
  const fullUrl = `${SITE_URL}${path === '/' ? '' : path}`
  const fullTitle = title.includes('타지역닷컴') ? title : `${title} | ${SITE_NAME}`
  const robotsContent = noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large, max-snippet:-1'

  const jsonLdArray = jsonLd
    ? Array.isArray(jsonLd)
      ? jsonLd
      : [jsonLd]
    : []

  return (
    <Helmet>
      {/* ───── 기본 ───── */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords.length > 0 && <meta name="keywords" content={keywords.join(', ')} />}
      <link rel="canonical" href={fullUrl} />
      <meta name="robots" content={robotsContent} />
      <meta name="googlebot" content={robotsContent} />

      {/* ───── Open Graph ───── */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ko_KR" />
      <meta property="og:url" content={fullUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:secure_url" content={ogImage} />
      <meta property="og:image:alt" content={`${title} - ${SITE_TAGLINE}`} />

      {/* ───── Twitter ───── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={fullUrl} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* ───── 추가 JSON-LD ───── */}
      {jsonLdArray.map((obj, i) => (
        <script key={`jsonld-${i}`} type="application/ld+json">
          {JSON.stringify(obj)}
        </script>
      ))}
    </Helmet>
  )
}

/**
 * Service 스키마 빌더 — 4대 솔루션 인트로 페이지에서 재사용.
 */
export function buildServiceJsonLd(opts: {
  name: string
  description: string
  path: string
  serviceType: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: opts.name,
    description: opts.description,
    url: `${SITE_URL}${opts.path}`,
    serviceType: opts.serviceType,
    provider: {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
    },
    areaServed: { '@type': 'Country', name: '대한민국' },
    inLanguage: 'ko-KR',
  }
}

/**
 * FAQ 스키마 빌더.
 */
export function buildFaqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
}

/**
 * BreadcrumbList 스키마 빌더.
 */
export function buildBreadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path === '/' ? '' : it.path}`,
    })),
  }
}
