/**
 * Monitor — Tab 3: 설정
 *  ├─ 자동 검증 주기 (매일 03:00 / 일 2회 / 시간당 1회 - 플랜별)
 *  ├─ 알림 채널 (이메일 / 카카오 / Slack 웹훅 - 플랜별)
 *  ├─ 동 일치 임계값, 상호 유사도 임계값
 *  └─ 구글시트 실시간 연동 URL
 */
import { useState } from 'react'
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
} from 'lucide-react'

interface Settings {
  schedule: 'daily-3am' | 'twice-daily' | 'hourly'
  emailEnabled: boolean
  emailAddress: string
  kakaoEnabled: boolean
  kakaoNumber: string
  slackEnabled: boolean
  slackWebhook: string
  dongThreshold: number       // 0~100 (동 일치 시 비교 대상 길이 가중)
  nameThreshold: number       // 0~100 (상호 유사도)
  sheetUrl: string
  sheetSyncEnabled: boolean
}

const DEFAULT_SETTINGS: Settings = {
  schedule: 'daily-3am',
  emailEnabled: true,
  emailAddress: 'user@example.com',
  kakaoEnabled: false,
  kakaoNumber: '',
  slackEnabled: false,
  slackWebhook: '',
  dongThreshold: 70,
  nameThreshold: 40,
  sheetUrl: '',
  sheetSyncEnabled: false,
}

