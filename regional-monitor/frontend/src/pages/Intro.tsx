/**
 * 솔루션 소개 (Public)
 * 구성:
 *  1) Hero - 문제 제기
 *  2) 문제점 3가지 (현재 운영의 페인 포인트)
 *  3) 해결 방식 - 4중 검증
 *  4) 요금제 (Free / Basic / Pro / Enterprise)
 *  5) FAQ
 *  6) 하단 CTA
 */
import { useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import {
  AlertTriangle,
  RefreshCw,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export default function Intro() {
  return (
    <div className="space-y-10">
      <TopBar
        title="솔루션 소개"
        subtitle="이 서비스가 무엇이고, 어떻게 동작하는지 안내합니다"
      />

      {/* ───────────────────────── 1) Hero - 문제 제기 ───────────────────────── */}
      <Card variant="white" className="min-h-[260px] relative overflow-hidden">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          WHY <br />
          MONITOR?
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-brand-50 text-brand-700 text-caption font-semibold mb-3">
            <Sparkles size={12} /> 타지역 노출 관리 SaaS
          </span>
          <h2 className="text-hero-sm text-ink mb-4">
            매번 엑셀 업로드 후
            <br />
            1회성 검증으로 끝나지 않습니다.
          </h2>
          <p className="text-body text-ink-muted leading-relaxed">
            통신사 변경, 070 번호 변경, 플레이스 ID 변경, 네이버 로직 변경이
            반복되는 환경에서
            <br />
            <strong className="text-ink">한 번 등록하면 매일 자동으로 검증</strong>해
            노출 사라짐을 24시간 이내 발견하는 솔루션입니다.
          </p>
        </div>
      </Card>

      {/* ───────────────────────── 2) 페인 포인트 3가지 ───────────────────────── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            problem
          </div>
          <h2 className="text-h2 text-ink">기존 운영의 3가지 페인 포인트</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PainCard
            icon={<RefreshCw size={20} />}
            title="잦은 변경, 잦은 누락"
            desc="유저가 통신사를 변경하면 070이 바뀌고, 플레이스 ID도 바뀌며, 네이버 로직 변경으로 노출이 사라지는 일이 반복됩니다."
          />
          <PainCard
            icon={<ClipboardList size={20} />}
            title="매번 엑셀 업로드 노동"
            desc="매번 엑셀 샘플을 만들어 업로드 → 검증 → 결과 확인. 1회성 검증이라 며칠 뒤 노출이 사라져도 알 길이 없었습니다."
          />
          <PainCard
            icon={<AlertTriangle size={20} />}
            title="잘못된 동·상호 노출"
            desc="070 서초동 등록인데 인계동으로 노출되거나, 등록 상호와 다른 이름으로 노출되는 케이스를 즉시 감지하기 어려웠습니다."
          />
        </div>
      </section>

      {/* ───────────────────────── 3) 해결 방식 - 4중 검증 ───────────────────────── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            solution
          </div>
          <h2 className="text-h2 text-ink">플레이스 ID 기반 4중 검증</h2>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* 좌측 - 설명 */}
          <Card variant="dark" className="col-span-12 lg:col-span-5 min-h-[320px]">
            <div className="pt-2">
              <h3 className="text-h2 text-white mb-3">
                고유한 플레이스 ID로
                <br />
                직접 조회합니다
              </h3>
              <p className="text-body-sm text-white/75 leading-relaxed mb-5">
                네이버 플레이스 ID는 변하지 않는 고유 키입니다. 이 ID로 직접
                조회해 4가지 항목을 동시에 검증합니다.
              </p>
              <ul className="space-y-2.5 text-body-sm text-white/85">
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-brand-300 shrink-0 mt-0.5" />
                  <span>플레이스 페이지 생존 여부 (404 / 삭제 감지)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-brand-300 shrink-0 mt-0.5" />
                  <span>등록 070 전화번호 일치 여부</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-brand-300 shrink-0 mt-0.5" />
                  <span>등록 동(洞) 일치 여부 (변경 노출 감지)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-brand-300 shrink-0 mt-0.5" />
                  <span>등록 상호명 일치 여부 (포함/유사도 검증)</span>
                </li>
              </ul>
            </div>
          </Card>

          {/* 우측 - 검증 결과 예시 */}
          <Card variant="white" className="col-span-12 lg:col-span-7 min-h-[320px]">
            <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-3">
              verdict examples
            </div>
            <div className="space-y-3">
              <VerdictRow
                phone="070-4534-9862"
                expected="서울 종로구 종로1가 / 바비네"
                actual="서울 종로구 홍지동 / 바비네"
                verdict="DONG_MISMATCH"
                tone="info"
              />
              <VerdictRow
                phone="070-4534-7941"
                expected="서울 강남구 / 대구방충망"
                actual="대구 달서구 두류동 / 대구방충망"
                verdict="REGION_MISMATCH"
                tone="info"
              />
              <VerdictRow
                phone="070-4534-2010"
                expected="서울 / 청결한방충망"
                actual="경기 / 청결한방충망"
                verdict="REGION_MISMATCH"
                tone="info"
              />
              <VerdictRow
                phone="070-9999-9999"
                expected="서울 강남구 / 테스트업체"
                actual="페이지 없음 (404)"
                verdict="DEAD"
                tone="danger"
              />
              <VerdictRow
                phone="070-4534-1234"
                expected="서울 마포구 / 마포안마"
                actual="서울 마포구 / 마포안마"
                verdict="OK"
                tone="success"
              />
            </div>
          </Card>
        </div>
      </section>

      {/* ───────────────────────── 4) 요금제 ───────────────────────── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            pricing
          </div>
          <h2 className="text-h2 text-ink">요금제</h2>
          <p className="text-body-sm text-ink-muted mt-1">
            모든 플랜에 자동 일일 검증, 즉시 알림, 이력 보고서가 기본 포함됩니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <PriceCard
            name="Free"
            price="0"
            period="7일 체험"
            highlight={false}
            features={[
              '5개 번호 등록',
              '매일 자동 검증',
              '이메일 알림',
              '7일 이력 보관',
            ]}
            cta="무료로 시작"
          />
          <PriceCard
            name="Basic"
            price="19,900"
            period="월"
            highlight={false}
            features={[
              '50개 번호 등록',
              '매일 자동 검증',
              '이메일 알림',
              '30일 이력 보관',
              '구글시트 연동',
            ]}
            cta="시작하기"
          />
          <PriceCard
            name="Pro"
            price="49,900"
            period="월"
            highlight={true}
            features={[
              '200개 번호 등록',
              '매일 자동 검증',
              '이메일 + 카카오 알림',
              '90일 이력 보관',
              '구글시트 실시간 연동',
              'PDF 보고서 자동 생성',
            ]}
            cta="시작하기"
          />
          <PriceCard
            name="Enterprise"
            price="99,900"
            period="월~"
            highlight={false}
            features={[
              '무제한 번호 등록',
              '시간당 검증 가능',
              'Slack / 웹훅 / API',
              '무제한 이력 보관',
              '전용 매니저',
            ]}
            cta="문의하기"
          />
        </div>
      </section>

      {/* ───────────────────────── 5) FAQ ───────────────────────── */}
      <section>
        <div className="mb-4">
          <div className="text-caption text-ink-muted uppercase tracking-wider font-semibold mb-1">
            faq
          </div>
          <h2 className="text-h2 text-ink">자주 묻는 질문</h2>
        </div>

        <div className="space-y-3">
          <FaqItem
            q="플레이스 ID 기반 검증이 기존 방식과 어떻게 다른가요?"
            a="기존 방식은 검색 결과 페이지를 분석해 노출 여부를 확인했지만, 본 솔루션은 변하지 않는 고유 키인 플레이스 ID로 직접 조회합니다. 응답 속도 0.2~0.3초/건, 정확도 99% 이상, 차단 위험이 매우 낮습니다."
          />
          <FaqItem
            q="070 번호만 등록하면 자동으로 동·상호도 인식되나요?"
            a="네. 070 번호로 검색해 첫 번째 매칭 플레이스를 찾고, 해당 플레이스의 ID·등록 동·상호명을 자동 추출해 저장합니다. 사용자는 070 번호 하나만 관리하면 됩니다."
          />
          <FaqItem
            q="잘못된 지역으로 노출되는 경우도 감지하나요?"
            a="네. '070 서초동 등록인데 인계동 노출' 같은 케이스를 4중 검증으로 정확히 감지합니다. 변경 노출(DONG_MISMATCH) 이벤트로 분류해 즉시 안내됩니다."
          />
          <FaqItem
            q="검증은 얼마나 자주 진행되나요?"
            a="기본 매일 새벽 03:00 KST에 1회 자동 실행됩니다. Pro 플랜은 일 2회, Enterprise 플랜은 시간당 1회까지 설정 가능합니다."
          />
          <FaqItem
            q="알림 채널은 어떤 것이 지원되나요?"
            a="이메일이 기본이며, Pro 플랜부터 카카오톡 알림, Enterprise 플랜에서는 Slack·웹훅·API 연동이 추가됩니다."
          />
          <FaqItem
            q="구글시트 실시간 연동이 무엇인가요?"
            a="등록·검증 결과·이력이 사용자 구글시트에 실시간으로 동기화됩니다. 사내 다른 시스템에서 곧바로 활용할 수 있습니다."
          />
        </div>
      </section>

      {/* ───────────────────────── 6) 하단 CTA ───────────────────────── */}
      <Card variant="cta" className="min-h-[180px] flex items-center">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 w-full">
          <div>
            <h3 className="text-h1 text-white mb-2">
              지금 무료로 시작해 보세요
            </h3>
            <p className="text-body-sm text-white/85">
              7일 무료 체험 · 카드 등록 불필요 · 5개 번호까지 자동 검증
            </p>
          </div>
          <Link to="/monitor" className="btn-cta-white">
            모니터링 시작하기 <ArrowRight size={16} />
          </Link>
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────── 서브 컴포넌트 ───────────────────────── */

interface PainCardProps {
  icon: React.ReactNode
  title: string
  desc: string
}

function PainCard({ icon, title, desc }: PainCardProps) {
  return (
    <Card variant="subtle" className="min-h-[180px]">
      <div className="w-10 h-10 rounded-2xl bg-white text-brand-600 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h4 className="text-h3 text-ink mb-2">{title}</h4>
      <p className="text-body-sm text-ink-muted leading-relaxed">{desc}</p>
    </Card>
  )
}

interface VerdictRowProps {
  phone: string
  expected: string
  actual: string
  verdict: string
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function VerdictRow({ phone, expected, actual, verdict, tone }: VerdictRowProps) {
  const toneClass = {
    success: 'bg-green-50 text-status-success border-green-200',
    warning: 'bg-amber-50 text-status-warning border-amber-200',
    danger: 'bg-red-50 text-status-danger border-red-200',
    info: 'bg-brand-50 text-brand-700 border-brand-200',
  }[tone]

  return (
    <div className="flex items-center justify-between p-3 rounded-2xl bg-bg-subtle/60">
      <div className="flex-1 min-w-0">
        <div className="text-body-sm text-ink font-semibold tabular-nums">{phone}</div>
        <div className="mt-1 text-caption text-ink-muted truncate">
          <span className="text-ink-soft">예상</span> {expected}
        </div>
        <div className="text-caption text-ink-muted truncate">
          <span className="text-ink-soft">실제</span> {actual}
        </div>
      </div>
      <span
        className={`ml-3 shrink-0 px-2.5 py-1 rounded-pill border text-caption font-bold ${toneClass}`}
      >
        {verdict}
      </span>
    </div>
  )
}

interface PriceCardProps {
  name: string
  price: string
  period: string
  highlight: boolean
  features: string[]
  cta: string
}

function PriceCard({ name, price, period, highlight, features, cta }: PriceCardProps) {
  return (
    <Card
      variant={highlight ? 'dark' : 'white'}
      className={`min-h-[400px] relative ${highlight ? 'ring-2 ring-brand-400' : ''}`}
    >
      {highlight && (
        <span className="absolute top-5 right-5 px-2.5 py-1 rounded-pill bg-white text-brand-700 text-caption font-bold">
          POPULAR
        </span>
      )}
      <div>
        <div className={`text-caption font-bold uppercase tracking-wider mb-2 ${highlight ? 'text-brand-200' : 'text-ink-muted'}`}>
          {name}
        </div>
        <div className="flex items-baseline gap-1">
          {price === '0' ? (
            <span className={`text-[36px] font-bold leading-none tracking-tight ${highlight ? 'text-white' : 'text-ink'}`}>
              FREE
            </span>
          ) : (
            <>
              <span className={`text-[32px] font-bold leading-none tracking-tight ${highlight ? 'text-white' : 'text-ink'}`}>
                ₩{price}
              </span>
              <span className={`text-body-sm ${highlight ? 'text-white/70' : 'text-ink-muted'}`}>
                / {period}
              </span>
            </>
          )}
          {price === '0' && (
            <span className={`text-body-sm ml-2 ${highlight ? 'text-white/70' : 'text-ink-muted'}`}>
              · {period}
            </span>
          )}
        </div>
      </div>

      <ul className="mt-6 space-y-2.5">
        {features.map((f) => (
          <li
            key={f}
            className={`flex items-start gap-2 text-body-sm ${highlight ? 'text-white/90' : 'text-ink-muted'}`}
          >
            <CheckCircle2
              size={16}
              className={`shrink-0 mt-0.5 ${highlight ? 'text-brand-300' : 'text-status-success'}`}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <Link
          to="/monitor"
          className={
            highlight
              ? 'btn-cta-white w-full justify-center'
              : 'btn-primary w-full justify-center'
          }
        >
          {cta}
        </Link>
      </div>
    </Card>
  )
}

interface FaqItemProps {
  q: string
  a: string
}

function FaqItem({ q, a }: FaqItemProps) {
  const [open, setOpen] = useState(false)
  return (
    <Card variant="white" noPadding>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left"
      >
        <span className="text-body text-ink font-semibold flex items-center gap-2">
          <ChevronRight
            size={16}
            className={`text-brand-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          {q}
        </span>
        <ChevronDown
          size={16}
          className={`text-ink-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0 -mt-1 text-body-sm text-ink-muted leading-relaxed border-t border-bg-subtle">
          <div className="pt-4">{a}</div>
        </div>
      )}
    </Card>
  )
}
