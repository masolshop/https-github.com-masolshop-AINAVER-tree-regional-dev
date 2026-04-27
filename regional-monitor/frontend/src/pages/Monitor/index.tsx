import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'

export default function Monitor() {
  return (
    <div>
      <TopBar title="실시간 노출 관리" subtitle="등록한 070 가상번호의 노출 상태를 실시간으로 점검합니다" />
      <Card variant="white" className="min-h-[400px]">
        <div className="text-center py-16 text-ink-muted">
          📡 실시간 노출 관리 페이지 — Step 3에서 작성 예정<br/>
          <span className="text-caption mt-2 inline-block">(엑셀 등록 / 수정 / 삭제 / 즉시 점검 / 자동 점검 설정)</span>
        </div>
      </Card>
    </div>
  )
}
