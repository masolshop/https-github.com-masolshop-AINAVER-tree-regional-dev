/**
 * Card 컴포넌트
 * 디자인 시스템: 흰 카드 / 연그레이 카드 / 딥네이비 카드 / CTA 블루 카드
 */
import { ReactNode } from 'react'
import clsx from 'clsx'

type CardVariant = 'white' | 'subtle' | 'dark' | 'cta'

interface CardProps {
  variant?: CardVariant
  children: ReactNode
  className?: string
  watermarkNumber?: string  // "01", "02", "03" 같은 워터마크
  onClick?: () => void
  noPadding?: boolean       // 패딩 제거 (FAQ 등 커스텀 내부 레이아웃용)
}

export function Card({
  variant = 'white',
  children,
  className,
  watermarkNumber,
  onClick,
  noPadding = false,
}: CardProps) {
  const variantClass = {
    white: 'card-white',
    subtle: 'card-subtle',
    dark: 'card-dark',
    cta: 'card-cta',
  }[variant]

  return (
    <div
      className={clsx(
        variantClass,
        'relative overflow-hidden',
        !noPadding && 'p-card',
        onClick && 'cursor-pointer hover:shadow-card-hover',
        className,
      )}
      onClick={onClick}
    >
      {watermarkNumber && (
        <div
          className={clsx(
            'absolute top-6 left-7 text-watermark font-light select-none pointer-events-none',
            variant === 'dark' || variant === 'cta'
              ? 'text-white/15'
              : 'text-ink-watermark',
          )}
        >
          {watermarkNumber}
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  )
}
