/**
 * 검증 결과 배지 — Verdict 값에 따라 색상/라벨 자동 적용
 */
import clsx from 'clsx'
import { VERDICT_LABEL, VERDICT_TONE } from './types'
import type { Verdict } from './types'

interface VerdictBadgeProps {
  verdict: Verdict
  showLabel?: boolean   // 한글 라벨 표시(기본) vs 코드만(VERDICT)
  className?: string
}

export function VerdictBadge({ verdict, showLabel = true, className }: VerdictBadgeProps) {
  const tone = VERDICT_TONE[verdict]
  const toneClass = {
    success: 'bg-green-50 text-status-success border-green-200',
    warning: 'bg-amber-50 text-status-warning border-amber-200',
    danger: 'bg-red-50 text-status-danger border-red-200',
    info: 'bg-brand-50 text-brand-700 border-brand-200',
    neutral: 'bg-bg-subtle text-ink-muted border-ink-watermark/40',
  }[tone]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill border text-caption font-bold tabular-nums',
        toneClass,
        className,
      )}
    >
      <span
        className={clsx(
          'w-1.5 h-1.5 rounded-full',
          tone === 'success' && 'bg-status-success',
          tone === 'warning' && 'bg-status-warning',
          tone === 'danger' && 'bg-status-danger',
          tone === 'info' && 'bg-brand-500',
          tone === 'neutral' && 'bg-ink-muted',
          verdict === 'CHECKING' && 'animate-pulse',
        )}
      />
      {showLabel ? VERDICT_LABEL[verdict] : verdict}
    </span>
  )
}
