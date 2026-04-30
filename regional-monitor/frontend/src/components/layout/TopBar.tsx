/**
 * 상단바 — 페이지 타이틀 + 알림 종 배지
 *
 * 종 배지: useUnreadCount() 30s polling, 미열람 N>0 일 때 빨간 점 + 숫자
 * 클릭 시: 최근 5건 미리보기 드롭다운 + "모두 보기 → /history"
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search, ArrowRight, AlertTriangle, AlertCircle, CheckCircle2, Clock, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'

import { useAuthStore } from '@/store/auth'
import { useEvents, useUnreadCount, useMarkEventsRead } from '@/hooks/useEvents'
import type { ChangeEventOut, ChangeEventSeverity } from '@/api/types'

interface TopBarProps {
  title?: string
  subtitle?: React.ReactNode
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isSuperadmin = useAuthStore((s) => !!s.user?.is_superadmin)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="flex items-center justify-between gap-2 px-1 sm:px-2 py-2 sm:py-3 mb-2">
      <div className="min-w-0 flex-1">
        {title && <h1 className="text-xl sm:text-h1 text-ink truncate">{title}</h1>}
        {subtitle && <p className="text-[16px] sm:text-[18px] text-ink-muted mt-0.5 sm:mt-1 line-clamp-2">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          aria-label="검색"
          className="hidden sm:flex w-10 h-10 rounded-2xl bg-white shadow-card items-center justify-center text-ink-muted hover:text-ink transition-colors"
        >
          <Search size={18} />
        </button>

        {isSuperadmin && (
          <Link
            to="/admin"
            aria-label="관리자 콘솔"
            title="관리자 콘솔"
            className="h-9 sm:h-10 px-2.5 sm:px-3 rounded-xl sm:rounded-2xl bg-white shadow-card flex items-center gap-1 sm:gap-1.5 text-ink-muted hover:text-brand-600 transition-colors"
          >
            <ShieldCheck size={14} className="sm:hidden" />
            <ShieldCheck size={16} className="hidden sm:block" />
            <span className="text-[11px] sm:text-caption font-semibold">관리자</span>
          </Link>
        )}

        {isAuthenticated && (
          <div className="relative" ref={wrapRef}>
            <NotificationBellButton open={open} onToggle={() => setOpen((v) => !v)} />
            {open && <NotificationPanel onClose={() => setOpen(false)} />}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────── 종 버튼 ─────────────── */

