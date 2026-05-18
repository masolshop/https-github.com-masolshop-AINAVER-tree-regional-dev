/**
 * 어드민 사용자 관리 — 검색/필터, 플랜·차단 변경, 삭제.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatKSTRelative } from '@/utils/datetime'
import {
  Ban,
  Check,
  Crown,
  Edit3,
  Search,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react'

import { adminApi, type AdminPlanKey, type AdminUserOut, type UserListQuery } from '@/api/admin'
import { Card } from '@/components/ui/Card'
import { useAuthStore } from '@/store/auth'

const PLAN_OPTIONS: AdminPlanKey[] = ['free', 'basic', 'pro', 'enterprise']
const PLAN_BADGE: Record<AdminPlanKey, string> = {
  free: 'bg-slate-100 text-slate-700',
  basic: 'bg-sky-100 text-sky-700',
  pro: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-amber-100 text-amber-800',
}

export function AdminUsers() {
  const me = useAuthStore((s) => s.user)

  const [q, setQ] = useState('')
  const [plan, setPlan] = useState<AdminPlanKey | ''>('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'blocked'>('all')
  const [editing, setEditing] = useState<AdminUserOut | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUserOut | null>(null)

  const query: UserListQuery = {
    q: q.trim() || undefined,
    plan: plan || undefined,
    is_active: activeFilter === 'all' ? undefined : activeFilter === 'active',
    limit: 100,
    sort: 'recent',
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => adminApi.listUsers(query),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-4">
      {/* 검색 / 필터 바 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이메일 / 이름 / 회사 검색"
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm placeholder:text-ink-muted focus:border-brand-400 focus:outline-none"
            />
          </div>

          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as AdminPlanKey | '')}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">플랜 전체</option>
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg border border-line bg-white p-1">
            {(['all', 'active', 'blocked'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setActiveFilter(k)}
                className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                  activeFilter === k
                    ? 'bg-ink text-white'
                    : 'text-ink-muted hover:bg-slate-50'
                }`}
              >
                {k === 'all' ? '전체' : k === 'active' ? '활성' : '차단'}
              </button>
            ))}
          </div>

          <div className="ml-auto text-sm text-ink-muted">
            {data ? `총 ${data.total.toLocaleString()}명` : '...'}
          </div>
        </div>
      </Card>

      {/* 표 */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-line bg-slate-50 text-left">
              <tr className="text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">사용자</th>
                <th className="px-4 py-3 font-semibold">플랜</th>
                <th className="px-4 py-3 font-semibold text-right">등록 070</th>
                <th className="px-4 py-3 font-semibold text-right">쿼터</th>
                <th className="px-4 py-3 font-semibold">상태</th>
                <th className="px-4 py-3 font-semibold">최근 로그인</th>
                <th className="px-4 py-3 font-semibold text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink-muted">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink-muted">
                    조건에 맞는 사용자가 없습니다.
                  </td>
                </tr>
              )}
              {data?.items.map((u) => (
                <tr key={u.id} className="border-b border-line/60 last:border-0 hover:bg-slate-50/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {u.is_superadmin && (
                        <Crown className="h-4 w-4 text-amber-500" aria-label="superadmin" />
                      )}
                      <div className="leading-tight">
                        <div className="font-semibold text-ink">{u.name}</div>
                        <div className="text-xs text-ink-muted">{u.email}</div>
                      </div>
                    </div>
                    {u.company && (
                      <div className="mt-1 text-xs text-ink-muted">{u.company}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLAN_BADGE[u.plan]}`}
                    >
                      {u.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {u.place_count}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-ink-muted">
                    {u.quota_places.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        <Check className="h-3 w-3" /> 활성
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700" title={u.blocked_reason || ''}>
                        <Ban className="h-3 w-3" /> 차단
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {formatKSTRelative(u.last_login_at, '—')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => setEditing(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink hover:bg-slate-50"
                        title="편집"
                      >
                        <Edit3 className="h-3.5 w-3.5" /> 편집
                      </button>
                      <button
                        onClick={() => setConfirmDelete(u)}
                        disabled={u.id === me?.id}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                        title="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> 삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          isSelf={editing.id === me?.id}
        />
      )}

      {confirmDelete && (
        <DeleteUserModal
          user={confirmDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────
// 편집 모달
// ──────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  isSelf,
}: {
  user: AdminUserOut
  onClose: () => void
  isSelf: boolean
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState<string>(user.name || '')
  const [email, setEmail] = useState<string>(user.email || '')
  const [company, setCompany] = useState<string>(user.company || '')
  const [plan, setPlan] = useState<AdminPlanKey>(user.plan)
  const [quotaPlaces, setQuotaPlaces] = useState<number>(user.quota_places)
  const [isActive, setIsActive] = useState<boolean>(user.is_active)
  const [blockedReason, setBlockedReason] = useState<string>(user.blocked_reason || '')
  const [isSuperadmin, setIsSuperadmin] = useState<boolean>(user.is_superadmin)

  const mutation = useMutation({
    mutationFn: () => {
      const patch: import('@/api/admin').AdminUserPatch = {
        plan,
        quota_places: quotaPlaces,
        is_active: isActive,
        blocked_reason: !isActive ? blockedReason || null : null,
        is_superadmin: isSuperadmin,
      }
      // 변경된 텍스트 필드만 전송
      const trimmedName = name.trim()
      if (trimmedName && trimmedName !== user.name) {
        patch.name = trimmedName
      }
      const trimmedEmail = email.trim().toLowerCase()
      if (trimmedEmail && trimmedEmail !== (user.email || '').toLowerCase()) {
        patch.email = trimmedEmail
      }
      const trimmedCompany = company.trim()
      if (trimmedCompany !== (user.company || '')) {
        patch.company = trimmedCompany || null
      }
      return adminApi.patchUser(user.id, patch)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
      onClose()
    },
  })

  return (
    <Modal onClose={onClose} title={`사용자 편집 — ${user.name}`}>
      <div className="space-y-4">
        <FieldGroup label="이름">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
        </FieldGroup>

        <FieldGroup label="이메일 (로그인 ID로 사용됨)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm"
          />
          <div className="mt-1 text-[11px] text-amber-600">
            ⚠️ 이메일 변경 시 사용자에게 새 이메일로 안내가 필요합니다 (중복 시 409 에러).
          </div>
        </FieldGroup>

        <FieldGroup label="회사명">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="(선택) 회사/상호명"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
        </FieldGroup>

        <FieldGroup label="플랜 (유료 등업)">
          <select
            value={plan}
            onChange={(e) => {
              const p = e.target.value as AdminPlanKey
              setPlan(p)
              const DEFAULT = { free: 5, basic: 50, pro: 500, enterprise: 10000 }
              setQuotaPlaces(DEFAULT[p])
            }}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-ink-muted">
            플랜 변경 시 quota는 기본값으로 자동 갱신됩니다 (free=5, basic=50, pro=500, enterprise=10000).
          </div>
        </FieldGroup>

        <FieldGroup label="등록 가능 070 수량 (quota)">
          <input
            type="number"
            min={0}
            value={quotaPlaces}
            onChange={(e) => setQuotaPlaces(Number(e.target.value))}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
        </FieldGroup>

        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <div>
            <div className="text-sm font-semibold text-ink">계정 활성</div>
            <div className="text-xs text-ink-muted">차단하면 로그인 불가</div>
          </div>
          <Toggle checked={isActive} onChange={setIsActive} disabled={isSelf} />
        </div>

        {!isActive && (
          <FieldGroup label="차단 사유 (사용자에게 노출)">
            <input
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder="예: 약관 위반"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </FieldGroup>
        )}

        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex items-start gap-2">
            <ShieldOff className="mt-0.5 h-4 w-4 text-amber-600" />
            <div>
              <div className="text-sm font-semibold text-ink">슈퍼어드민 권한</div>
              <div className="text-xs text-ink-muted">
                관리자 콘솔 전체 접근. 자기 자신은 해제할 수 없음.
              </div>
            </div>
          </div>
          <Toggle checked={isSuperadmin} onChange={setIsSuperadmin} disabled={isSelf} />
        </div>

        {mutation.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ──────────────────────────────────────────────────────────────
// 삭제 확인 모달
// ──────────────────────────────────────────────────────────────

function DeleteUserModal({ user, onClose }: { user: AdminUserOut; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState('')
  const mutation = useMutation({
    mutationFn: () => adminApi.deleteUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
      onClose()
    },
  })

  const okWord = user.email
  const ok = confirm === okWord

  return (
    <Modal onClose={onClose} title="사용자 영구 삭제">
      <div className="space-y-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-bold">⚠️ 되돌릴 수 없는 작업</div>
          <div className="mt-1 text-rose-700">
            <strong>{user.email}</strong> 계정과 그 사용자의 모든 등록 070, 검증 이력,
            변경 이벤트, 결제 레코드가 영구 삭제됩니다.
          </div>
        </div>

        <FieldGroup label={`확인을 위해 사용자 이메일을 입력하세요`}>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={user.email}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm"
          />
        </FieldGroup>

        {mutation.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!ok || mutation.isPending}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? '삭제 중…' : '영구 삭제'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ──────────────────────────────────────────────────────────────
// 공통 UI
// ──────────────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-slate-100 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-ink-muted">{label}</div>
      {children}
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (b: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-brand-500' : 'bg-slate-300'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
