/**
 * Monitor — Tab 3: 설정 (실 API 연동)
 *
 *  GET   /api/v1/settings   → useSettings()
 *  PATCH /api/v1/settings   → useUpdateSettings()
 *
 *  자동 검증 주기: 백엔드가 verify_slot(0~23) 으로 매시간 분산 → "매일 N시 KST" 표시 (읽기 전용)
 *  플랜 게이팅: settings.available_channels 로 채널 활성화 가능 여부 판단
 *    free        → email_alerts
 *    basic+      → + sheet_sync
 *    pro+        → + kakao_number
 *    enterprise  → + slack_webhook
 */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import {
  Clock,
  Mail,
  MessageSquare,
  Webhook,
  FileSpreadsheet,
  Save,
  Sliders,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Loader2,
  Calendar,
} from 'lucide-react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { ApiError } from '@/api/client'
import type { SettingsPatch, ChannelKey, PlanKey } from '@/api/types'

/* ─────────────── 로컬 폼 상태 (서버 응답을 미러링) ─────────────── */

interface FormState {
  email_alerts: boolean
  kakao_number: string
  slack_webhook: string
  sheet_url: string
  sheet_sync_enabled: boolean
}

const EMPTY_FORM: FormState = {
  email_alerts: true,
  kakao_number: '',
  slack_webhook: '',
  sheet_url: '',
  sheet_sync_enabled: false,
}

const PLAN_LABEL: Record<PlanKey, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

/* 검증 임계값은 서버 글로벌 (.env DONG_THRESHOLD/NAME_THRESHOLD) — 사용자별 저장은 추후 */
const SERVER_DONG_THRESHOLD = 70
const SERVER_NAME_THRESHOLD = 40

