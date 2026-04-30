/**
 * 네이버 1페이지노출 SEO솔루션 (Public, 콘텐츠 추후 추가)
 * - 메뉴 항목만 먼저 노출, 본문은 추후 구현 예정
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Sparkles } from 'lucide-react'

export default function Seo() {
  return (
    <div className="space-y-10">
      <TopBar
        title="네이버 1페이지노출 SEO솔루션"
        subtitle="네이버 검색 1페이지 노출 최적화를 위한 SEO 솔루션입니다."
      />

      <Card variant="white" className="min-h-[260px]">
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center">
            <Sparkles className="text-brand-600" size={26} />
          </div>
          <div>
            <h2 className="text-h2 text-ink mb-2">콘텐츠 준비 중입니다</h2>
            <p className="text-body text-ink-muted">
              네이버 1페이지 노출 SEO 솔루션 페이지는 곧 공개됩니다.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
