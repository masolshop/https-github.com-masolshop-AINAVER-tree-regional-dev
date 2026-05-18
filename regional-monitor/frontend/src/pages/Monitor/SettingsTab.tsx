/**
 * Monitor — Tab 3: 설정 (실 API 연동)
 *
 *  GET   /api/v1/settings   → useSettings()
 *  PATCH /api/v1/settings   → useUpdateSettings()
 *
 *  자동 검증 주기 (2026-05-01 통합):
 *    스케줄러가 v2 (15분 96슬롯) 단독 본가동으로 통합되어,
 *    각 회원의 등록 070 은 슈퍼어드민이 일괄 관리하는 시스템 자동 스케줄로
 *    분산 검증됩니다. 회원별 시각 선택 UI 는 더 이상 노출하지 않습니다.
 *
 *  알림 이메일 추가 수신자(notify_emails):
 *    영업관리자/고객 담당자 등도 알림을 함께 받을 수 있도록 최대 5명까지 추가 가능.
 *    이메일 알림은 가입 이메일(To) + notify_emails(Cc) 로 일괄 발송.
 *
 *  플랜 게이팅: settings.available_channels 로 채널 활성화 가능 여부 판단
 *    free        → email_alerts
 *    pro+        → + kakao_number
 *    enterprise  → + slack_webhook
 *
 *  2026-05-01: 검증 임계값 카드 / 구글시트 실시간 연동 카드 제거 — 미사용 기능 정리.
 */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import {
  Clock,
  Mail,
  MessageSquare,
  Webhook,
  Save,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Loader2,
  Calendar,
  Plus,
  X,
} from 'lucide-react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { ApiError } from '@/api/client'
import type { SettingsPatch, ChannelKey } from '@/api/types'

const MAX_NOTIFY_EMAILS = 5
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

/* ─────────────── 로컬 폼 상태 (서버 응답을 미러링) ─────────────── */

interface FormState {
  email_alerts: boolean
  notify_emails: string[]            // 추가 수신자 (영업관리자/고객 담당자 등)
  kakao_number: string
  slack_webhook: string
}

