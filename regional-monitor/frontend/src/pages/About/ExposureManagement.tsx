/**
 * 타지역 노출 관리 — 네이버노출 자동체크 솔루션 요약 페이지
 * - 자동체크솔루션 핵심 가치를 도식·인포그래픽으로 요약
 * - 하단에 CTA: 네이버노출 자동체크 솔루션 무료플랜 신청
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Link } from 'react-router-dom'
import PageSeo, { buildBreadcrumbJsonLd } from '@/components/seo/PageSeo'
import {
  Radio,
  Eye,
  Bell,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  ArrowRight,
  ArrowDown,
  Zap,
  BarChart3,
  Megaphone,
  AlertTriangle,
  AlertCircle,
  Activity,
  Phone,
  PhoneOff,
  Search,
  HelpCircle,
  Calendar,
  DollarSign,
  Users,
  Building2,
  Network,
  Wallet,
  Wifi,
  RefreshCw,
  Frown,
  Hourglass,
} from 'lucide-react'

export default function ExposureManagement() {
  return (
    <div className="space-y-12">
      <PageSeo
        title="타지역 노출 관리 — 등록보다 유지가 더 중요합니다"
        description="네이버 1페이지 노출은 변동성이 매우 큽니다. 등록만 해놓고 손 놓고 있으면 노출은 어느 순간 사라집니다. 자동체크솔루션으로 24시간 감시하고 변경 발생 즉시 알림으로 매출 누수를 차단합니다."
        path="/about/exposure-management"
        keywords={[
          '타지역 노출관리',
          '네이버 노출 유지',
          '플레이스 모니터링',
          '노출 자동체크',
          '네이버 1페이지 변동',
          '플레이스 누락',
          '타지역닷컴',
        ]}
        jsonLd={buildBreadcrumbJsonLd([
          { name: '홈', path: '/' },
          { name: '타지역서비스 안내', path: '/about/what-is' },
          { name: '타지역 노출 관리', path: '/about/exposure-management' },
        ])}
      />
      <TopBar
        title="타지역 노출 관리"
        subtitle="네이버 노출은 등록보다 유지가 어렵습니다 — 자동체크솔루션으로 24시간 감시"
      />

      {/* 1) HERO ─────────────────────────────────── */}
      <Card
        variant="white"
        className="min-h-[280px] relative overflow-hidden bg-gradient-to-br from-rose-50/60 via-white to-amber-50/40 border border-rose-100"
      >
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          EXPOSURE <br /> MONITOR
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-body-sm font-bold mb-3">
            <Radio size={14} /> 네이버노출관리 자동체크솔루션
          </span>
          <h2 className="text-hero-sm text-ink mb-4 leading-tight">
            타지역서비스의 핵심은 <span className="text-rose-700">등록이 아니라</span><br />
            <span className="text-brand-700">"지금 네이버에 보이고 있는가"</span>입니다.
          </h2>
          <p className="text-2xl text-ink-muted leading-relaxed">
            가장 무서운 순간은 어느 날 갑자기<br />
            <strong className="text-rose-700">네이버 노출 플레이스가 사라져 전화가 뚝 끊기는 순간</strong>입니다.
          </p>
        </div>
      </Card>

      {/* B) 어느 날 전화가 끊기는 흐름 ─────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">scenario</div>
          <h2 className="text-h2 text-ink">어느 날 갑자기, 전화가 끊깁니다</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            어제까지는 분명 문의가 왔습니다. 그런데 이상하게 전화가 줄어듭니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
          <ScenarioStep tone="emerald" icon={<Phone size={20} />} label="어제까지 문의·상담·계약 진행" />
          <FlowConnector />
          <ScenarioStep tone="amber" icon={<TrendingDown size={20} />} label="이상하게 전화가 줄어듭니다" />
          <FlowConnector />
          <ScenarioStep tone="rose" icon={<PhoneOff size={20} />} label="어느 날 전화가 뚝 끊깁니다" />
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            '요즘 경기가 안 좋은가?',
            '광고 효과가 떨어졌나?',
            '경쟁업체가 늘었나?',
            '고객 문의가 줄었나?',
          ].map((q) => (
            <div
              key={q}
              className="flex items-start gap-2 px-3.5 py-3 rounded-card bg-white border border-amber-200"
            >
              <HelpCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="text-lg text-ink-muted leading-snug">{q}</span>
            </div>
          ))}
        </div>

        <Card variant="white" className="mt-5 bg-gradient-to-br from-rose-600 to-orange-500 text-white">
          <div className="max-w-3xl mx-auto py-2 text-center">
            <Search size={36} className="mx-auto mb-3 text-white" />
            <p className="text-2xl md:text-3xl font-bold leading-tight">
              직접 네이버에 검색해보니…<br />
              <span className="text-amber-100">내 타지역 플레이스가 사라져 있습니다.</span>
            </p>
          </div>
        </Card>
      </section>

      {/* C) 사장님의 억울함 — 손실 6가지 ──────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">hidden loss</div>
          <h2 className="text-h2 text-ink">사라져 있던 기간, 누가 보상해줄까요?</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            회선비·관리비는 계속 나갔는데, 정작 네이버에는 보이지 않았습니다.<br />
            <strong className="text-ink">이 손실은 눈에 보이지 않지만 실제로 매출에서 빠져나간 돈입니다.</strong>
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { icon: <PhoneOff size={20} />, label: '놓친 전화문의' },
            { icon: <Frown size={20} />, label: '놓친 상담' },
            { icon: <XCircle size={20} />, label: '놓친 계약' },
            { icon: <Wallet size={20} />, label: '낭비된 통신비' },
            { icon: <DollarSign size={20} />, label: '낭비된 관리비' },
            { icon: <Users size={20} />, label: '경쟁사로 넘어간 고객' },
          ].map((it) => (
            <Card
              key={it.label}
              variant="white"
              className="border border-rose-100 bg-gradient-to-br from-rose-50/40 to-white"
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center mb-2 shadow-card">
                {it.icon}
              </div>
              <p className="text-lg text-ink font-bold leading-snug">{it.label}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* D) 변덕스러운 네이버 ─────────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">unpredictable</div>
          <h2 className="text-h2 text-ink">변덕스러운 네이버, 예측 불가능한 노출</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            누구도 100% 정답을 말할 수 없습니다. 네이버 시스템·검색 로직·플레이스 기준은 계속 바뀝니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {[
            { left: '어제는 보였습니다', right: '오늘은 안 보일 수 있습니다' },
            { left: '한 지역은 보입니다', right: '다른 지역은 사라질 수 있습니다' },
            { left: '어떤 키워드는 노출됩니다', right: '어떤 키워드는 갑자기 빠질 수 있습니다' },
          ].map((it) => (
            <Card key={it.left} variant="white" className="border border-bg-subtle">
              <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-emerald-50 border border-emerald-100 mb-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span className="text-lg text-emerald-700 font-semibold">{it.left}</span>
              </div>
              <ArrowDown size={18} className="text-ink-soft mx-auto mb-2" />
              <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-rose-50 border border-rose-100">
                <XCircle size={16} className="text-rose-500 shrink-0" />
                <span className="text-lg text-rose-700 font-semibold">{it.right}</span>
              </div>
            </Card>
          ))}
        </div>

        <Card variant="white" className="bg-gradient-to-br from-amber-50 via-white to-amber-50 border-2 border-amber-300">
          <div className="max-w-3xl mx-auto py-3 text-center">
            <AlertCircle size={36} className="mx-auto mb-3 text-amber-600" />
            <h3 className="text-h2 text-ink leading-tight mb-2">
              네이버는 <span className="text-rose-700">노출을 보장하지 않습니다.</span>
            </h3>
            <p className="text-xl text-ink-muted leading-relaxed">
              네이버는 검색 결과를 제공하는 플랫폼이지,<br />
              타지역서비스 회선의 노출을 책임지는 기관이 아닙니다.
            </p>
          </div>
        </Card>
      </section>

      {/* E) 구조적 한계 — 5 주체 책임 매트릭스 ────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">structural gap</div>
          <h2 className="text-h2 text-ink">타지역서비스에는 "노출 책임자"가 없습니다</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            5개 주체가 얽혀 있지만, 어느 누구도 노출 유지를 보장하지 않습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[
            { icon: <Wifi size={22} />, role: '통신사', work: '070 번호 개통·회선 유지', limit: '네이버 노출 책임 ✕' },
            { icon: <Phone size={22} />, role: '114 / 전화번호 안내', work: '업체 정보 등록·검색 반영', limit: '순위·유지 책임 ✕' },
            { icon: <Search size={22} />, role: '네이버', work: '외부 데이터 수집·반영', limit: '노출 보장 의무 ✕' },
            { icon: <Network size={22} />, role: '대행·관리사', work: '등록·점검·재등록 지원', limit: '네이버 직접 컨트롤 ✕' },
            { icon: <Building2 size={22} />, role: '사장님', work: '비용 부담·영업 기대', limit: '미노출 시 매출 손실' },
          ].map((it) => (
            <Card key={it.role} variant="white" className="h-full border border-bg-subtle">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-500 text-white flex items-center justify-center mb-2 shadow-card">
                {it.icon}
              </div>
              <h3 className="text-xl font-bold text-ink mb-1.5 leading-tight">{it.role}</h3>
              <p className="text-lg text-ink-muted leading-snug mb-2">{it.work}</p>
              <div className="px-2.5 py-1.5 rounded-md bg-rose-50 border border-rose-100 text-body-sm text-rose-700 font-semibold">
                {it.limit}
              </div>
            </Card>
          ))}
        </div>

        <Card variant="white" className="mt-5 bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto py-3 text-center">
            <p className="text-2xl md:text-3xl text-white font-bold leading-tight">
              결국 노출이 사라져도<br />
              <span className="text-amber-200">어디에 항의할지, 누가 보상할지 정답이 없습니다.</span>
            </p>
          </div>
        </Card>
      </section>

      {/* F) 미노출이 생기는 11가지 이유 ──────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">causes</div>
          <h2 className="text-h2 text-ink">네이버 미노출은 누구의 잘못만으로 보기 어렵습니다</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            아무리 관리해도 시스템 변화·로직 변경으로 갑자기 발생할 수 있는 문제 11가지.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {[
            '네이버 로직 변경',
            '데이터 반영 지연',
            '상호 키워드 인식 문제',
            '지역 검색 반영 오류',
            '114 데이터 수집 문제',
            '경쟁업체 신고',
            '유사 상호 중복',
            '플레이스 정책 변화',
            '일시적 노출 누락',
            '특정 키워드 미반응',
            '지도 데이터 재정렬',
            '기타 외부 변수',
          ].map((c, i) => (
            <div
              key={c}
              className="flex items-center gap-2 px-3 py-2.5 rounded-card bg-white border border-bg-subtle"
            >
              <span className="text-body-sm font-mono text-ink-muted w-5 shrink-0">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-lg text-ink leading-snug">{c}</span>
            </div>
          ))}
        </div>
      </section>

      {/* G) 진짜 문제: 늦게 발견하는 것 ──────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-rose-50 via-white to-amber-50 border-2 border-rose-200">
          <div className="max-w-3xl mx-auto py-3 text-center mb-5">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white text-rose-700 text-body-sm font-bold shadow-sm mb-3">
              ⏰ 진짜 문제
            </span>
            <h2 className="text-h1 text-ink leading-tight">
              미노출 자체가 아니라<br />
              <span className="text-rose-700">"늦게 발견"하는 것이 문제입니다</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { day: '하루', loss: '하루치 문의 손실' },
              { day: '3일', loss: '상담·계약 기회 손실' },
              { day: '일주일', loss: '고객 대부분 경쟁사로 이동' },
            ].map((it) => (
              <Card key={it.day} variant="white" className="border border-rose-100 text-center">
                <Hourglass size={24} className="text-rose-500 mx-auto mb-2" />
                <div className="text-h3 text-rose-700 font-bold mb-1">{it.day} 사라지면</div>
                <p className="text-lg text-ink-muted leading-snug">{it.loss}</p>
              </Card>
            ))}
          </div>
        </Card>
      </section>

      {/* H) 미노출 기간별 손실 테이블 ─────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">damage by period</div>
          <h2 className="text-h2 text-ink">미노출 기간이 길어질수록 손해는 커집니다</h2>
        </div>

        <Card variant="white" className="overflow-hidden p-0">
          <div className="grid grid-cols-3 bg-bg-subtle px-4 py-3 border-b border-bg-subtle">
            <div className="text-body-sm font-bold text-ink uppercase tracking-wider">미노출 기간</div>
            <div className="col-span-2 text-body-sm font-bold text-ink uppercase tracking-wider">발생 가능한 손실</div>
          </div>
          {[
            { period: '1일', tone: 'amber', loss: '당일 문의 감소, 긴급 고객 이탈' },
            { period: '3일', tone: 'amber', loss: '상담 건수 하락, 경쟁사 유입 증가' },
            { period: '7일', tone: 'orange', loss: '광고 효율 악화, 통신비·관리비 낭비' },
            { period: '15일+', tone: 'rose', loss: '지역 노출 공백 장기화, 매출 손실 누적' },
            { period: '1개월', tone: 'rose', loss: '회선 유지비만 지출, 사장님 불신 증가' },
          ].map((row) => {
            const tc = {
              amber: 'bg-amber-50 text-amber-700 border-amber-200',
              orange: 'bg-orange-50 text-orange-700 border-orange-200',
              rose: 'bg-rose-50 text-rose-700 border-rose-200',
            }[row.tone as 'amber' | 'orange' | 'rose']
            return (
              <div
                key={row.period}
                className="grid grid-cols-3 px-4 py-3.5 border-b border-bg-subtle last:border-b-0 items-center"
              >
                <div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-body-sm font-bold ${tc}`}>
                    <Calendar size={13} /> {row.period}
                  </span>
                </div>
                <div className="col-span-2 text-lg text-ink leading-relaxed">{row.loss}</div>
              </div>
            )
          })}
        </Card>

        <Card variant="white" className="mt-4 bg-rose-600 text-white">
          <div className="max-w-3xl mx-auto py-2 text-center">
            <p className="text-2xl md:text-2xl text-white font-bold leading-snug">
              미노출은 단순한 오류가 아닙니다 —<br />
              <span className="text-amber-200">전화문의 중단 · 광고비 손실 · 매출 기회 상실</span>입니다.
            </p>
          </div>
        </Card>
      </section>

      {/* I) 조기 발견 시 가능한 7가지 조치 ─────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">early action</div>
          <h2 className="text-h2 text-ink">조기 발견 → 조기 재노출 작업이 가능합니다</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            빨리 알아야 빨리 조치할 수 있습니다. 미노출 발견 시 가능한 7가지 대응.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[
            '상호 변경 검토',
            '키워드 조합 수정',
            '게재불요 여부 점검',
            '해지 후 재등록 검토',
            '114 등록 상태 확인',
            '노출 키워드 재분석',
            '경쟁업체 신고 가능성 점검',
          ].map((t, i) => (
            <Card key={t} variant="white" className="border border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-body-sm font-bold shrink-0">
                  {i + 1}
                </span>
                <span className="text-lg text-ink font-semibold leading-snug">{t}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* J) 사람 vs 시스템 ─────────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">human vs system</div>
          <h2 className="text-h2 text-ink">사람이 매일 모든 회선을 확인할 수는 없습니다</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            10개·50개·100개·1,000개로 늘어나면, 직접 검색은 현실적으로 불가능합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card variant="white" className="border border-bg-subtle">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold">
                😓 사람 (수동 확인)
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '하루 1~2시간이 검색에 소비',
                '회선 수가 늘면 누락이 발생',
                '문제를 늦게야 발견',
                '24시간 감시는 불가능',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-1" />
                  <span className="text-lg text-ink-muted leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="white" className="border-2 border-emerald-300 bg-gradient-to-br from-emerald-50/40 to-white">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-emerald-100 text-emerald-700 text-body-sm font-bold">
                🤖 시스템 (자동 체크)
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '매일 자동으로 모든 회선 검색',
                '지역·키워드 매트릭스 일괄 점검',
                '미노출 즉시 감지·기록',
                '24시간 365일 감시',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-1" />
                  <span className="text-lg text-ink leading-relaxed font-medium">{t}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* K) 자동 체크가 필요한 5가지 이유 ────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">5 reasons</div>
          <h2 className="text-h2 text-ink">자동 체크가 필요한 5가지 이유</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            "사람은 놓칠 수 있지만, 시스템은 매일 확인할 수 있습니다."
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              num: '01',
              tone: 'rose',
              icon: <Hourglass size={22} />,
              title: '미노출 조기 발견 → 손실 최소화',
              desc: '하루라도 빨리 발견하면 그만큼 문의 손실을 줄일 수 있습니다.',
            },
            {
              num: '02',
              tone: 'amber',
              icon: <Search size={22} />,
              title: '전화 감소 원인 빠르게 파악',
              desc: '경기 탓인지, 광고 탓인지, 노출 탓인지 데이터로 즉시 판단합니다.',
            },
            {
              num: '03',
              tone: 'brand',
              icon: <Wallet size={22} />,
              title: '통신비·관리비 낭비 방지',
              desc: '미노출이 길어지면 070 통신비·관리비만 새 나가는 구조를 막습니다.',
            },
            {
              num: '04',
              tone: 'teal',
              icon: <RefreshCw size={22} />,
              title: '경쟁사 신고·로직 변경에 빠른 대응',
              desc: '예고 없는 미노출을 자동 모니터링이 즉시 잡아냅니다.',
            },
            {
              num: '05',
              tone: 'emerald',
              icon: <ShieldCheck size={22} />,
              title: '사장님–관리사 신뢰 유지',
              desc: '변명 대신 데이터로 대응. 감이 아닌 상태로 확인합니다.',
            },
          ].map((it) => {
            const tc = {
              rose: { bg: 'from-rose-500 to-orange-500', text: 'text-rose-700' },
              amber: { bg: 'from-amber-500 to-orange-500', text: 'text-amber-700' },
              brand: { bg: 'from-brand-500 to-indigo-500', text: 'text-brand-700' },
              teal: { bg: 'from-teal-500 to-cyan-500', text: 'text-teal-700' },
              emerald: { bg: 'from-emerald-500 to-teal-500', text: 'text-emerald-700' },
            }[it.tone as 'rose' | 'amber' | 'brand' | 'teal' | 'emerald']
            return (
              <Card key={it.num} variant="white" className="h-full relative">
                <div className="absolute top-3 right-4 text-[28px] leading-none font-light text-ink-watermark/60 select-none">
                  {it.num}
                </div>
                <div
                  className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${tc.bg} text-white flex items-center justify-center mb-3 shadow-card`}
                >
                  {it.icon}
                </div>
                <h3 className={`text-xl font-bold text-ink mb-2 leading-tight ${tc.text}`}>{it.title}</h3>
                <p className="text-lg text-ink-muted leading-relaxed">{it.desc}</p>
              </Card>
            )
          })}
        </div>
      </section>

      {/* L) 새로운 기준 — 등록 개수 vs 노출 유지 ─── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">new standard</div>
          <h2 className="text-h2 text-ink">네이버 노출 관리의 새로운 기준</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card variant="white" className="border border-bg-subtle relative overflow-hidden">
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold">
              과거
            </span>
            <div className="w-11 h-11 rounded-2xl bg-bg-subtle text-ink-muted flex items-center justify-center mb-3">
              <Building2 size={22} />
            </div>
            <h3 className="text-h3 text-ink mb-2 leading-tight">"몇 개를 등록했느냐"</h3>
            <p className="text-lg text-ink-muted leading-relaxed line-through">
              많이 등록하는 것이 경쟁력
            </p>
            <p className="text-lg text-rose-700 font-semibold leading-relaxed mt-2">
              ✕ 안 보이면 천 개도 의미 없습니다
            </p>
          </Card>

          <Card variant="white" className="border-2 border-emerald-300 bg-gradient-to-br from-emerald-50/40 to-white relative overflow-hidden">
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-pill bg-emerald-100 text-emerald-700 text-body-sm font-bold">
              지금
            </span>
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white flex items-center justify-center mb-3 shadow-card">
              <Eye size={22} />
            </div>
            <h3 className="text-h3 text-ink mb-2 leading-tight">"몇 개가 지금 보이느냐"</h3>
            <p className="text-lg text-ink leading-relaxed font-semibold">
              노출 유지 관리가 핵심
            </p>
            <p className="text-lg text-emerald-700 font-bold leading-relaxed mt-2">
              ✓ 보여야 매출이 됩니다
            </p>
          </Card>
        </div>
      </section>

      {/* M) 강한 후킹 — 노출 자동 체크 결론 ──────── */}
      <section>
        <Card variant="white" className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-indigo-700 to-rose-600 text-white">
          <div className="max-w-3xl mx-auto py-6 text-center">
            <Megaphone size={42} className="mx-auto mb-4 text-white" />
            <p className="text-3xl md:text-4xl text-white font-bold leading-tight mb-4">
              어느 날 갑자기 전화가 끊겼다면,<br />
              <span className="text-amber-100">고객이 사라진 것이 아니라</span><br />
              <span className="text-amber-100">네이버에서 우리 업체가 사라졌을 수 있습니다.</span>
            </p>
            <p className="text-2xl text-white/95 leading-relaxed mb-5">
              미노출을 막을 수 없다면,<br />
              <strong className="text-amber-100">최소한 늦게 발견해서는 안 됩니다.</strong>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-5">
              {[
                '매일 자동 검색',
                '미노출 조기 발견',
                '재노출 작업 즉시 시작',
              ].map((t) => (
                <div
                  key={t}
                  className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-card bg-white/15 backdrop-blur-sm border border-white/30"
                >
                  <CheckCircle2 size={20} className="text-amber-200 shrink-0" />
                  <span className="text-lg text-white font-bold">{t}</span>
                </div>
              ))}
            </div>

            <p className="text-2xl text-amber-100 font-bold leading-snug">
              타지역서비스의 진짜 관리는<br />
              등록이 끝난 뒤부터 시작됩니다.
            </p>
          </div>
        </Card>
      </section>

      {/* ═══════════════════ 기존 콘텐츠 ═══════════════════ */}

      {/* 2) 노출 변동 현실 ─────────────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            the reality
          </div>
          <h2 className="text-h2 text-ink">왜 노출 관리가 필요할까요?</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            네이버 플레이스 노출은 살아있는 시스템입니다. 한 번 등록했다고 끝나지 않습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: <AlertTriangle size={22} />,
              title: '경쟁 업체 신규 등록',
              desc: '같은 키워드에 더 좋은 30자 조합을 가진 경쟁자가 등장하면 내 순위가 밀립니다.',
            },
            {
              icon: <Activity size={22} />,
              title: '네이버 알고리즘 변동',
              desc: '주기적인 알고리즘 업데이트로 어제 1페이지였던 키워드가 오늘 사라질 수 있습니다.',
            },
            {
              icon: <Clock size={22} />,
              title: '직접 매일 확인 불가',
              desc: '수십 개 키워드 × 수십 개 지역을 매일 손으로 검색해 확인하는 것은 현실적으로 불가능합니다.',
            },
          ].map((it) => (
            <Card key={it.title} variant="white" className="border border-rose-100 h-full">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center mb-3 shadow-card">
                {it.icon}
              </div>
              <h3 className="text-xl font-bold text-ink mb-2 leading-tight">{it.title}</h3>
              <p className="text-lg text-ink-muted leading-relaxed">{it.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* 3) 비교: 직접 vs 자동체크 ────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            comparison
          </div>
          <h2 className="text-h2 text-ink">직접 확인 vs 자동체크솔루션</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card variant="white" className="border border-bg-subtle">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold">
                😓 직접 매일 검색
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '하루 30분~1시간 검색에 소비',
                '키워드를 자주 빠뜨리거나 잊어버림',
                '순위 변동 기록이 남지 않음',
                '문제 발생 시 뒤늦게 알게 됨',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-1" />
                  <span className="text-lg text-ink-muted leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card variant="white" className="border-2 border-emerald-300 bg-gradient-to-br from-emerald-50/40 to-white">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-emerald-100 text-emerald-700 text-body-sm font-bold">
                ✅ 자동체크솔루션
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                '24시간 자동으로 키워드별 순위 체크',
                '등록한 모든 지역·키워드 일괄 모니터링',
                '순위 변동 이력이 자동 기록·시각화',
                '이탈 즉시 알림으로 빠른 대응',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-1" />
                  <span className="text-lg text-ink leading-relaxed font-medium">{t}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* 4) 솔루션 4대 핵심 기능 ─────────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            core features
          </div>
          <h2 className="text-h2 text-ink">자동체크솔루션 4대 핵심 기능</h2>
          <p className="text-xl text-ink-muted mt-2 leading-relaxed">
            등록한 타지역서비스의 노출 상태를 자동으로 추적하고 관리합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureCard
            num="01"
            tone="brand"
            icon={<Eye size={22} />}
            title="실시간 순위 모니터링"
            desc="등록한 지역·키워드 조합을 매일 자동으로 검색해 네이버 1페이지 노출 여부를 체크합니다."
            bullets={['지역 × 키워드 매트릭스', '플레이스 섹션 순위 추적', '히스토리 누적']}
          />
          <FeatureCard
            num="02"
            tone="amber"
            icon={<Bell size={22} />}
            title="이탈 즉시 알림"
            desc="1페이지에서 사라지거나 순위가 급락하면 즉시 감지합니다. 뒤늦게 알아 매출이 빠지는 일을 막아줍니다."
            bullets={['순위 이탈 감지', '급락 경보', '즉시 대응 가이드']}
          />
          <FeatureCard
            num="03"
            tone="teal"
            icon={<BarChart3 size={22} />}
            title="히스토리 대시보드"
            desc="모든 키워드의 순위 변동 이력이 자동 기록되어 추세를 한눈에 볼 수 있습니다. 어떤 키워드가 안정적인지, 어떤 키워드가 흔들리는지 데이터로 확인."
            bullets={['일별 순위 그래프', '키워드별 안정도', '지역별 노출률']}
          />
          <FeatureCard
            num="04"
            tone="emerald"
            icon={<Target size={22} />}
            title="개선 키워드 제안"
            desc="이탈한 키워드는 새로운 30자 조합으로 재설계하거나 골든 콤보를 다시 발굴해 노출을 회복할 수 있도록 가이드합니다."
            bullets={['재설계 제안', '대체 키워드', '경쟁 분석 연계']}
          />
        </div>
      </section>

      {/* 5) 자동체크 흐름 (5단계) ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            workflow
          </div>
          <h2 className="text-h2 text-ink">자동체크솔루션 작동 흐름</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
          <FlowCard num="1" icon={<Zap size={20} />} label="등록한 키워드·지역 자동 수집" />
          <FlowConnector />
          <FlowCard num="2" icon={<Eye size={20} />} label="매일 네이버 검색 자동 실행" />
          <FlowConnector />
          <FlowCard num="3" icon={<BarChart3 size={20} />} label="순위 결과 기록·분석" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 mt-2.5">
          <FlowCard num="4" icon={<Bell size={20} />} label="이탈·급락 알림 발송" tone="amber" />
          <FlowConnector />
          <FlowCard num="5" icon={<TrendingUp size={20} />} label="개선 가이드 제공" tone="emerald" />
          <div className="hidden md:block" />
          <div className="hidden md:block" />
        </div>
      </section>

      {/* 6) 매출 흐름 ─────────────────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto py-4 text-center">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white/15 backdrop-blur-sm text-amber-200 text-body-sm font-bold mb-4 border border-white/20">
              💡 보여야 매출이 됩니다
            </span>
            <h2 className="text-h1 text-white mb-4 leading-tight">
              유지되는 노출이<br />
              <span className="text-amber-200">진짜 매출이 됩니다.</span>
            </h2>
            <p className="text-2xl text-white/95 leading-relaxed mb-6">
              한 번 1페이지에 떴다고 끝이 아닙니다.<br />
              <strong className="text-white">계속 보여야 계속 전화가 옵니다.</strong>
            </p>

            <Card variant="white" className="bg-white/10 backdrop-blur-sm border border-white/20">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
                <FlowStep tone="white" icon={<Eye size={20} />} label="유지된 노출" />
                <FlowArrowWhite />
                <FlowStep tone="white" icon={<Phone size={20} />} label="지속되는 문의" />
                <FlowArrowWhite />
                <FlowStep tone="white" icon={<TrendingUp size={20} />} label="안정적 매출" />
              </div>
            </Card>
          </div>
        </Card>
      </section>

      {/* 7) 강한 후킹 ─────────────────────────── */}
      <section>
        <Card variant="white" className="relative overflow-hidden bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 text-white">
          <div className="max-w-3xl mx-auto py-6 text-center">
            <Megaphone size={42} className="mx-auto mb-4 text-white" />
            <p className="text-3xl md:text-4xl text-white font-bold leading-tight mb-4">
              모르는 사이에 노출이 사라지면<br />
              <span className="text-amber-100">광고비만 새 나갑니다.</span>
            </p>
            <p className="text-2xl text-white/95 leading-relaxed mb-5">
              사장님 대신 매일 24시간 노출을 지켜드립니다.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-5">
              {[
                '직접 검색할 시간 0',
                '이탈 감지 자동화',
                '대응 속도 10배',
              ].map((t) => (
                <div
                  key={t}
                  className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-card bg-white/15 backdrop-blur-sm border border-white/30"
                >
                  <CheckCircle2 size={20} className="text-white shrink-0" />
                  <span className="text-lg text-white font-bold">{t}</span>
                </div>
              ))}
            </div>

            <p className="text-2xl text-amber-100 font-bold leading-snug">
              보여야 매출이 됩니다.
            </p>
          </div>
        </Card>
      </section>

      {/* 8) CTA — 무료플랜 ────────────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-2">
            🎁 타지역닷컴 위탁 시 100% 무료
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            지금 등록한 키워드,<br />
            <span className="text-rose-700">자동으로 지켜드립니다</span>
          </h2>
          <p className="text-xl text-ink-muted mt-3 leading-relaxed">
            등록·관리만 맡기시면 자동체크솔루션을 무료로 사용할 수 있습니다.<br />
            <strong className="text-ink">노출이 살아있는 동안에만 매출이 발생합니다.</strong>
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <Card
            variant="white"
            className="relative overflow-hidden ring-2 ring-rose-200 bg-gradient-to-br from-rose-50/40 to-white"
          >
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-[11px] font-bold">
              🎁 FREE PLAN
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center mb-4 shadow-card">
              <ShieldCheck size={26} />
            </div>
            <div className="text-body-sm font-mono text-rose-700 mb-1">CTA</div>
            <h3 className="text-h2 text-ink leading-tight mb-2">
              네이버노출 자동체크 솔루션
            </h3>
            <p className="text-2xl font-bold text-rose-700 mb-4 leading-tight">
              무료플랜 신청하기
            </p>
            <ul className="space-y-2 mb-5">
              {[
                '등록 키워드 자동 모니터링',
                '이탈·급락 알림 무료 제공',
                '순위 히스토리 대시보드',
                '개선 키워드 가이드',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-1" />
                  <span className="text-lg text-ink leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
            <Link
              to="/intro/monitor"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-4 rounded-pill text-white font-bold text-xl bg-rose-600 hover:bg-rose-700 transition-colors shadow-card"
            >
              무료플랜 신청하기 <ArrowRight size={18} />
            </Link>
          </Card>
        </div>
      </section>
    </div>
  )
}

/* ════════════════════ 하위 컴포넌트 ════════════════════ */

interface FeatureCardProps {
  num: string
  tone: 'brand' | 'amber' | 'teal' | 'emerald'
  icon: React.ReactNode
  title: string
  desc: string
  bullets: string[]
}

function ScenarioStep({
  tone,
  icon,
  label,
}: {
  tone: 'emerald' | 'amber' | 'rose'
  icon: React.ReactNode
  label: string
}) {
  const tc = {
    emerald: 'from-emerald-500 to-teal-500 text-emerald-700 border-emerald-200 bg-emerald-50',
    amber: 'from-amber-500 to-orange-500 text-amber-700 border-amber-200 bg-amber-50',
    rose: 'from-rose-500 to-orange-500 text-rose-700 border-rose-200 bg-rose-50',
  }[tone]
  const [accent, , border, bg] = tc.split(' ')
  return (
    <Card variant="white" className={`text-center h-full md:col-span-1 border ${border} ${bg}`}>
      <div
        className={`w-11 h-11 mx-auto rounded-2xl bg-gradient-to-br ${accent} text-white flex items-center justify-center mb-2 shadow-card`}
      >
        {icon}
      </div>
      <p className="text-lg text-ink font-semibold leading-snug">{label}</p>
    </Card>
  )
}

function FeatureCard({ num, tone, icon, title, desc, bullets }: FeatureCardProps) {
  const tc = {
    brand: { accent: 'from-brand-500 to-indigo-500', text: 'text-brand-700', dot: 'bg-brand-500' },
    amber: { accent: 'from-amber-500 to-orange-500', text: 'text-amber-700', dot: 'bg-amber-500' },
    teal: { accent: 'from-teal-500 to-cyan-500', text: 'text-teal-700', dot: 'bg-teal-500' },
    emerald: { accent: 'from-emerald-500 to-teal-500', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  }[tone]
  return (
    <Card variant="white" className="h-full relative">
      <div className="absolute top-4 right-4 text-[28px] leading-none font-light text-ink-watermark/60 select-none">
        {num}
      </div>
      <div
        className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center mb-3 shadow-card`}
      >
        {icon}
      </div>
      <h3 className="text-h3 text-ink leading-tight mb-2">{title}</h3>
      <p className="text-lg text-ink-muted leading-relaxed mb-3">{desc}</p>
      <ul className="space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`} />
            <span className={`text-lg font-semibold ${tc.text}`}>{b}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function FlowCard({
  num,
  icon,
  label,
  tone = 'brand',
}: {
  num: string
  icon: React.ReactNode
  label: string
  tone?: 'brand' | 'amber' | 'emerald'
}) {
  const tc = {
    brand: 'from-brand-500 to-indigo-500',
    amber: 'from-amber-500 to-orange-500',
    emerald: 'from-emerald-500 to-teal-500',
  }[tone]
  return (
    <Card variant="white" className="text-center h-full md:col-span-1">
      <div
        className={`w-11 h-11 mx-auto rounded-2xl bg-gradient-to-br ${tc} text-white flex items-center justify-center mb-2 shadow-card`}
      >
        {icon}
      </div>
      <div className="text-body-sm font-mono text-ink-muted mb-1">STEP {num}</div>
      <p className="text-lg text-ink font-semibold leading-snug">{label}</p>
    </Card>
  )
}

function FlowConnector() {
  return (
    <div className="flex items-center justify-center text-ink-soft md:col-span-1">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowDown size={22} className="md:hidden" />
    </div>
  )
}

function FlowStep({
  tone,
  icon,
  label,
}: {
  tone: 'brand' | 'amber' | 'emerald' | 'white'
  icon: React.ReactNode
  label: string
}) {
  const tc = {
    brand: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    white: 'bg-white/15 text-white border-white/30 backdrop-blur-sm',
  }[tone]
  return (
    <div className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-4 rounded-card border ${tc}`}>
      {icon}
      <span className="text-lg font-bold text-center">{label}</span>
    </div>
  )
}

function FlowArrowWhite() {
  return (
    <div className="flex items-center justify-center text-white/80">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowDown size={22} className="md:hidden" />
    </div>
  )
}
