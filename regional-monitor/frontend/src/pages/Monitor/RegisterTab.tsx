/**
 * Monitor — Tab 1: 등록 관리
 *  ┌─ 좌: 070 단건 등록 폼 (필수: 070, 등록 동, 상호) + 자동 추출 트리거
 *  ├─ 우: 엑셀 일괄 업로드 (드래그 영역, 샘플 다운로드)
 *  └─ 하: 등록 리스트 테이블 (검색·필터·삭제·재검증)
 */
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { VerdictBadge } from './VerdictBadge'
import { MOCK_PLACES, summarizePlaces } from './mockData'
import type { RegisteredPlace } from './types'
import {
  Phone,
  MapPin,
  Building2,
  Sparkles,
  Upload,
  FileSpreadsheet,
  Search,
  Trash2,
  RefreshCw,
  Plus,
  Download,
} from 'lucide-react'

export default function RegisterTab() {
  const [places, setPlaces] = useState<RegisteredPlace[]>(MOCK_PLACES)
  const [search, setSearch] = useState('')
  const summary = useMemo(() => summarizePlaces(places), [places])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return places
    return places.filter(
      (p) =>
        p.phone.toLowerCase().includes(q) ||
        p.businessName.toLowerCase().includes(q) ||
        p.registeredDong.toLowerCase().includes(q) ||
        p.placeId.includes(q),
    )
  }, [places, search])

  const handleDelete = (id: string) => {
    if (!confirm('이 등록을 삭제하시겠습니까?')) return
    setPlaces((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* ───── 요약 카운트 4개 ───── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryPill label="전체 등록" value={summary.total} tone="info" />
        <SummaryPill label="정상 노출" value={summary.ok} tone="success" />
        <SummaryPill label="주의 (불일치)" value={summary.warning} tone="warning" />
        <SummaryPill label="심각 (지역/삭제)" value={summary.danger} tone="danger" />
      </div>

      {/* ───── 등록 패널 (단건 + 일괄) ───── */}
      <div className="grid grid-cols-12 gap-4">
        {/* 단건 등록 */}
        <Card variant="white" className="col-span-12 lg:col-span-7">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="text-h3 text-ink">단건 등록</h3>
              <p className="text-caption text-ink-muted">
                070 번호 입력 후 자동 추출 → 등록 동·상호 확인 후 저장
              </p>
            </div>
          </div>

          <SingleRegisterForm
            onAdd={(p) => setPlaces((prev) => [p, ...prev])}
          />
        </Card>

        {/* 엑셀 업로드 */}
        <Card variant="subtle" className="col-span-12 lg:col-span-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-2xl bg-white text-brand-600 flex items-center justify-center">
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h3 className="text-h3 text-ink">엑셀 일괄 업로드</h3>
              <p className="text-caption text-ink-muted">
                여러 070 번호를 한 번에 등록
              </p>
            </div>
          </div>

          <BulkUploadDropzone />

          <div className="mt-4 flex items-center justify-between text-caption">
            <span className="text-ink-muted">
              컬럼: 070 / 등록동 / 상호 (자동 추출 가능 시 070만 입력)
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-brand-600 font-semibold hover:underline"
              onClick={() => alert('샘플 엑셀 다운로드 (백엔드 연동 시 구현)')}
            >
              <Download size={12} /> 샘플 다운로드
            </button>
          </div>
        </Card>
      </div>

      {/* ───── 등록 리스트 ───── */}
      <Card variant="white" noPadding>
        <div className="flex items-center justify-between gap-3 p-card-sm border-b border-bg-subtle">
          <div>
            <h3 className="text-h3 text-ink">등록된 070 번호</h3>
            <p className="text-caption text-ink-muted mt-0.5">
              총 {places.length}건 등록 · 검색 결과 {filtered.length}건
            </p>
          </div>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="070 / 상호 / 동 / Place ID 검색"
              className="w-72 pl-9 pr-3 py-2 rounded-pill bg-bg-subtle/70 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-caption text-ink-muted uppercase tracking-wider border-b border-bg-subtle">
                <th className="px-card-sm py-3 font-semibold">070 번호</th>
                <th className="px-3 py-3 font-semibold">Place ID</th>
                <th className="px-3 py-3 font-semibold">등록 동</th>
                <th className="px-3 py-3 font-semibold">상호</th>
                <th className="px-3 py-3 font-semibold">검증 상태</th>
                <th className="px-3 py-3 font-semibold">최근 점검</th>
                <th className="px-card-sm py-3 font-semibold text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-12 text-ink-muted text-body-sm"
                  >
                    {search ? '검색 결과가 없습니다.' : '등록된 번호가 없습니다.'}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-bg-subtle/60 hover:bg-bg-subtle/40 transition-colors"
                >
                  <td className="px-card-sm py-3 text-ink font-semibold tabular-nums">
                    {p.phone}
                  </td>
                  <td className="px-3 py-3 text-ink-muted tabular-nums font-mono text-caption">
                    {p.placeId}
                  </td>
                  <td className="px-3 py-3 text-ink">{p.registeredDong}</td>
                  <td className="px-3 py-3 text-ink">{p.businessName}</td>
                  <td className="px-3 py-3">
                    <VerdictBadge verdict={p.currentVerdict} />
                  </td>
                  <td className="px-3 py-3 text-caption text-ink-muted">
                    {p.lastCheckedAt
                      ? new Date(p.lastCheckedAt).toLocaleString('ko-KR', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-card-sm py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        title="재검증"
                        className="w-8 h-8 rounded-xl text-ink-muted hover:bg-brand-50 hover:text-brand-600 transition-colors flex items-center justify-center"
                        onClick={() => alert(`${p.phone} 재검증 (백엔드 연동 시 동작)`)}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        type="button"
                        title="삭제"
                        className="w-8 h-8 rounded-xl text-ink-muted hover:bg-red-50 hover:text-status-danger transition-colors flex items-center justify-center"
                        onClick={() => handleDelete(p.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ────────────── 서브 컴포넌트 ────────────── */

interface SummaryPillProps {
  label: string
  value: number
  tone: 'success' | 'warning' | 'danger' | 'info'
}

function SummaryPill({ label, value, tone }: SummaryPillProps) {
  const toneClass = {
    success: 'text-status-success bg-green-50',
    warning: 'text-status-warning bg-amber-50',
    danger: 'text-status-danger bg-red-50',
    info: 'text-brand-700 bg-brand-50',
  }[tone]

  return (
    <Card variant="white" className="!py-4 !px-5 flex items-center justify-between">
      <div>
        <div className="text-caption text-ink-muted mb-1">{label}</div>
        <div className="text-h2 text-ink tabular-nums leading-none">{value}</div>
      </div>
      <div className={`w-9 h-9 rounded-2xl ${toneClass} flex items-center justify-center`}>
        <span className="text-body-sm font-bold tabular-nums">{value}</span>
      </div>
    </Card>
  )
}

interface SingleRegisterFormProps {
  onAdd: (place: RegisteredPlace) => void
}

function SingleRegisterForm({ onAdd }: SingleRegisterFormProps) {
  const [phone, setPhone] = useState('')
  const [dong, setDong] = useState('')
  const [name, setName] = useState('')
  const [placeId, setPlaceId] = useState('')
  const [extracting, setExtracting] = useState(false)

  // 070 입력 후 자동 추출 시뮬레이션 (백엔드 Step B에서 실제 구현)
  const handleAutoExtract = async () => {
    if (!phone.match(/^070-?\d{3,4}-?\d{4}$/)) {
      alert('올바른 070 번호 형식이 아닙니다. 예: 070-1234-5678')
      return
    }
    setExtracting(true)
    // mock 지연
    await new Promise((r) => setTimeout(r, 800))
    setPlaceId('1234567890')
    setDong((prev) => prev || '서울 강남구 역삼동')
    setName((prev) => prev || '자동추출예시업체')
    setExtracting(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone || !dong || !name) {
      alert('070, 등록 동, 상호는 필수입니다.')
      return
    }
    onAdd({
      id: `p_${Date.now()}`,
      phone,
      placeId: placeId || '미추출',
      registeredDong: dong,
      businessName: name,
      currentVerdict: 'PENDING',
      lastCheckedAt: null,
      createdAt: new Date().toISOString(),
    })
    setPhone('')
    setDong('')
    setName('')
    setPlaceId('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 070 + 자동 추출 */}
      <div className="flex gap-2">
        <FieldInput
          icon={<Phone size={14} />}
          placeholder="070-1234-5678"
          value={phone}
          onChange={setPhone}
          className="flex-1"
        />
        <button
          type="button"
          onClick={handleAutoExtract}
          disabled={extracting || !phone}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-pill bg-brand-50 text-brand-700 font-semibold text-body-sm hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          <Sparkles size={14} className={extracting ? 'animate-spin' : ''} />
          {extracting ? '추출 중…' : '자동 추출'}
        </button>
      </div>

      {/* 등록 동 + 상호 */}
      <div className="grid grid-cols-2 gap-2">
        <FieldInput
          icon={<MapPin size={14} />}
          placeholder="등록 동 (예: 서울 강남구 역삼동)"
          value={dong}
          onChange={setDong}
        />
        <FieldInput
          icon={<Building2 size={14} />}
          placeholder="상호"
          value={name}
          onChange={setName}
        />
      </div>

      {/* Place ID (자동 채워짐, 읽기 전용 우선) */}
      {placeId && (
        <div className="text-caption text-ink-muted px-3 py-2 rounded-xl bg-brand-50/60 border border-brand-100 flex items-center gap-2">
          <Sparkles size={12} className="text-brand-500" />
          자동 추출된 Place ID: <span className="font-mono font-bold text-brand-700">{placeId}</span>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button type="submit" className="btn-primary">
          <Plus size={14} /> 등록하기
        </button>
      </div>
    </form>
  )
}

interface FieldInputProps {
  icon: React.ReactNode
  placeholder: string
  value: string
  onChange: (v: string) => void
  className?: string
}

function FieldInput({ icon, placeholder, value, onChange, className }: FieldInputProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
        {icon}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
      />
    </div>
  )
}

function BulkUploadDropzone() {
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) setFile(f)
      }}
      className={`relative rounded-card border-2 border-dashed transition-all ${
        dragOver
          ? 'border-brand-500 bg-brand-50/50'
          : 'border-ink-watermark/50 bg-white'
      } p-6 text-center cursor-pointer`}
    >
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="w-12 h-12 mx-auto rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
        <Upload size={20} />
      </div>
      <div className="text-body-sm text-ink font-semibold">
        {file ? file.name : '엑셀(xlsx/csv) 파일을 드롭하거나 클릭'}
      </div>
      <div className="text-caption text-ink-muted mt-1">
        {file ? '파일 선택됨 — 업로드 버튼을 누르세요' : '최대 10MB · 1,000건까지'}
      </div>
      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            alert(`${file.name} 업로드 (백엔드 연동 시 동작)`)
          }}
          className="mt-4 btn-primary"
        >
          <Upload size={14} /> 업로드 시작
        </button>
      )}
    </div>
  )
}