function NotificationBellButton({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  const { data } = useUnreadCount()
  const unread = data?.unread ?? 0

  return (
    <button
      aria-label="알림"
      onClick={onToggle}
      className={clsx(
        'w-10 h-10 rounded-2xl bg-white shadow-card flex items-center justify-center transition-colors relative',
        open ? 'text-brand-600' : 'text-ink-muted hover:text-ink',
      )}
    >
      <Bell size={18} />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-status-danger text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-bg">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

/* ─────────────── 드롭다운 패널 ─────────────── */

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const eventsQuery = useEvents(5)             // 최근 5건만
  const unreadQuery = useUnreadCount()
  const markRead = useMarkEventsRead()

  const events = eventsQuery.data?.items ?? []
  const total = eventsQuery.data?.total ?? 0
  const unread = unreadQuery.data?.unread ?? 0

  const handleViewAll = () => {
    onClose()
    navigate('/history')
  }

  const handleMarkAllRead = async () => {
    if (unread === 0) return
    try {
      await markRead.mutateAsync()
    } catch {
      // 실패해도 패널은 닫지 않음
    }
  }

  return (
    <div
      role="dialog"
      aria-label="알림"
      className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-[380px] sm:w-[380px] bg-white rounded-card-lg shadow-card-hover overflow-hidden z-30 border border-bg-subtle"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-subtle">
        <div>
          <div className="text-body font-bold text-ink">알림</div>
          <div className="text-caption text-ink-muted">
            미열람 <span className="font-semibold text-ink">{unread}</span> · 전체 {total}건
          </div>
        </div>
        <button
          onClick={handleMarkAllRead}
          disabled={unread === 0 || markRead.isPending}
          className="text-caption font-medium text-brand-600 hover:text-brand-700 disabled:text-ink-muted disabled:cursor-default"
        >
          모두 읽음
        </button>
      </div>

      {/* 본문 */}
      <div className="max-h-[420px] overflow-y-auto">
        {eventsQuery.isLoading ? (
          <div className="px-4 py-8 text-center text-caption text-ink-muted">불러오는 중…</div>
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-bg-subtle">
            {events.map((e) => (
              <li key={e.id}>
                <EventRow event={e} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 푸터 */}
      <button
        onClick={handleViewAll}
        className="w-full flex items-center justify-center gap-1.5 py-3 bg-bg-subtle hover:bg-brand-100 text-body-sm font-semibold text-brand-700 transition-colors"
      >
        모든 변경 이력 보기 <ArrowRight size={14} />
      </button>
    </div>
  )
}

/* ─────────────── 보조 ─────────────── */

function EmptyState() {
  return (
    <div className="px-4 py-10 text-center">
      <div className="inline-flex w-12 h-12 rounded-2xl bg-bg-subtle items-center justify-center mb-3">
        <CheckCircle2 className="text-status-success" size={22} />
      </div>
      <div className="text-body-sm font-semibold text-ink mb-1">변경 이벤트가 없습니다</div>
      <div className="text-caption text-ink-muted">
        등록된 070 번호의 노출이 모두 정상이에요
      </div>
    </div>
  )
}

export function EventRow({ event }: { event: ChangeEventOut }) {
  const Icon = severityIcon(event.severity)
  const detected = formatRelative(event.detected_at)

  return (
    <div className="px-4 py-3 hover:bg-bg-subtle transition-colors flex items-start gap-3">
      <div
        className={clsx(
          'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
          event.severity === 'danger' && 'bg-red-50 text-red-600',
          event.severity === 'warning' && 'bg-amber-50 text-amber-600',
          event.severity === 'info' && 'bg-emerald-50 text-emerald-600',
        )}
      >
        <Icon size={16} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-body-sm font-semibold text-ink truncate">
            {event.business_name || event.phone}
          </span>
          <span className={clsx(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0',
            event.severity === 'danger' && 'bg-red-100 text-red-700',
            event.severity === 'warning' && 'bg-amber-100 text-amber-700',
            event.severity === 'info' && 'bg-emerald-100 text-emerald-700',
          )}>
            {EVENT_TYPE_LABEL[event.event_type] ?? event.event_type}
          </span>
        </div>
        <div className="text-caption text-ink-muted truncate">{event.summary}</div>
        <div className="flex items-center gap-1 text-[11px] text-ink-soft mt-0.5">
          <Clock size={10} /> {detected}
        </div>
      </div>
    </div>
  )
}

/* ─────────────── 매핑 ─────────────── */

export const EVENT_TYPE_LABEL: Record<string, string> = {
  PAGE_DELETED:   '페이지 삭제',
  EXPOSURE_LOST:  '노출 상실',
  REGION_CHANGED: '지역 변경',
  DONG_CHANGED:   '동 변경',
  NAME_CHANGED:   '상호 변경',
  RECOVERED:      '회복',
  OTHER_CHANGED:  '기타 변경',
}

function severityIcon(s: ChangeEventSeverity) {
  if (s === 'danger') return AlertTriangle
  if (s === 'warning') return AlertCircle
  return CheckCircle2
}

/** "방금 전 / 5분 전 / 3시간 전 / 2일 전" — KST 기준 한국어 상대시간 */
import { formatKSTRelative } from '@/utils/datetime'
export const formatRelative = (iso: string): string => formatKSTRelative(iso, iso)