export default function SettingsTab() {
  const settingsQuery = useSettings()
  const updateMut = useUpdateSettings()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // 서버 응답 → 폼 동기화 (편집 중이 아닐 때만)
  useEffect(() => {
    if (!settingsQuery.data || dirty) return
    setForm({
      email_alerts: settingsQuery.data.email_alerts,
      kakao_number: settingsQuery.data.kakao_number ?? '',
      slack_webhook: settingsQuery.data.slack_webhook ?? '',
      sheet_url: settingsQuery.data.sheet_url ?? '',
      sheet_sync_enabled: settingsQuery.data.sheet_sync_enabled,
    })
  }, [settingsQuery.data, dirty])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setSavedAt(null)
    setError(null)
  }

  const handleSave = async () => {
    setError(null)
    // 변경 필드만 패치로 전송 (서버는 빈문자열 → null 정규화)
    const patch: SettingsPatch = {
      email_alerts: form.email_alerts,
      kakao_number: form.kakao_number.trim() || null,
      slack_webhook: form.slack_webhook.trim() || null,
      sheet_url: form.sheet_url.trim() || null,
      sheet_sync_enabled: form.sheet_sync_enabled,
    }
    try {
      await updateMut.mutateAsync(patch)
      setDirty(false)
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatApiError(e))
    }
  }

  const handleReset = () => {
    if (!settingsQuery.data) return
    setForm({
      email_alerts: settingsQuery.data.email_alerts,
      kakao_number: settingsQuery.data.kakao_number ?? '',
      slack_webhook: settingsQuery.data.slack_webhook ?? '',
      sheet_url: settingsQuery.data.sheet_url ?? '',
      sheet_sync_enabled: settingsQuery.data.sheet_sync_enabled,
    })
    setDirty(false)
    setError(null)
  }

  // 로딩 / 에러 처리
  if (settingsQuery.isLoading) {
    return (
      <Card variant="white" className="text-center py-16 text-ink-muted">
        <Loader2 className="mx-auto animate-spin mb-3" size={28} />
        설정 불러오는 중…
      </Card>
    )
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <Card variant="white" className="text-center py-16">
        <AlertTriangle className="mx-auto text-status-danger mb-2" size={28} />
        <div className="text-body font-semibold text-ink mb-1">
          설정을 불러올 수 없습니다
        </div>
        <div className="text-caption text-ink-muted mb-4">
          {formatApiError(settingsQuery.error)}
        </div>
        <button
          type="button"
          onClick={() => settingsQuery.refetch()}
          className="btn-primary"
        >
          다시 시도
        </button>
      </Card>
    )
  }

  const data = settingsQuery.data
  const userPlan = data.plan
  const channels = new Set<ChannelKey>(data.available_channels)
  const can = {
    email: channels.has('email_alerts'),
    sheet: channels.has('sheet_sync'),
    kakao: channels.has('kakao_number'),
    slack: channels.has('slack_webhook'),
  }

  return (
    <div className="space-y-6 pb-20">
      {/* ───── 자동 검증 주기 (verify_slot 표시 전용) ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Clock size={18} />}
          title="자동 검증 주기"
          desc="시스템이 자동으로 검증을 수행하는 시각입니다. 사용자별로 매시간 분산 처리됩니다."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-card p-4 bg-brand-50/50 border-2 border-brand-500">
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={14} className="text-brand-600" />
              <span className="text-caption font-bold text-brand-700">현재 적용</span>
            </div>
            <div className="text-h2 font-extrabold text-ink tabular-nums leading-none mb-2">
              {data.verify_slot_label}
            </div>
            <div className="text-caption text-ink-muted">
              슬롯 #{data.verify_slot} · 가입 시 자동 배정 (24시간 분산)
            </div>
          </div>
          <div className="rounded-card p-4 bg-bg-subtle/50 border border-bg-subtle">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} className="text-ink-muted" />
              <span className="text-caption font-bold text-ink-muted uppercase">
                상위 플랜 (예정)
              </span>
            </div>
            <div className="text-body text-ink-muted leading-snug">
              · Pro: 일 2회 (12시간 간격)
              <br />· Enterprise: 시간당 1회
            </div>
          </div>
        </div>
      </Card>

      {/* ───── 알림 채널 ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Mail size={18} />}
          title="알림 채널"
          desc="검증 결과 변경(노출 사라짐, 동 변경 등) 발생 시 알림을 받을 채널을 설정합니다."
        />

        <div className="space-y-3">
          {/* 이메일 — 모든 플랜 */}
          <ChannelRow
            icon={<Mail size={16} />}
            title="이메일"
            badge="모든 플랜"
            available={can.email}
            enabled={form.email_alerts}
            onToggle={(v) => update('email_alerts', v)}
          >
            <div className="text-body-sm text-ink-muted px-3 py-2 rounded-xl bg-bg-subtle/40">
              <span className="font-medium text-ink">{data.email_address}</span>
              <span className="text-caption ml-2">
                · 가입 이메일 (변경은 마이페이지에서 예정)
              </span>
            </div>
          </ChannelRow>

          {/* 카카오 알림톡 — Pro+ */}
          <ChannelRow
            icon={<MessageSquare size={16} />}
            title="카카오 알림톡"
            badge="Pro 플랜+"
            available={can.kakao}
            enabled={Boolean(form.kakao_number) && can.kakao}
            onToggle={(v) => update('kakao_number', v ? form.kakao_number || '010-' : '')}
          >
            <input
              type="text"
              value={form.kakao_number}
              onChange={(e) => update('kakao_number', e.target.value)}
              placeholder="010-1234-5678"
              className="w-full px-3 py-2 rounded-xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
            <p className="text-caption text-ink-muted mt-1.5">
              저장 시 자동으로 010-XXXX-XXXX 형식으로 변환됩니다.
            </p>
          </ChannelRow>

          {/* Slack 웹훅 — Enterprise */}
          <ChannelRow
            icon={<Webhook size={16} />}
            title="Slack 웹훅"
            badge="Enterprise"
            available={can.slack}
            enabled={Boolean(form.slack_webhook) && can.slack}
            onToggle={(v) =>
              update('slack_webhook', v ? form.slack_webhook || 'https://hooks.slack.com/services/' : '')
            }
          >
            <input
              type="url"
              value={form.slack_webhook}
              onChange={(e) => update('slack_webhook', e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-2 rounded-xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors font-mono text-caption"
            />
          </ChannelRow>
        </div>
      </Card>

      {/* ───── 검증 임계값 (서버 글로벌, 표시만) ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Sliders size={18} />}
          title="검증 임계값 (서버 기본값)"
          desc="동·상호 일치 판정의 민감도. 현재 모든 사용자에게 동일하게 적용됩니다."
          badge="고정값"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ReadOnlyValue
            label="동(洞) 일치 임계값"
            value={SERVER_DONG_THRESHOLD}
            hint="등록 동의 키워드 70% 이상 포함되면 일치로 판정"
          />
          <ReadOnlyValue
            label="상호 유사도 임계값"
            value={SERVER_NAME_THRESHOLD}
            hint="등록 상호 vs 실제 상호 유사도 0.4 이상이면 일치"
          />
        </div>
      </Card>

      {/* ───── 구글시트 실시간 연동 — Basic+ ───── */}
      <Card variant="subtle">
        <SectionHeader
          icon={<FileSpreadsheet size={18} />}
          title="구글시트 실시간 연동"
          desc="등록·검증 결과·이력이 사용자 구글시트로 실시간 동기화됩니다."
          badge={!can.sheet ? 'Basic 플랜+ 필요' : undefined}
        />
        <div className="flex items-center justify-between p-4 rounded-2xl bg-white mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-body-sm text-ink font-semibold">실시간 동기화</div>
            <div className="text-caption text-ink-muted">
              새 검증 결과가 즉시 시트에 추가됩니다.
            </div>
          </div>
          <Toggle
            enabled={form.sheet_sync_enabled}
            onChange={(v) => update('sheet_sync_enabled', v)}
            disabled={!can.sheet}
          />
        </div>

        <input
          type="url"
          value={form.sheet_url}
          onChange={(e) => update('sheet_url', e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          disabled={!can.sheet}
          className="w-full px-3 py-2.5 rounded-2xl bg-white border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 transition-colors disabled:bg-bg-subtle/50 disabled:cursor-not-allowed"
        />
        {!can.sheet && (
          <div className="mt-3 text-caption text-ink-muted flex items-center gap-1.5">
            <Lock size={12} /> 현재 {PLAN_LABEL[userPlan]} 플랜에서는 사용할 수 없습니다. Basic 플랜 이상에서 활성화됩니다.
          </div>
        )}
      </Card>

      {/* ───── 저장 바 (sticky) ───── */}
      <div className="fixed bottom-6 right-6 z-30 flex items-center gap-3">
        {error && (
          <div className="px-3 py-2 rounded-card bg-red-50 border border-red-200 text-status-danger text-caption flex items-center gap-1.5 shadow-card">
            <AlertTriangle size={12} />
            {error}
          </div>
        )}
        {savedAt && !dirty && !error && (
          <span className="px-3 py-2 rounded-card bg-emerald-50 border border-emerald-200 text-status-success text-body-sm font-medium flex items-center gap-1.5 shadow-card">
            <CheckCircle2 size={14} /> 저장되었습니다
          </span>
        )}
        {dirty && (
          <button
            type="button"
            onClick={handleReset}
            disabled={updateMut.isPending}
            className="px-4 py-2.5 rounded-pill bg-white text-ink-muted font-medium text-body-sm hover:text-ink shadow-card border border-bg-subtle disabled:opacity-50"
          >
            취소
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || updateMut.isPending}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed shadow-card-hover"
        >
          {updateMut.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> 저장 중…
            </>
          ) : (
            <>
              <Save size={14} /> 설정 저장
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/* ───────────── 서브 컴포넌트 ───────────── */

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  desc: string
  badge?: string
}

function SectionHeader({ icon, title, desc, badge }: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-h3 text-ink">{title}</h3>
          {badge && (
            <span className="px-2 py-0.5 rounded-pill bg-amber-50 text-status-warning text-caption font-bold border border-amber-200">
              {badge}
            </span>
          )}
        </div>
        <p className="text-caption text-ink-muted mt-1">{desc}</p>
      </div>
    </div>
  )
}

interface ChannelRowProps {
  icon: React.ReactNode
  title: string
  badge: string
  available: boolean
  enabled: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}

function ChannelRow({
  icon,
  title,
  badge,
  available,
  enabled,
  onToggle,
  children,
}: ChannelRowProps) {
  return (
    <div
      className={`p-4 rounded-card border ${
        enabled ? 'border-brand-200 bg-brand-50/30' : 'border-bg-subtle bg-white'
      } ${!available && 'opacity-60'}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-bg-subtle text-ink-muted flex items-center justify-center">
            {icon}
          </div>
          <span className="text-body text-ink font-semibold">{title}</span>
          <span
            className={`px-2 py-0.5 rounded-pill text-caption font-bold ${
              available ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-status-warning'
            }`}
          >
            {badge}
          </span>
        </div>
        <Toggle enabled={enabled} onChange={onToggle} disabled={!available} />
      </div>
      {enabled && available && children}
      {!available && (
        <div className="text-caption text-ink-muted flex items-center gap-1.5">
          <Lock size={12} /> 상위 플랜에서 활성화됩니다.
        </div>
      )}
    </div>
  )
}

interface ToggleProps {
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

function Toggle({ enabled, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-pill transition-colors shrink-0 ${
        enabled ? 'bg-brand-500' : 'bg-ink-watermark'
      } ${disabled && 'opacity-50 cursor-not-allowed'}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function ReadOnlyValue({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}) {
  return (
    <div className="rounded-card p-4 bg-bg-subtle/40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ink font-semibold">{label}</span>
        <span className="text-h3 text-brand-600 font-extrabold tabular-nums">
          {value}
        </span>
      </div>
      <div className="text-caption text-ink-muted">{hint}</div>
    </div>
  )
}

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `네트워크 오류: ${e.message}`
    return `${e.status}: ${e.message}`
  }
  return (e as Error)?.message ?? '알 수 없는 오류'
}