export default function SettingsTab() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = () => {
    // 백엔드 API 연동 시: PUT /api/v1/settings
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  // 사용자 플랜 (mock - 추후 useAuthStore 연동)
  type Plan = 'free' | 'basic' | 'pro' | 'enterprise'
  const userPlan = 'free' as Plan

  return (
    <div className="space-y-6">
      {/* ───── 자동 검증 주기 ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Clock size={18} />}
          title="자동 검증 주기"
          desc="시스템이 자동으로 검증을 수행할 빈도를 선택합니다."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ScheduleOption
            id="daily-3am"
            current={s.schedule}
            onSelect={(v) => update('schedule', v)}
            title="매일 1회"
            desc="새벽 03:00 KST 자동 실행"
            badge="모든 플랜"
            available
          />
          <ScheduleOption
            id="twice-daily"
            current={s.schedule}
            onSelect={(v) => update('schedule', v)}
            title="일 2회"
            desc="03:00 / 15:00 자동 실행"
            badge="Pro 플랜+"
            available={userPlan === 'pro' || userPlan === 'enterprise'}
          />
          <ScheduleOption
            id="hourly"
            current={s.schedule}
            onSelect={(v) => update('schedule', v)}
            title="시간당 1회"
            desc="매 정시 자동 실행"
            badge="Enterprise"
            available={userPlan === 'enterprise'}
          />
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
          {/* 이메일 */}
          <ChannelRow
            icon={<Mail size={16} />}
            title="이메일"
            badge="모든 플랜"
            available
            enabled={s.emailEnabled}
            onToggle={(v) => update('emailEnabled', v)}
          >
            <input
              type="email"
              value={s.emailAddress}
              onChange={(e) => update('emailAddress', e.target.value)}
              placeholder="alerts@example.com"
              className="w-full px-3 py-2 rounded-xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
          </ChannelRow>

          {/* 카카오 */}
          <ChannelRow
            icon={<MessageSquare size={16} />}
            title="카카오 알림톡"
            badge="Pro 플랜+"
            available={userPlan === 'pro' || userPlan === 'enterprise'}
            enabled={s.kakaoEnabled}
            onToggle={(v) => update('kakaoEnabled', v)}
          >
            <input
              type="text"
              value={s.kakaoNumber}
              onChange={(e) => update('kakaoNumber', e.target.value)}
              placeholder="010-1234-5678"
              className="w-full px-3 py-2 rounded-xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
          </ChannelRow>

          {/* Slack 웹훅 */}
          <ChannelRow
            icon={<Webhook size={16} />}
            title="Slack 웹훅"
            badge="Enterprise"
            available={userPlan === 'enterprise'}
            enabled={s.slackEnabled}
            onToggle={(v) => update('slackEnabled', v)}
          >
            <input
              type="url"
              value={s.slackWebhook}
              onChange={(e) => update('slackWebhook', e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-2 rounded-xl bg-bg-subtle/60 border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 focus:bg-white transition-colors"
            />
          </ChannelRow>
        </div>
      </Card>

      {/* ───── 검증 임계값 ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Sliders size={18} />}
          title="검증 임계값 (고급)"
          desc="동·상호 일치 판정의 민감도를 조정합니다. 값이 높을수록 엄격합니다."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ThresholdSlider
            label="동(洞) 일치 임계값"
            value={s.dongThreshold}
            onChange={(v) => update('dongThreshold', v)}
            hint="등록 동의 키워드 70% 이상 포함되면 일치로 판정 (권장 70)"
          />
          <ThresholdSlider
            label="상호 유사도 임계값"
            value={s.nameThreshold}
            onChange={(v) => update('nameThreshold', v)}
            hint="등록 상호 vs 실제 상호 유사도 0.4 이상이면 일치 (권장 40)"
          />
        </div>
      </Card>

      {/* ───── 구글시트 실시간 연동 ───── */}
      <Card variant="subtle">
        <SectionHeader
          icon={<FileSpreadsheet size={18} />}
          title="구글시트 실시간 연동"
          desc="등록·검증 결과·이력이 사용자 구글시트로 실시간 동기화됩니다."
          badge={userPlan === 'free' ? 'Basic 플랜+' : undefined}
        />
        <div className="flex items-center justify-between p-4 rounded-2xl bg-white mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-body-sm text-ink font-semibold">실시간 동기화</div>
            <div className="text-caption text-ink-muted">
              새 검증 결과가 즉시 시트에 추가됩니다.
            </div>
          </div>
          <Toggle
            enabled={s.sheetSyncEnabled}
            onChange={(v) => update('sheetSyncEnabled', v)}
            disabled={userPlan === 'free'}
          />
        </div>

        <input
          type="url"
          value={s.sheetUrl}
          onChange={(e) => update('sheetUrl', e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          disabled={userPlan === 'free'}
          className="w-full px-3 py-2.5 rounded-2xl bg-white border border-transparent text-body-sm text-ink placeholder:text-ink-soft focus:outline-none focus:border-brand-300 transition-colors disabled:bg-bg-subtle/50 disabled:cursor-not-allowed"
        />
        {userPlan === 'free' && (
          <div className="mt-3 text-caption text-ink-muted flex items-center gap-1.5">
            <Lock size={12} /> Free 플랜에서는 사용할 수 없습니다. Basic 플랜 이상에서 활성화됩니다.
          </div>
        )}
      </Card>

      {/* ───── 저장 버튼 ───── */}
      <div className="flex justify-end items-center gap-3 sticky bottom-4">
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-status-success text-body-sm font-medium animate-fade-in">
            <CheckCircle2 size={16} /> 저장되었습니다
          </span>
        )}
        <button type="button" onClick={handleSave} className="btn-primary">
          <Save size={14} /> 설정 저장
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

interface ScheduleOptionProps {
  id: 'daily-3am' | 'twice-daily' | 'hourly'
  current: string
  onSelect: (v: ScheduleOptionProps['id']) => void
  title: string
  desc: string
  badge: string
  available: boolean
}

function ScheduleOption({ id, current, onSelect, title, desc, badge, available }: ScheduleOptionProps) {
  const selected = current === id
  return (
    <button
      type="button"
      onClick={() => available && onSelect(id)}
      disabled={!available}
      className={`text-left p-4 rounded-card border-2 transition-all ${
        selected
          ? 'border-brand-500 bg-brand-50/50'
          : 'border-bg-subtle bg-white hover:border-brand-200'
      } ${!available && 'opacity-50 cursor-not-allowed'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-body text-ink font-semibold">{title}</span>
        {!available && <Lock size={12} className="text-ink-muted" />}
      </div>
      <div className="text-caption text-ink-muted mb-2">{desc}</div>
      <span
        className={`inline-block px-2 py-0.5 rounded-pill text-caption font-bold ${
          available
            ? 'bg-brand-50 text-brand-700'
            : 'bg-bg-subtle text-ink-soft'
        }`}
      >
        {badge}
      </span>
    </button>
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

interface ThresholdSliderProps {
  label: string
  value: number
  onChange: (v: number) => void
  hint: string
}

function ThresholdSlider({ label, value, onChange, hint }: ThresholdSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm text-ink font-semibold">{label}</span>
        <span className="text-body-sm text-brand-600 font-bold tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-500"
      />
      <div className="text-caption text-ink-muted mt-1">{hint}</div>
    </div>
  )
}