const EMPTY_FORM: FormState = {
  email_alerts: true,
  notify_emails: [],
  kakao_number: '',
  slack_webhook: '',
}

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
      notify_emails: settingsQuery.data.notify_emails ?? [],
      kakao_number: settingsQuery.data.kakao_number ?? '',
      slack_webhook: settingsQuery.data.slack_webhook ?? '',
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
    // 추가 수신자 — 빈 문자열 제외 + 형식 검증
    const cleanedEmails = form.notify_emails
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
    const invalid = cleanedEmails.find((e) => !EMAIL_RE.test(e))
    if (invalid) {
      setError(`유효하지 않은 이메일 형식입니다: ${invalid}`)
      return
    }
    if (cleanedEmails.length > MAX_NOTIFY_EMAILS) {
      setError(`추가 수신자는 최대 ${MAX_NOTIFY_EMAILS}명까지 등록할 수 있습니다`)
      return
    }
    // 변경 필드만 패치로 전송 (서버는 빈문자열 → null 정규화)
    const patch: SettingsPatch = {
      email_alerts: form.email_alerts,
      notify_emails: cleanedEmails,
      kakao_number: form.kakao_number.trim() || null,
      slack_webhook: form.slack_webhook.trim() || null,
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
      notify_emails: settingsQuery.data.notify_emails ?? [],
      kakao_number: settingsQuery.data.kakao_number ?? '',
      slack_webhook: settingsQuery.data.slack_webhook ?? '',
    })
    setDirty(false)
    setError(null)
  }

  /* ── 추가 수신자(notify_emails) 핸들러 ── */
  const updateNotifyEmail = (idx: number, value: string) => {
    setForm((prev) => {
      const next = [...prev.notify_emails]
      next[idx] = value
      return { ...prev, notify_emails: next }
    })
    setDirty(true)
    setSavedAt(null)
    setError(null)
  }
  const addNotifyEmail = () => {
    if (form.notify_emails.length >= MAX_NOTIFY_EMAILS) return
    setForm((prev) => ({ ...prev, notify_emails: [...prev.notify_emails, ''] }))
    setDirty(true)
    setSavedAt(null)
    setError(null)
  }
  const removeNotifyEmail = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      notify_emails: prev.notify_emails.filter((_, i) => i !== idx),
    }))
    setDirty(true)
    setSavedAt(null)
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
  const channels = new Set<ChannelKey>(data.available_channels)
  const can = {
    email: channels.has('email_alerts'),
    kakao: channels.has('kakao_number'),
    slack: channels.has('slack_webhook'),
  }

  const canAddMoreEmail = form.notify_emails.length < MAX_NOTIFY_EMAILS

  return (
    <div className="space-y-6 pb-20">
      {/* ───── 자동 검증 안내 (스케줄러 통합 후 시스템 자동 관리) ───── */}
      <AutoVerifyInfoCard />

      {/* ───── 알림 채널 ───── */}
      <Card variant="white">
        <SectionHeader
          icon={<Mail size={18} />}
          title="알림 채널"
          desc="검증 결과 변경(네이버 미노출, 변경 노출 등) 발생 시 알림을 받을 채널을 설정합니다."
        />

        <div className="space-y-3">
          {/* 이메일 — 모든 플랜 (가입 이메일 + 추가 수신자) */}
          <ChannelRow
            icon={<Mail size={16} />}
            title="이메일"
            badge="모든 플랜"
            available={can.email}
            enabled={form.email_alerts}
            onToggle={(v) => update('email_alerts', v)}
          >
            {/* 가입 이메일 (To) */}
            <div className="text-body-sm text-ink-muted px-3 py-2 rounded-xl bg-bg-subtle/40 mb-3">
              <span className="font-medium text-ink">{data.email_address}</span>
              <span className="text-caption ml-2">
                · 가입 이메일 (기본 수신자)
              </span>
            </div>

            {/* 추가 수신자 (Cc) — 영업관리자/고객 담당자 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-body-sm text-ink font-semibold">
                    추가 수신자
                    <span className="text-caption font-medium text-ink-muted ml-2">
                      (영업관리자 · 고객 담당자 등 · 최대 {MAX_NOTIFY_EMAILS}명)
                    </span>
                  </div>
                  <div className="text-caption text-ink-muted">
                    알림 발송 시 가입 이메일과 함께 참조(Cc)로 전송됩니다.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addNotifyEmail}
                  disabled={!canAddMoreEmail}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-pill bg-brand-50 text-brand-700 font-semibold text-caption hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  <Plus size={12} /> 이메일 추가
                </button>
              </div>

              {form.notify_emails.length === 0 && (
                <div className="text-caption text-ink-muted px-3 py-3 rounded-xl bg-bg-subtle/30 border border-dashed border-bg-subtle text-center">
                  추가 수신자가 없습니다. <b className="text-ink">이메일 추가</b> 버튼으로 영업관리자 · 고객 담당자 등을 등록할 수 있습니다.
                </div>
              )}

              {form.notify_emails.map((email, idx) => {
                const trimmed = email.trim()
                const isInvalid = trimmed.length > 0 && !EMAIL_RE.test(trimmed)
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => updateNotifyEmail(idx, e.target.value)}
                      placeholder={
                        idx === 0 ? 'manager@company.com (영업관리자)'
                        : idx === 1 ? 'sales@company.com (고객 담당자)'
                        : 'name@example.com'
                      }
                      className={`flex-1 px-3 py-2 rounded-xl bg-white border text-body-sm text-ink placeholder:text-ink-soft focus:outline-none transition-colors ${
                        isInvalid
                          ? 'border-red-300 focus:border-red-400 bg-red-50/30'
                          : 'border-bg-subtle focus:border-brand-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeNotifyEmail(idx)}
                      className="w-9 h-9 rounded-xl bg-bg-subtle/60 text-ink-muted hover:bg-red-50 hover:text-status-danger flex items-center justify-center shrink-0 transition-colors"
                      title="삭제"
                      aria-label="추가 수신자 삭제"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}

              {!canAddMoreEmail && (
                <div className="text-caption text-status-warning flex items-center gap-1.5 mt-1">
                  <AlertTriangle size={12} /> 최대 {MAX_NOTIFY_EMAILS}명까지 등록 가능합니다.
                </div>
              )}
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

      {/* (제거됨) 검증 임계값 / 구글시트 실시간 연동 카드 — 2026-05-01 미사용 기능 정리 */}

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

function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `네트워크 오류: ${e.message}`
    return `${e.status}: ${e.message}`
  }
  return (e as Error)?.message ?? '알 수 없는 오류'
}

/* ─────────────── 자동 검증 안내 카드 (스케줄러 통합 후 읽기 전용) ─────────────── */
/**
 * 자동 검증은 슈퍼어드민이 v2(15분 96슬롯) 스케줄러로 일괄 관리합니다.
 * 회원별 시각 선택은 제거되었으며, 본 카드는 안내 정보만 표시합니다.
 */
function AutoVerifyInfoCard() {
  return (
    <Card variant="white">
      <SectionHeader
        icon={<Clock size={18} />}
        title="자동 검증 안내"
        desc="등록하신 070 번호는 시스템이 자동으로 정기 검증합니다. 검증 결과는 알림 채널과 대시보드에서 확인할 수 있습니다."
      />
      <div className="rounded-card p-4 bg-brand-50/40 border border-brand-100">
        <div className="flex items-center gap-2 mb-2">
          <Calendar size={14} className="text-brand-600" />
          <span className="text-caption font-bold text-brand-700">시스템 자동 검증</span>
        </div>
        <div className="text-body-sm text-ink leading-relaxed">
          분산된 시간대에 자동으로 정기 검증이 수행됩니다. 검증 변경 사항이 발견되면
          이메일 등 설정된 알림 채널로 즉시 안내드립니다.
        </div>
        <div className="text-caption text-ink-muted mt-2">
          별도의 시각 설정은 필요하지 않으며, 결과는{' '}
          <b className="text-ink">자동 노출 검증 관리</b> 메뉴에서 회차별로 확인할 수 있습니다.
        </div>
      </div>
    </Card>
  )
}
