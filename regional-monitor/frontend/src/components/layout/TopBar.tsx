/**
 * 상단바 (선택적)
 * 메인 콘텐츠 영역 위에 위치 - 페이지 타이틀과 빠른 액션
 */
import { Bell, Search } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

interface TopBarProps {
  title?: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const { isAuthenticated } = useAuthStore()

  return (
    <div className="flex items-center justify-between px-2 py-3 mb-2">
      <div>
        {title && (
          <h1 className="text-h1 text-ink">{title}</h1>
        )}
        {subtitle && (
          <p className="text-body-sm text-ink-muted mt-1">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          aria-label="검색"
          className="w-10 h-10 rounded-2xl bg-white shadow-card flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
        >
          <Search size={18} />
        </button>
        {isAuthenticated && (
          <button
            aria-label="알림"
            className="w-10 h-10 rounded-2xl bg-white shadow-card flex items-center justify-center text-ink-muted hover:text-ink transition-colors relative"
          >
            <Bell size={18} />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-status-danger"></span>
          </button>
        )}
      </div>
    </div>
  )
}
