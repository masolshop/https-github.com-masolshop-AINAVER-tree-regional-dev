/**
 * AdShowcase — 파워링크 광고 시리즈 갤러리.
 *
 * 5종 광고 이미지를 노출 순서대로 보여준다.
 * - 데스크탑: 5개 그리드 + 큰 메인 이미지(자동 회전 4초 간격)
 * - 모바일: 가로 스와이프 가능한 큰 메인 이미지 + 하단 인디케이터
 *
 * 광고 클릭(파워링크) → 랜딩 페이지 도달 시 사용자가 본 광고와
 * 동일한 이미지가 첫 화면에 보여 광고 일관성과 신뢰도를 높인다.
 */
import { useEffect, useState } from 'react'

export interface AdItem {
  /** 광고 순서 (1~5) */
  order: number
  /** 짧은 핵심 카피 (alt/캡션 용도) */
  title: string
  /** 부제 (해시태그/USP) */
  subtitle: string
  /** /public/ads/ 하위 절대 경로 */
  image: string
}

export const AD_SERIES: AdItem[] = [
  {
    order: 1,
    title: '동별 순위체크',
    subtitle: '한눈에 확인하는 우리동네 순위',
    image: '/ads/ad-01-dong-rank-check.jpg',
  },
  {
    order: 2,
    title: '키워드 순위',
    subtitle: '#하수구 #에어컨수리 #선불폰 #흥신소 #열쇠수리',
    image: '/ads/ad-02-keyword-rank.jpg',
  },
  {
    order: 3,
    title: '매일 자동추적',
    subtitle: '24시간 매일 업데이트로 변화를 놓치지 않습니다',
    image: '/ads/ad-03-daily-auto-track.jpg',
  },
  {
    order: 4,
    title: '순위 하락 알림',
    subtitle: '하락 즉시 카카오·이메일로 알려드립니다',
    image: '/ads/ad-04-rank-drop-alert.jpg',
  },
  {
    order: 5,
    title: '무료 선착순',
    subtitle: '비용 ZERO · 선착순 마감 · 지금 바로 신청',
    image: '/ads/ad-05-free-firstcome.jpg',
  },
]

interface AdShowcaseProps {
  /** 자동 회전 간격 (ms). 0 또는 음수 = 회전 끔. 기본 4500ms */
  intervalMs?: number
}

export default function AdShowcase({ intervalMs = 4500 }: AdShowcaseProps) {
  const [active, setActive] = useState(0)

  // 자동 회전
  useEffect(() => {
    if (intervalMs <= 0) return
    const id = setInterval(() => {
      setActive((cur) => (cur + 1) % AD_SERIES.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const current = AD_SERIES[active]

  return (
    <section
      aria-label="타지역서비스 광고 시리즈"
      className="rounded-2xl overflow-hidden bg-gradient-to-br from-slate-900 to-blue-950 shadow-card"
    >
      {/* 메인 노출 이미지 */}
      <div className="relative aspect-square sm:aspect-[16/10] w-full bg-blue-950">
        {AD_SERIES.map((ad, idx) => (
          <img
            key={ad.order}
            src={ad.image}
            alt={`${ad.title} — ${ad.subtitle}`}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-in-out ${
              idx === active ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            loading={idx === 0 ? 'eager' : 'lazy'}
            decoding="async"
            // 가장 먼저 보여줄 이미지에는 fetchpriority high
            {...(idx === 0 ? { fetchPriority: 'high' as any } : {})}
          />
        ))}

        {/* 캡션 오버레이 */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-4 sm:p-6">
          <div className="text-white/80 text-sm sm:text-base font-mono tracking-wider mb-1">
            AD {String(current.order).padStart(2, '0')} / 05
          </div>
          <div className="text-white text-xl sm:text-2xl md:text-3xl font-bold leading-tight">
            {current.title}
          </div>
          <div className="text-white/85 text-sm sm:text-base mt-1 leading-relaxed">
            {current.subtitle}
          </div>
        </div>
      </div>

      {/* 썸네일 5종 그리드 (클릭 시 해당 이미지로 점프) */}
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2 p-2 sm:p-3 bg-blue-950">
        {AD_SERIES.map((ad, idx) => (
          <button
            key={ad.order}
            type="button"
            onClick={() => setActive(idx)}
            aria-label={`광고 ${ad.order}번: ${ad.title}`}
            aria-current={idx === active ? 'true' : 'false'}
            className={`relative aspect-square rounded-md overflow-hidden border-2 transition-all duration-200 ${
              idx === active
                ? 'border-blue-400 ring-2 ring-blue-400/40 scale-[1.03]'
                : 'border-transparent opacity-70 hover:opacity-100 hover:border-blue-300/50'
            }`}
          >
            <img
              src={ad.image}
              alt={ad.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] sm:text-xs font-bold leading-none">
              {ad.order}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
