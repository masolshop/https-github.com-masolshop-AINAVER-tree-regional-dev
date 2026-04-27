import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'

export default function History() {
  return (
    <div>
      <TopBar title="실시간 노출 이력" subtitle="일자별 노출 변동 추이와 변경 이벤트를 확인합니다" />
      <Card variant="white" className="min-h-[400px]">
        <div className="text-center py-16 text-ink-muted">
          📊 실시간 노출 이력 페이지 — Step 4 (이력/리포트) 에서 작성 예정
        </div>
      </Card>
    </div>
  )
}
