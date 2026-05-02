/**
 * 타지역 키워드로직 — 인포그래픽 풀버전
 * - 도식·인포그래픽으로 키워드 로직 설명
 * - 하단에 6 카테고리 DNA / 파이프라인 4단계 / 골든 콤보 + CTA 3개 유지
 */
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Link } from 'react-router-dom'
import {
  Search,
  Layers,
  Cpu,
  GitBranch,
  Target,
  ArrowRight,
  ArrowDown,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Megaphone,
  Lightbulb,
  Zap,
  TrendingUp,
  Phone,
  FileText,
  Type,
  Award,
  Eye,
  Dna,
  Compass,
} from 'lucide-react'

export default function KeywordLogic() {
  return (
    <div className="space-y-12">
      <TopBar
        title="타지역 키워드로직"
        subtitle="네이버 1페이지에 뜨는 키워드는 따로 있습니다 — 30자 상호 키워드 로직 분석"
      />

      {/* ───────────────── 1) HERO ───────────────── */}
      <Card variant="white" className="min-h-[280px] relative overflow-hidden bg-gradient-to-br from-brand-50/60 via-white to-indigo-50/40 border border-brand-100">
        <div className="absolute top-6 left-7 text-[42px] leading-none font-light text-ink-watermark/70 select-none pointer-events-none tracking-tight">
          KEYWORD <br /> LOGIC
        </div>
        <div className="pt-28 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-bold mb-3">
            <Cpu size={14} /> 타지역서비스 키워드 로직이란?
          </span>
          <h2 className="text-hero-sm text-ink mb-4 leading-tight">
            타지역플레이스는 <span className="text-rose-700">콘텐츠 싸움이 아닙니다.</span><br />
            <span className="text-brand-600">30자 상호 키워드 조합 싸움</span>입니다.
          </h2>
          <p className="text-xl text-ink-muted leading-relaxed">
            많은 사장님들이 네이버플레이스를 등록하면 블로그처럼 글을 쓰고, 사진을 올리고, 후기를 쌓으면
            자연스럽게 노출될 것이라고 생각합니다.<br />
            <strong className="text-ink">하지만 타지역플레이스는 다릅니다.</strong>
          </p>
        </div>
      </Card>

      {/* ───────────────── 2) 메인플레이스 vs 타지역플레이스 비교 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">structure difference</div>
          <h2 className="text-h2 text-ink">메인플레이스 vs 타지역플레이스</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            노출의 핵심은 따로 있습니다. 바로 <strong className="text-ink">상호명 30자 안에 어떤 키워드를 어떻게 조합하느냐</strong>입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 좌: 메인플레이스 */}
          <Card variant="white" className="border border-bg-subtle">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-bg-subtle text-ink-muted text-body-sm font-bold">
                📝 메인플레이스
              </span>
            </div>
            <h3 className="text-h3 text-ink mb-4">콘텐츠·지수 누적 구조</h3>
            <div className="space-y-2.5">
              {[
                { icon: <FileText size={18} />, t: '블로그처럼 글·사진·게시물 누적' },
                { icon: <Eye size={18} />, t: '리뷰·방문 지수로 점진적 상승' },
                { icon: <TrendingUp size={18} />, t: '시간이 지날수록 노출 강화' },
              ].map((b) => (
                <div key={b.t} className="flex items-center gap-2.5 px-4 py-3 rounded-card bg-bg-subtle/50">
                  <span className="text-ink-muted">{b.icon}</span>
                  <span className="text-base text-ink-muted">{b.t}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 우: 타지역플레이스 */}
          <Card variant="white" className="border-2 border-brand-300 bg-gradient-to-br from-brand-50/40 to-white relative">
            <span className="absolute -top-2 -right-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-brand-600 text-white text-[11px] font-bold shadow-card">
              ⚡ HERE
            </span>
            <div className="flex items-center gap-2 mb-3">
              <span className="px-3 py-1.5 rounded-pill bg-brand-50 text-brand-700 text-body-sm font-bold">
                🎯 타지역플레이스
              </span>
            </div>
            <h3 className="text-h3 text-ink mb-4">상호 30자 키워드 조합 구조</h3>
            <div className="space-y-2.5">
              {[
                { icon: <Type size={18} />, t: '상호 30자 안의 키워드가 노출의 거의 전부' },
                { icon: <Cpu size={18} />, t: '네이버 봇이 형태소 단위로 읽고 매칭' },
                { icon: <Zap size={18} />, t: '키워드 조합이 정확하면 즉시 노출' },
              ].map((b) => (
                <div key={b.t} className="flex items-center gap-2.5 px-4 py-3 rounded-card bg-white border border-brand-200">
                  <span className="text-brand-600">{b.icon}</span>
                  <span className="text-base text-ink font-medium">{b.t}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* 결론 */}
        <Card variant="white" className="mt-5 bg-brand-600 text-white">
          <div className="flex items-center gap-3">
            <Lightbulb size={32} className="shrink-0 text-amber-200" />
            <p className="text-2xl leading-snug font-bold">
              타지역플레이스는 <span className="text-amber-200">예쁜 이름보다</span><br />
              <strong>노출되는 이름</strong>이 중요합니다.
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 3) 상호 = 키워드 설계도 ───────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-amber-50 text-amber-700 text-body-sm font-bold mb-3">
            💡 사장님, 상호명은 간판이 아닙니다
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            상호명은 <span className="text-brand-700">네이버 봇에게 읽히는 키워드 설계도</span>입니다
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <Card variant="white" className="border border-bg-subtle">
            <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-2">오프라인</div>
            <p className="text-xl text-ink leading-snug font-bold">
              상호 = <span className="text-ink">브랜드</span>
            </p>
            <p className="text-base text-ink-muted leading-relaxed mt-2">
              사람들이 보고 기억하는 간판
            </p>
          </Card>
          <Card variant="white" className="border-2 border-brand-300 bg-brand-50/40">
            <div className="text-body-sm text-brand-700 uppercase tracking-wider font-bold mb-2">네이버 플레이스</div>
            <p className="text-xl text-ink leading-snug font-bold">
              상호 = <span className="text-brand-700">검색 신호</span>
            </p>
            <p className="text-base text-ink-muted leading-relaxed mt-2">
              네이버 봇이 형태소로 읽고 검색어와 매칭
            </p>
          </Card>
        </div>

        {/* 검색어 매칭 도식 */}
        <Card variant="white">
          <p className="text-lg text-ink leading-relaxed mb-4">
            예를 들어 고객이 이런 검색어를 입력한다면, <strong className="text-brand-700">상호 안 키워드</strong>에 따라 노출 가능성이 완전히 달라집니다.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {['컴퓨터수리', '노트북수리', '데이터복구', '누수탐지', '하수구막힘'].map((q) => (
              <div key={q} className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-card bg-amber-50 border border-amber-200">
                <Search size={16} className="text-amber-600 shrink-0" />
                <span className="text-base text-ink font-semibold">{q}</span>
              </div>
            ))}
          </div>
          <Card variant="white" className="mt-4 bg-rose-50/50 border border-rose-200">
            <p className="text-lg text-ink leading-relaxed">
              타지역플레이스는 <strong className="text-rose-700">그냥 많이 등록한다고 되는 것이 아닙니다.</strong><br />
              <strong className="text-brand-700">어떤 키워드를 넣어 등록하느냐</strong>가 승부입니다.
            </p>
          </Card>
        </Card>
      </section>

      {/* ───────────────── 4) 네이버 1페이지 노출 로직 핵심 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">naver logic</div>
          <h2 className="text-h2 text-ink">최근 네이버 1페이지 플레이스 로직의 핵심</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            제가 발견한 최근 네이버 플레이스 노출 로직의 핵심은 이것입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card variant="white" className="border-2 border-brand-300 bg-gradient-to-br from-brand-50/40 to-white">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-500 text-white flex items-center justify-center shadow-card">
                <Award size={22} />
              </div>
              <span className="text-h3 text-ink font-bold">메인키워드 1개</span>
            </div>
            <p className="text-lg text-ink leading-relaxed">
              어떤 키워드는 <strong className="text-brand-700">대표 키워드 단 1개</strong>를 강하게 잡으면
              네이버 1페이지에 노출됩니다.
            </p>
            <div className="mt-3 px-3 py-2 rounded-card bg-white border border-brand-200 text-base text-brand-700 font-mono font-bold text-center">
              상호 = "단일 메인키워드"
            </div>
          </Card>

          <Card variant="white" className="border-2 border-amber-300 bg-gradient-to-br from-amber-50/40 to-white">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-card">
                <Layers size={22} />
              </div>
              <span className="text-h3 text-ink font-bold">30자 키워드 조합</span>
            </div>
            <p className="text-lg text-ink leading-relaxed">
              어떤 키워드는 <strong className="text-amber-700">30자 안에 여러 키워드를 형태소 조합</strong>해야
              네이버 1페이지에 노출됩니다.
            </p>
            <div className="mt-3 px-3 py-2 rounded-card bg-white border border-amber-200 text-base text-amber-700 font-mono font-bold text-center">
              상호 = "메인+보조+장소+태그"
            </div>
          </Card>
        </div>

        {/* 양쪽 결과 박스 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <Card variant="white" className="border border-rose-200 bg-rose-50/30">
            <div className="flex items-start gap-3">
              <XCircle size={28} className="text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-lg font-bold text-ink mb-1">이 차이를 모르면</p>
                <p className="text-base text-ink-muted leading-relaxed">
                  타지역서비스를 아무리 많이 등록해도<br />
                  <strong className="text-rose-700">엉뚱한 키워드로만 노출</strong>되거나<br />
                  <strong className="text-rose-700">정작 돈 되는 키워드에서는 보이지 않습니다.</strong>
                </p>
              </div>
            </div>
          </Card>
          <Card variant="white" className="border border-emerald-200 bg-emerald-50/30">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={28} className="text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-lg font-bold text-ink mb-1">이 로직을 이해하면</p>
                <p className="text-base text-ink-muted leading-relaxed">
                  고객이 실제 검색하는 키워드,<br />
                  플레이스 섹션에 들어갈 수 있는 키워드,<br />
                  <strong className="text-emerald-700">30자 상호 조합에 넣어 노출되는 키워드</strong>를 찾아<br />
                  <strong className="text-emerald-700">낮은 비용으로 1페이지 노출 기회</strong>를 만듭니다.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ───────────────── 5) 잘못된 방식 vs 실제 문제 표 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">common mistakes</div>
          <h2 className="text-h2 text-ink">키워드 로직을 모르면 생기는 문제</h2>
        </div>

        <Card variant="white" className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-bg-subtle">
                <th className="px-4 py-3.5 text-left text-base font-bold text-rose-700 uppercase tracking-wider w-[40%]">잘못된 방식</th>
                <th className="px-4 py-3.5 text-left text-base font-bold text-ink-muted uppercase tracking-wider w-[60%]">실제 문제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-subtle">
              {[
                ['무조건 키워드를 많이 넣음', '네이버가 핵심 키워드를 제대로 인식하지 못함'],
                ['대표키워드만 반복함', '조합 노출 기회를 놓침'],
                ['지역명만 바꿔 대량등록', '검색량 있는 키워드에서 노출 실패'],
                ['감으로 상호를 만듦', '1페이지 플레이스 섹션 진입 가능성 낮음'],
                ['경쟁사 상호만 따라함', '내 업종에 맞는 로직을 놓침'],
              ].map(([wrong, problem]) => (
                <tr key={wrong} className="hover:bg-bg-subtle/40">
                  <td className="px-4 py-3.5 text-lg font-bold text-ink">
                    <div className="flex items-center gap-2">
                      <XCircle size={18} className="text-rose-400 shrink-0" />
                      {wrong}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-lg text-ink-muted">→ {problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card variant="white" className="mt-5 bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200 text-center">
          <p className="text-lg text-ink-muted leading-relaxed mb-2">결국 중요한 것은</p>
          <p className="text-2xl text-brand-700 font-bold leading-snug">
            "몇 개를 등록했느냐"가 아니라<br />
            "어떤 키워드로 등록했느냐"입니다.
          </p>
        </Card>
      </section>

      {/* ───────────────── 6) 1페이지 노출 키워드 발굴 솔루션 ───────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-3">
            <Sparkles size={14} /> 솔루션 소개
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            네이버 1페이지 노출 키워드 <span className="text-brand-700">발굴 솔루션</span>
          </h2>
          <p className="text-2xl text-ink mt-3 font-bold leading-snug">
            감으로 키워드 잡지 마세요.<br />
            <span className="text-brand-700">네이버 1페이지에 뜨는 키워드는 따로 있습니다.</span>
          </p>
        </div>

        <Card variant="white" className="bg-gradient-to-br from-brand-50/30 to-white border border-brand-100">
          <p className="text-lg text-ink leading-relaxed mb-4">
            저는 타지역서비스를 운영하면서 최근 네이버 플레이스 1페이지 섹션에 노출되는 키워드 로직을 분석했습니다.<br />
            그리고 그 결과를 바탕으로 <strong className="text-brand-700">네이버 1페이지 노출 키워드 발굴 솔루션</strong>을 만들었습니다.
          </p>
          <p className="text-lg text-ink-muted leading-relaxed">
            이 솔루션은 단순히 검색량 많은 키워드를 찾는 도구가 아닙니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
            <div className="px-4 py-4 rounded-card bg-rose-50/60 border border-rose-200">
              <div className="text-body-sm text-rose-700 font-bold uppercase tracking-wider mb-2">CASE A</div>
              <p className="text-base text-ink leading-relaxed">
                <strong className="text-rose-700">검색량은 있는데 플레이스 섹션이 뜨지 않는</strong> 키워드
              </p>
            </div>
            <div className="px-4 py-4 rounded-card bg-emerald-50/60 border border-emerald-200">
              <div className="text-body-sm text-emerald-700 font-bold uppercase tracking-wider mb-2">CASE B</div>
              <p className="text-base text-ink leading-relaxed">
                <strong className="text-emerald-700">검색량은 작아도 전화문의로 바로 연결되는</strong> 키워드
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div className="px-4 py-4 rounded-card bg-brand-50/60 border border-brand-200">
              <div className="text-body-sm text-brand-700 font-bold uppercase tracking-wider mb-2">CASE C</div>
              <p className="text-base text-ink leading-relaxed">
                <strong className="text-brand-700">메인플레이스처럼 단일 대표키워드</strong>로 접근해야 하는 키워드
              </p>
            </div>
            <div className="px-4 py-4 rounded-card bg-amber-50/60 border border-amber-200">
              <div className="text-body-sm text-amber-700 font-bold uppercase tracking-wider mb-2">CASE D</div>
              <p className="text-base text-ink leading-relaxed">
                <strong className="text-amber-700">타지역플레이스 30자 상호 조합</strong>으로 접근해야 하는 키워드
              </p>
            </div>
          </div>

          <Card variant="white" className="mt-5 bg-brand-600 text-white text-center">
            <p className="text-xl font-bold leading-snug">
              이 차이를 찾아내는 것이<br />
              <span className="text-amber-200">네이버 1페이지 노출 키워드 발굴 솔루션</span>의 핵심입니다.
            </p>
          </Card>
        </Card>
      </section>

      {/* ───────────────── 7) 1,000원 회선 × 키워드 로직 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">why keyword matters</div>
          <h2 className="text-h2 text-ink">왜 키워드 발굴이 중요한가?</h2>
          <p className="text-2xl text-ink mt-3 font-bold leading-snug">
            타지역서비스는 <span className="text-rose-700">1,000원짜리 회선이 문제가 아닙니다.</span><br />
            그 1,000원짜리 회선에 <span className="text-brand-700">어떤 키워드를 심느냐</span>가 문제입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <Card variant="white" className="border border-rose-200 bg-rose-50/30">
            <div className="text-body-sm text-rose-700 uppercase tracking-wider font-bold mb-2">잘못된 키워드</div>
            <p className="text-xl text-ink font-bold mb-2">1,000원짜리 회선이라도</p>
            <p className="text-base text-ink-muted leading-relaxed">
              잘못된 키워드로 등록하면<br />
              <strong className="text-rose-700">노출도 약하고, 문의도 없습니다.</strong>
            </p>
          </Card>
          <Card variant="white" className="border-2 border-emerald-300 bg-emerald-50/30">
            <div className="text-body-sm text-emerald-700 uppercase tracking-wider font-bold mb-2">정확한 키워드</div>
            <p className="text-xl text-ink font-bold mb-2">정확한 키워드를 찾으면</p>
            <p className="text-base text-ink-muted leading-relaxed">
              그 1,000원짜리 회선 하나가<br />
              <strong className="text-emerald-700">네이버 1페이지 노출되는 매출 통로</strong>가 됩니다.
            </p>
          </Card>
        </div>

        {/* 핵심 공식 */}
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="text-center py-4">
            <div className="text-body-sm text-white/80 uppercase tracking-wider font-bold mb-3">핵심 공식</div>
            <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-4">
              <span className="px-5 py-3 rounded-card bg-white/15 backdrop-blur-sm border border-white/20 text-xl font-bold">
                저비용 대량등록
              </span>
              <span className="text-3xl text-amber-200 font-bold">×</span>
              <span className="px-5 py-3 rounded-card bg-white/15 backdrop-blur-sm border border-white/20 text-xl font-bold">
                1페이지 키워드 로직 분석
              </span>
            </div>
            <p className="text-lg text-white/90 leading-relaxed">
              이 둘이 결합될 때 타지역서비스는<br />
              <span className="text-2xl text-amber-200 font-bold">단순 등록이 아니라 매출을 만드는 플레이스 전략</span>이 됩니다.
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 8) 키워드 등급 ───────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-amber-50 text-amber-700 text-body-sm font-bold mb-3">
            <Award size={14} /> 키워드에는 등급이 있습니다
          </span>
          <h2 className="text-h2 text-ink">모든 키워드가 같은 키워드는 아닙니다</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card variant="white" className="border-2 border-amber-300 bg-gradient-to-br from-amber-50/50 to-white">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-card">
                <Award size={22} />
              </div>
              <span className="text-xl text-amber-700 font-bold">A급 키워드</span>
            </div>
            <p className="text-lg text-ink font-bold leading-tight mb-2">
              네이버 1페이지 플레이스 노출 키워드
            </p>
            <p className="text-base text-ink-muted leading-relaxed">
              검색했을 때 1페이지 상단 플레이스 섹션에 직접 노출되는 키워드
            </p>
          </Card>

          <Card variant="white" className="border border-bg-subtle bg-bg-subtle/30">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-ink-soft to-ink-muted text-white flex items-center justify-center shadow-card">
                <Eye size={22} />
              </div>
              <span className="text-xl text-ink-muted font-bold">B급 키워드</span>
            </div>
            <p className="text-lg text-ink font-bold leading-tight mb-2">
              구석에 숨어있는 네이버지도 섹션 키워드
            </p>
            <p className="text-base text-ink-muted leading-relaxed">
              지도 섹션 깊이 들어가야 보이는 키워드 — 노출 효과 제한적
            </p>
          </Card>
        </div>

        <Card variant="white" className="mt-5 bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-lg text-ink leading-relaxed mb-2">
            키워드 발굴은 <span className="text-ink-muted line-through">"좋아 보이는 단어를 넣는 작업"</span>이 아닙니다.
          </p>
          <p className="text-xl text-emerald-700 font-bold leading-snug">
            네이버가 어떤 단어를 어떤 섹션에 노출시키는지<br />
            분석하는 작업입니다.
          </p>
          <p className="text-base text-ink-muted leading-relaxed mt-3">
            👉 사장님 키워드가 네이버 1페이지 노출 키워드인지? 네이버지도 키워드인지?<br />
            <strong className="text-emerald-700">무료 분석 요청하세요.</strong>
          </p>
        </Card>
      </section>

      {/* ───────────────── 9) 메인키워드형 vs 30자 조합형 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">two strategies</div>
          <h2 className="text-h2 text-ink">두 가지 키워드 전략</h2>
        </div>

        <div className="space-y-5">
          {/* 메인키워드 1개 */}
          <Card variant="white" className="border border-brand-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-500 text-white flex items-center justify-center shrink-0 shadow-card">
                <Award size={26} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-body-sm font-mono font-bold text-brand-700 mb-1">STRATEGY A</div>
                <h3 className="text-h3 text-ink mb-3">메인키워드 1개가 답인 경우</h3>
                <p className="text-lg text-ink leading-relaxed mb-3 px-3.5 py-2.5 rounded-card bg-brand-50">
                  어떤 키워드는 상호에 여러 단어를 섞는 것보다<br />
                  <strong className="text-brand-700">메인키워드 하나를 강하게 잡는 것</strong>이 더 유리합니다.
                </p>
                <p className="text-base text-ink-muted leading-relaxed">
                  특정 업종에서는 네이버가 대표 키워드를 중심으로 플레이스 섹션을 구성합니다.
                  이때 상호에 불필요한 키워드를 많이 넣으면 오히려 핵심성이 약해질 수 있습니다.
                </p>
                <Card variant="white" className="mt-3 bg-brand-50/40 border border-brand-200">
                  <p className="text-lg text-brand-700 font-bold text-center">
                    👉 단순하고 강하게. 대표키워드 1개로 네이버 봇에게 명확하게.
                  </p>
                </Card>
              </div>
            </div>
          </Card>

          {/* 30자 조합 */}
          <Card variant="white" className="border border-amber-200">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shrink-0 shadow-card">
                <Layers size={26} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-body-sm font-mono font-bold text-amber-700 mb-1">STRATEGY B</div>
                <h3 className="text-h3 text-ink mb-3">30자 키워드 조합이 답인 경우</h3>
                <p className="text-lg text-ink leading-relaxed mb-3 px-3.5 py-2.5 rounded-card bg-amber-50">
                  어떤 업종은 메인키워드 하나만으로는 노출 범위가 좁습니다.<br />
                  이때는 <strong className="text-amber-700">상호 30자 안에 형태소 단위로 조합</strong>해야 합니다.
                </p>

                {/* 5종 키워드 카드 */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                  {[
                    { label: '메인 서비스', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
                    { label: '보조 서비스', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
                    { label: '문제 상황', tone: 'bg-orange-50 text-orange-700 border-orange-200' },
                    { label: '지역성', tone: 'bg-brand-50 text-brand-700 border-brand-200' },
                    { label: '긴급성', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                  ].map((k) => (
                    <div key={k.label} className={`px-3 py-2.5 rounded-card border text-center ${k.tone}`}>
                      <span className="text-base font-bold">{k.label}</span>
                    </div>
                  ))}
                </div>

                <Card variant="white" className="mt-3 bg-amber-50/40 border border-amber-200">
                  <p className="text-base text-ink leading-relaxed text-center">
                    하나의 상호 안에서 여러 검색어에 걸릴 가능성을 만듭니다.<br />
                    단, <strong className="text-amber-700">네이버 1페이지에 실제 반응하는 키워드만</strong> 넣어야 합니다.
                  </p>
                </Card>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ───────────────── 10) 키워드 DNA 분석 ───────────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-indigo-50 text-indigo-700 text-body-sm font-bold mb-3">
            <Dna size={14} /> 키워드 DNA 분석
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            키워드는 그냥 단어가 아닙니다.<br />
            <span className="text-indigo-700">매출이 터지는 구조가 숨어 있습니다.</span>
          </h2>
        </div>

        <Card variant="white" className="bg-gradient-to-br from-indigo-50/30 to-white border border-indigo-100">
          <p className="text-lg text-ink leading-relaxed mb-4">
            키워드 DNA란 하나의 키워드가 가진 다음 5가지 속성을 분석하는 과정입니다.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {[
              { icon: <Compass size={20} />, label: '검색 의도' },
              { icon: <Eye size={20} />, label: '플레이스 섹션 노출' },
              { icon: <Target size={20} />, label: '경쟁 강도' },
              { icon: <Layers size={20} />, label: '메인형 / 조합형' },
              { icon: <Zap size={20} />, label: '타지역 노출 가능성' },
            ].map((d) => (
              <div key={d.label} className="px-3 py-3.5 rounded-card bg-white border border-indigo-200 text-center">
                <div className="text-indigo-600 mb-1.5 flex justify-center">{d.icon}</div>
                <span className="text-base font-bold text-ink leading-tight">{d.label}</span>
              </div>
            ))}
          </div>

          {/* 키워드 비교 예시 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
            <Card variant="white" className="border border-bg-subtle">
              <div className="text-body-sm text-ink-muted uppercase tracking-wider font-bold mb-2">같은 수리 업종이라도</div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1.5 rounded-pill bg-brand-50 text-brand-700 text-base font-bold">컴퓨터수리</span>
                <span className="text-ink-muted">≠</span>
                <span className="px-3 py-1.5 rounded-pill bg-amber-50 text-amber-700 text-base font-bold">노트북수리</span>
              </div>
              <p className="text-base text-ink-muted leading-relaxed">두 키워드는 다르게 봐야 합니다.</p>
            </Card>
            <Card variant="white" className="border border-bg-subtle">
              <div className="text-body-sm text-ink-muted uppercase tracking-wider font-bold mb-2">긴급성 비교</div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1.5 rounded-pill bg-rose-50 text-rose-700 text-base font-bold">누수탐지</span>
                <span className="text-ink-muted">≠</span>
                <span className="px-3 py-1.5 rounded-pill bg-orange-50 text-orange-700 text-base font-bold">하수구막힘</span>
              </div>
              <p className="text-base text-ink-muted leading-relaxed">검색 의도, 긴급성, 전환율, 섹션 구조가 다릅니다.</p>
            </Card>
          </div>

          <Card variant="white" className="mt-4 bg-indigo-600 text-white text-center">
            <p className="text-xl font-bold leading-snug">
              키워드 발굴은 <span className="text-amber-200">검색량만 보면 안 됩니다.</span><br />
              <strong>네이버 1페이지에 올라갈 수 있는 구조인지</strong>를 봐야 합니다.
            </p>
          </Card>
        </Card>
      </section>

      {/* ───────────────── 11) 발굴 프로세스 5단계 ───────────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">5-step process</div>
          <h2 className="text-h2 text-ink">네이버 1페이지 키워드 발굴 프로세스</h2>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <ProcessStep num="01" tone="brand" icon={<Search size={22} />}
            title="업종 대표키워드 수집"
            desc="업종의 핵심 키워드를 정리합니다."
            example={['컴퓨터수리', '노트북수리', '데이터복구', '누수탐지', '하수구막힘', '변기막힘', '에어컨청소', '보일러수리', '입주청소']}
          />

          {/* Step 2 */}
          <ProcessStep num="02" tone="amber" icon={<Eye size={22} />}
            title="네이버 1페이지 플레이스 섹션 확인"
            desc="각 키워드를 검색했을 때 네이버 1페이지에 플레이스 섹션이 뜨는지 확인합니다."
            customBlock={
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                <div className="px-3.5 py-2.5 rounded-card bg-rose-50/60 border border-rose-200 text-base text-ink leading-relaxed">
                  <strong className="text-rose-700">섹션 없음</strong> → 타지역플레이스 등록만으론 효율 ↓
                </div>
                <div className="px-3.5 py-2.5 rounded-card bg-emerald-50/60 border border-emerald-200 text-base text-ink leading-relaxed">
                  <strong className="text-emerald-700">섹션 있음</strong> → 타지역서비스와 결합 가능 ✓
                </div>
              </div>
            }
          />

          {/* Step 3 */}
          <ProcessStep num="03" tone="emerald" icon={<Layers size={22} />}
            title="키워드 유형 분류"
            desc="키워드를 5가지 유형으로 분류합니다."
            customBlock={
              <div className="overflow-x-auto mt-3">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr className="bg-emerald-50">
                      <th className="px-3 py-2.5 text-left text-base font-bold text-emerald-700 w-[40%]">분류</th>
                      <th className="px-3 py-2.5 text-left text-base font-bold text-emerald-700">의미</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100 bg-white">
                    {[
                      ['단독 메인키워드형', '키워드 1개로 강하게 노출되는 구조'],
                      ['30자 조합키워드형', '여러 키워드 조합으로 노출되는 구조'],
                      ['지역명 결합형', '지역 + 서비스 검색에서 강한 구조'],
                      ['지도섹션형', '네이버 지도 영역에서 반응하는 구조'],
                      ['저효율 제외 키워드', '검색량은 있어도 문의 전환이 낮은 키워드'],
                    ].map(([type, mean]) => (
                      <tr key={type}>
                        <td className="px-3 py-2.5 text-base text-ink font-bold">{type}</td>
                        <td className="px-3 py-2.5 text-base text-ink-muted">{mean}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />

          {/* Step 4 */}
          <ProcessStep num="04" tone="rose" icon={<Type size={22} />}
            title="30자 상호 키워드 조합 설계"
            desc="타지역플레이스는 상호 30자가 핵심. 우선순위에 따라 배치합니다."
            customBlock={
              <div className="space-y-2 mt-3">
                {[
                  { rank: '1순위', kw: '메인키워드', tone: 'bg-rose-100 text-rose-800 border-rose-300' },
                  { rank: '2순위', kw: '고전환 서비스 키워드', tone: 'bg-orange-100 text-orange-800 border-orange-300' },
                  { rank: '3순위', kw: '문제 상황 키워드', tone: 'bg-amber-100 text-amber-800 border-amber-300' },
                  { rank: '4순위', kw: '보조 서비스 키워드', tone: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
                  { rank: '5순위', kw: '지역 확장형 키워드', tone: 'bg-brand-100 text-brand-800 border-brand-300' },
                ].map((p) => (
                  <div key={p.rank} className={`flex items-center gap-3 px-4 py-3 rounded-card border ${p.tone}`}>
                    <span className="text-base font-mono font-bold w-12 shrink-0">{p.rank}</span>
                    <ArrowRight size={18} className="shrink-0 opacity-60" />
                    <span className="text-lg font-bold">{p.kw}</span>
                  </div>
                ))}
                <Card variant="white" className="bg-rose-600 text-white text-center mt-3">
                  <p className="text-lg font-bold leading-snug">
                    상호 30자 안에 네이버 봇이 읽을 수 있는 형태소를 심는 것.<br />
                    <span className="text-amber-200">이것이 타지역서비스 키워드 로직의 핵심입니다.</span>
                  </p>
                </Card>
              </div>
            }
          />

          {/* Step 5 */}
          <ProcessStep num="05" tone="indigo" icon={<Cpu size={22} />}
            title="타지역서비스 대량등록 시스템에 적용"
            desc="분석된 키워드를 기반으로 지역별 타지역플레이스에 적용합니다. 단순히 지역만 바꾸지 않고, 키워드 유형에 따라 상호 조합을 다르게 설계합니다."
            customBlock={
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                {[
                  '대표키워드형 지역',
                  '30자 조합형 지역',
                  '지도섹션형 키워드',
                ].map((t) => (
                  <div key={t} className="px-3.5 py-3 rounded-card bg-indigo-50/60 border border-indigo-200 text-center text-base text-indigo-700 font-bold">
                    {t}
                  </div>
                ))}
              </div>
            }
          />
        </div>
      </section>

      {/* ───────────────── 12) 타지역닷컴의 차별화 ───────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-brand-600 to-indigo-700 text-white">
          <div className="max-w-3xl mx-auto py-4 text-center">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white/15 backdrop-blur-sm text-amber-200 text-body-sm font-bold mb-4 border border-white/20">
              ⭐ DIFFERENTIATION
            </span>
            <h2 className="text-h1 text-white mb-4 leading-tight">
              이것이 <span className="text-amber-200">타지역닷컴의 차별화</span>입니다
            </h2>
            <p className="text-2xl text-white font-bold leading-snug mb-3">
              우리는 단순히 등록하지 않습니다.<br />
              <span className="text-amber-200">먼저 네이버 1페이지 노출 키워드를 찾습니다.</span>
            </p>
            <p className="text-lg text-white/90 leading-relaxed mb-5">
              대부분의 타지역서비스는 <span className="text-white/70 line-through">지역을 많이 등록하는 것</span>에 집중합니다.<br />
              하지만 타지역닷컴은 다릅니다. <strong className="text-white">지역 등록 전에 먼저 봅니다.</strong>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-5 text-left">
              {[
                '어떤 키워드가 네이버 1페이지에 뜨는지',
                '어떤 키워드가 플레이스 섹션에 들어가는지',
                '어떤 키워드가 메인키워드형인지',
                '어떤 키워드가 30자 조합형인지',
                '어떤 키워드가 실제 전화문의로 이어질 가능성이 높은지',
              ].map((q) => (
                <div key={q} className="flex items-center gap-2.5 px-4 py-3 rounded-card bg-white/10 backdrop-blur-sm border border-white/20">
                  <CheckCircle2 size={20} className="text-amber-200 shrink-0" />
                  <span className="text-base text-white font-medium">{q}</span>
                </div>
              ))}
            </div>

            <p className="text-xl text-white leading-relaxed">
              <strong>그 다음에 등록합니다.</strong><br />
              <span className="text-2xl text-amber-200 font-bold mt-2 inline-block">
                키워드 로직 기반 타지역서비스 등록 전략
              </span>
            </p>
          </div>
        </Card>
      </section>

      {/* ───────────────── 13) 사장님께 드리는 한마디 ───────────────── */}
      <section>
        <Card variant="white" className="bg-gradient-to-br from-amber-50 via-rose-50/40 to-amber-50 border border-amber-200">
          <div className="max-w-3xl mx-auto py-4">
            <div className="text-center mb-5">
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-white text-amber-700 text-body-sm font-bold shadow-sm">
                💬 사장님께 드리는 한마디
              </span>
            </div>
            <h2 className="text-h2 text-ink text-center mb-5 leading-tight">
              네이버 1페이지 노출은<br />
              <span className="text-rose-700">감으로 하는 시대가 아닙니다.</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {[
                '블로그 몇 개 쓰고',
                '광고비 조금 올리고',
                '플레이스 이름 대충 바꿔서는',
              ].map((t) => (
                <div key={t} className="px-4 py-3.5 rounded-card bg-white border border-amber-200 text-center">
                  <XCircle size={20} className="text-rose-400 mx-auto mb-2" />
                  <span className="text-base text-ink-muted font-medium">{t}</span>
                </div>
              ))}
            </div>
            <p className="text-lg text-ink-muted leading-relaxed text-center mb-6">
              고객이 검색하는 1페이지 플레이스 섹션에 <strong className="text-rose-700">들어가기 어렵습니다.</strong>
            </p>

            {/* 매출 흐름 */}
            <Card variant="white" className="bg-white border-2 border-emerald-300">
              <p className="text-lg text-ink-muted text-center mb-3">제대로 심으면 보입니다</p>
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
                <FlowStep tone="brand" icon={<Eye size={20} />} label="보이면" />
                <FlowArrow />
                <FlowStep tone="amber" icon={<Phone size={20} />} label="전화가 오고" />
                <FlowArrow />
                <FlowStep tone="emerald" icon={<TrendingUp size={20} />} label="매출 기회" />
              </div>
            </Card>
          </div>
        </Card>
      </section>

      {/* ───────────────── 14) 강한 후킹 — 천 원짜리 회선 ───────────────── */}
      <section>
        <Card variant="white" className="relative overflow-hidden bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 text-white">
          <div className="max-w-3xl mx-auto py-6 text-center">
            <Megaphone size={42} className="mx-auto mb-4 text-white" />
            <p className="text-3xl md:text-4xl text-white font-bold leading-tight mb-4">
              천 원짜리 회선 하나가<br />
              <span className="text-amber-100">네이버 1페이지 노출 통로</span>가 될 수 있습니다.
            </p>
            <p className="text-xl text-white/95 leading-relaxed mb-5">
              단, 조건이 있습니다.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-5">
              {[
                '아무 키워드나 넣으면 안 됩니다',
                '감으로 조합하면 안 됩니다',
                '남들이 쓰는 상호를 따라 하면 안 됩니다',
              ].map((t) => (
                <div key={t} className="flex items-center gap-2.5 px-4 py-3.5 rounded-card bg-white/15 backdrop-blur-sm border border-white/30">
                  <XCircle size={20} className="text-white shrink-0" />
                  <span className="text-base text-white font-medium text-left">{t}</span>
                </div>
              ))}
            </div>

            <Card variant="white" className="bg-white text-ink mb-5">
              <p className="text-lg leading-relaxed mb-3 font-bold">
                대신 이 3가지 키워드를 찾아야 합니다.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {[
                  '네이버가 읽는 키워드',
                  '플레이스 섹션에 뜨는 키워드',
                  '고객이 실제로 검색하는 키워드',
                ].map((t) => (
                  <div key={t} className="px-3 py-3 rounded-card bg-emerald-50 border border-emerald-200 text-center">
                    <CheckCircle2 size={20} className="text-emerald-600 mx-auto mb-1.5" />
                    <span className="text-base text-ink font-bold">{t}</span>
                  </div>
                ))}
              </div>
            </Card>

            <p className="text-xl text-white leading-relaxed">
              타지역닷컴은 그 키워드를 발굴하고,<br />
              30자 상호 조합으로 설계하고,<br />
              <span className="text-2xl text-amber-100 font-bold mt-2 inline-block">
                타지역서비스 대량등록 시스템에 적용합니다.
              </span>
            </p>
          </div>
        </Card>
      </section>

      {/* ─────────── 15) 6 카테고리 DNA (기존 기술 섹션) ─────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            6-category dna
          </div>
          <h2 className="text-h2 text-ink">키워드 6 카테고리 DNA</h2>
          <p className="text-lg text-ink-muted mt-2 leading-relaxed">
            1,875개 등록 상호와 216개 업종 데이터로 구축된 3,574개 토큰 사전을 6개 카테고리로 분류합니다.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DnaCard tag="MAIN" title="중심 키워드"
            desc="상호의 핵심 업종어. 하수구·흥신소·누수·보일러·열쇠 등." count={2838} />
          <DnaCard tag="ACTION" title="동작/서비스"
            desc="업무 행위 키워드. 막힘·뚫음·설치·수리·청소·출장 등." count={503} />
          <DnaCard tag="MATERIAL" title="재료/원인"
            desc="대상 자재/원인물. 변기·싱크대·도어락·폐기물 등." count={57} />
          <DnaCard tag="PLACE" title="장소/대상"
            desc="시공 위치. 가정·아파트·상가·공장·화장실 등." count={66} />
          <DnaCard tag="BRAND" title="브랜드"
            desc="제조사/브랜드명. LG·삼성·경동·린나이·귀뚜라미 등." count={40} />
          <DnaCard tag="TAG" title="수식어/태그"
            desc="강조 표현. 24시·전문·업체·센터·당일·긴급 등." count={70} />
        </div>
      </section>

      {/* ─────────── 16) 파이프라인 4단계 (기존) ─────────── */}
      <section>
        <div className="mb-5">
          <div className="text-body-sm text-ink-muted uppercase tracking-wider font-semibold mb-1">
            pipeline
          </div>
          <h2 className="text-h2 text-ink">파싱 파이프라인 4단계</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StepCard num="1" icon={<Layers size={18} />} title="사전 구축"
            desc="시드 250개 + 자동 n-gram(2-6자, 빈도≥3) → 최장일치 가지치기로 3,574 토큰 라벨링." />
          <StepCard num="2" icon={<GitBranch size={18} />} title="최장일치 토크나이저"
            desc="Trie 기반 Pure Python. 예: 하수구막힘변기뚫음 → [하수구, 막힘, 변기, 뚫음]." />
          <StepCard num="3" icon={<Search size={18} />} title="필터·집계"
            desc="입력 키워드 포함 상호만 추출, 회선수 가중 토큰 빈도 계산." />
          <StepCard num="4" icon={<Target size={18} />} title="DNA 출력"
            desc="6 카테고리 DNA + 골든 콤보(main+modifier) + 매칭 업체 샘플 반환." />
        </div>
      </section>

      {/* ─────────── 17) 골든 콤보 예시 (기존) ─────────── */}
      <Card variant="white">
        <h3 className="text-h3 text-ink mb-3">골든 콤보 예시 (실제 분석 결과)</h3>
        <div className="space-y-2">
          <Combo seed="흥신소" combos={['흥신소 찾기', '흥신소 사람찾기', '흥신소 조사', '흥신소 미행']} />
          <Combo seed="하수구" combos={['하수구 고압세척', '하수구 뚫음', '하수구 막힘', '하수구 누수탐지']} />
          <Combo seed="누수" combos={['누수 누수탐지', '누수 방수', '누수 동파', '누수 고압세척']} />
          <Combo seed="보일러" combos={['보일러 누수탐지', '보일러 설치', '보일러 수리', '경동·린나이·귀뚜라미']} />
        </div>
        <p className="text-base text-ink-muted mt-4 leading-relaxed">
          ※ 골든 콤보는 main 카테고리 키워드 + 다른 카테고리(action/place/material/tag) 키워드가
          동시 출현하는 가중치 상위 조합입니다. <strong className="text-ink">노출 가능성이 가장 높은 상호 패턴</strong>을 의미합니다.
        </p>
      </Card>

      {/* ─────────── 18) CTA 박스 3개 ─────────── */}
      <section>
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-pill bg-emerald-50 text-emerald-700 text-body-sm font-bold mb-2">
            🎁 타지역닷컴 위탁 시 100% 무료
          </span>
          <h2 className="text-h2 text-ink leading-tight">
            지금 사장님 업종에도<br />
            <span className="text-brand-700">네이버 1페이지 노출 키워드</span>가 숨어 있습니다
          </h2>
          <p className="text-lg text-ink-muted mt-3 leading-relaxed">
            찾지 않으면 모릅니다. 분석하지 않으면 보이지 않습니다.<br />
            <strong className="text-ink">타지역닷컴의 키워드 발굴 솔루션</strong>으로 사장님 업종의 숨은 매출 키워드를 찾아보세요.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CtaBox
            num="01"
            title="네이버1페이지 플레이스 영역 노출"
            highlight="골든키워드 발굴 무료 문의하기"
            to="/intro/keyword-discover"
            tone="brand"
            icon={<Sparkles size={22} />}
          />
          <CtaBox
            num="02"
            title="지역별 키워드"
            highlight="경쟁도 무료 분석 신청하기"
            to="/intro/competition"
            tone="teal"
            icon={<Target size={22} />}
          />
          <CtaBox
            num="03"
            title="등록한 타지역서비스"
            highlight="노출 자동체크 무료 플랜 신청하기"
            to="/intro/monitor"
            tone="rose"
            icon={<ShieldCheck size={22} />}
          />
        </div>
      </section>
    </div>
  )
}

/* ════════════════════ 하위 컴포넌트 ════════════════════ */

function DnaCard({ tag, title, desc, count }: {
  tag: string; title: string; desc: string; count: number
}) {
  return (
    <Card variant="white" className="h-full">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-bold tracking-wider">
          {tag}
        </span>
        <span className="text-lg font-semibold text-ink">{title}</span>
      </div>
      <p className="text-base text-ink-muted leading-relaxed mb-3">{desc}</p>
      <div className="text-base text-ink-muted">
        토큰 수 <span className="font-mono font-semibold text-ink">{count.toLocaleString()}</span>
      </div>
    </Card>
  )
}

function StepCard({ num, icon, title, desc }: {
  num: string; icon: React.ReactNode; title: string; desc: string
}) {
  return (
    <Card variant="white" className="h-full relative">
      <div className="absolute top-3 right-3 text-[28px] leading-none font-light text-ink-watermark/60 select-none">
        {num}
      </div>
      <div className="flex items-center gap-2 mb-2 text-brand-600">
        {icon}
        <span className="text-lg font-semibold text-ink">{title}</span>
      </div>
      <p className="text-base text-ink-muted leading-relaxed">{desc}</p>
    </Card>
  )
}

function Combo({ seed, combos }: { seed: string; combos: string[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap py-2 border-b border-bg-subtle last:border-b-0">
      <span className="text-lg font-semibold text-ink min-w-[64px]">{seed}</span>
      <ArrowRight size={16} className="text-ink-muted" />
      {combos.map((c) => (
        <span key={c} className="text-base px-2.5 py-1 rounded-md bg-bg-subtle text-ink">
          {c}
        </span>
      ))}
    </div>
  )
}

interface ProcessStepProps {
  num: string
  tone: 'brand' | 'amber' | 'emerald' | 'rose' | 'indigo'
  icon: React.ReactNode
  title: string
  desc: string
  example?: string[]
  customBlock?: React.ReactNode
}

function ProcessStep({ num, tone, icon, title, desc, example, customBlock }: ProcessStepProps) {
  const tc = {
    brand: { bg: 'bg-brand-50', text: 'text-brand-700', border: 'border-brand-200', accent: 'from-brand-500 to-indigo-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', accent: 'from-amber-500 to-orange-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', accent: 'from-emerald-500 to-teal-500' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', accent: 'from-rose-500 to-pink-500' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', accent: 'from-indigo-500 to-purple-500' },
  }[tone]
  return (
    <Card variant="white" className={`border ${tc.border}`}>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center shrink-0">
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center shadow-card`}>
            {icon}
          </div>
          <div className={`mt-2 text-h3 font-bold ${tc.text}`}>{num}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-body-sm font-mono font-bold ${tc.text} mb-1`}>STEP {num}</div>
          <h3 className="text-h3 text-ink mb-2">{title}</h3>
          <p className="text-lg text-ink leading-relaxed">{desc}</p>
          {example && (
            <div className={`flex flex-wrap gap-1.5 mt-3 px-3.5 py-3 rounded-card ${tc.bg}`}>
              {example.map((e) => (
                <span key={e} className="px-2.5 py-1 rounded-md bg-white text-base text-ink font-semibold border border-bg-subtle">
                  {e}
                </span>
              ))}
            </div>
          )}
          {customBlock}
        </div>
      </div>
    </Card>
  )
}

function FlowStep({ tone, icon, label }: {
  tone: 'brand' | 'amber' | 'emerald'; icon: React.ReactNode; label: string
}) {
  const tc = {
    brand: 'bg-brand-50 text-brand-700 border-brand-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[tone]
  return (
    <div className={`flex-1 rounded-card border ${tc} px-4 py-4 text-center`}>
      <div className="flex justify-center mb-2">{icon}</div>
      <div className="text-xl font-bold">{label}</div>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-ink-soft">
      <ArrowRight size={22} className="hidden md:block" />
      <ArrowDown size={22} className="md:hidden" />
    </div>
  )
}

interface CtaBoxProps {
  num: string
  title: string
  highlight: string
  to: string
  tone: 'brand' | 'teal' | 'rose'
  icon: React.ReactNode
}

function CtaBox({ num, title, highlight, to, tone, icon }: CtaBoxProps) {
  const tc = {
    brand: { accent: 'from-brand-500 to-indigo-500', ring: 'ring-brand-200', text: 'text-brand-700', btn: 'bg-brand-600 hover:bg-brand-700' },
    teal: { accent: 'from-teal-500 to-cyan-500', ring: 'ring-teal-200', text: 'text-teal-700', btn: 'bg-teal-600 hover:bg-teal-700' },
    rose: { accent: 'from-rose-500 to-orange-500', ring: 'ring-rose-200', text: 'text-rose-700', btn: 'bg-rose-600 hover:bg-rose-700' },
  }[tone]
  return (
    <Card variant="white" className={`relative overflow-hidden ring-1 ${tc.ring} flex flex-col`}>
      <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-emerald-50 text-emerald-700 text-[11px] font-bold">
        🎁 FREE
      </span>
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${tc.accent} text-white flex items-center justify-center mb-3 shadow-card`}>
        {icon}
      </div>
      <div className={`text-body-sm font-mono ${tc.text} mb-1`}>CTA {num}</div>
      <h3 className="text-h3 text-ink leading-tight mb-1">{title}</h3>
      <p className={`text-lg font-bold ${tc.text} mb-4 leading-tight`}>{highlight}</p>
      <Link
        to={to}
        className={`mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-pill text-white font-bold text-base ${tc.btn} transition-colors`}
      >
        무료 신청하기 <ArrowRight size={16} />
      </Link>
    </Card>
  )
}
