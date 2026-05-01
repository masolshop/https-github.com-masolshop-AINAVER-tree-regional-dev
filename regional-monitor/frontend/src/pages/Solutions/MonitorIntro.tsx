/**
 * 솔루션 04 — 네이버노출관리 자동체크솔루션 (소개 페이지)
 */
import { Radio } from 'lucide-react'
import { SolutionDetailLayout } from './_shared'

export default function MonitorIntro() {
  return (
    <SolutionDetailLayout
      num="04"
      title="네이버노출관리 자동체크솔루션"
      subtitle="한 번 등록하면 매일 자동으로 검증 — 노출 사라짐을 24시간 이내 감지합니다."
      shortLabel="네이버노출관리 자동체크솔루션"
      tagline="플레이스 ID 기반 4중 검증으로 페이지 생존, 070 일치, 등록 동 일치, 상호명 일치를 매일 새벽 자동 체크합니다. 변경 발생 시 즉시 이메일 알림으로 매출 누락을 차단합니다."
      icon={Radio}
      accent="from-rose-500 to-orange-500"
      ctaTo="/monitor"
      ctaLabel="노출관리 솔루션 사용하기"
      what={{
        headline: '플레이스 ID 기반 4중 검증을 매일 자동 실행하는 노출 모니터링 엔진입니다.',
        bullets: [
          '070 번호 한 개만 등록하면 플레이스 ID·등록 동·상호명을 자동 추출',
          '4중 검증: 페이지 생존 / 070 일치 / 등록 동 일치 / 상호명 일치',
          '매일 새벽 03:00 KST 자동 실행 — 변경 발생 시 즉시 이메일 알림',
          '응답 0.2~0.3초/건, 정확도 99% 이상, 차단 위험 거의 없음',
          'verdict 4종 분류: OK / DEAD / DONG_MISMATCH / REGION_MISMATCH',
        ],
      }}
      why={{
        headline: '통신사·플레이스·네이버 로직이 끊임없이 변하는 환경에서 수작업 검증은 한계가 명확합니다.',
        bullets: [
          '통신사 변경 → 070 번호 변경 → 플레이스 ID 변경 → 노출 사라짐이 빈번하게 발생합니다',
          '네이버 로직 변경으로 며칠 뒤 노출이 사라져도 직접 검색하지 않으면 알 수 없습니다',
          '"070 서초동 등록인데 인계동 노출" 같은 변경 노출을 수작업으로 잡기 어렵습니다',
          '매번 엑셀 업로드 → 1회성 검증 → 결과 확인은 시간만 잡아먹고 누락이 잦습니다',
          '노출 사라짐을 늦게 인지할수록 콜 누락 = 매출 누락이 누적됩니다',
        ],
      }}
      effect={{
        headline: '노출 사라짐을 다음 날 알림으로 인지 → 매출 누락을 24시간 이내 차단합니다.',
        metrics: [
          { label: '감지 지연', value: '< 24시간' },
          { label: '검증 정확도', value: '97.2%' },
          { label: '응답 속도', value: '0.2~0.3초/건' },
        ],
        bullets: [
          '노출 사라짐을 다음 날 알림으로 인지 → 매출 누락 최소화',
          'DEAD / DONG_MISMATCH / REGION_MISMATCH / OK 4종 verdict로 즉시 원인 파악',
          '구글시트 실시간 연동(Pro+) → 사내 대시보드와 즉시 연결',
          '이메일·카카오 알림으로 담당자가 즉시 후속 조치 가능',
          '검증 이력 보관으로 노출 트렌드 분석·보고서 작성에 활용',
        ],
      }}
      howToUse={[
        {
          step: 'STEP 1',
          title: '070 번호 등록',
          desc: '관리할 070 가상번호를 단일 또는 엑셀 일괄 업로드. 플레이스 ID·등록 동·상호명 자동 추출.',
        },
        {
          step: 'STEP 2',
          title: '자동 검증 시작',
          desc: '매일 새벽 03:00 KST 자동 실행. 4중 검증을 수행하여 verdict(OK/DEAD/DONG_MISMATCH/REGION_MISMATCH) 산출.',
        },
        {
          step: 'STEP 3',
          title: '변경 발생 시 알림 수신',
          desc: 'OK가 아닌 verdict 발생 시 즉시 이메일 알림. Pro 플랜은 카카오톡, Enterprise는 Slack/웹훅 추가.',
        },
        {
          step: 'STEP 4',
          title: '대시보드·이력 확인',
          desc: '실시간 대시보드에서 현재 상태와 검증 이력 확인. 구글시트 연동으로 사내 시스템에 즉시 반영.',
        },
      ]}
    />
  )
}
