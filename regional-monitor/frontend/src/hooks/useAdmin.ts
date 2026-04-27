/**
 * Admin React Query 훅
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  adminApi,
  type AdminPaymentCreate,
  type AdminPaymentPatch,
  type AdminUserPatch,
  type PaymentListQuery,
  type UserListQuery,
} from '@/api/admin'
import { useAuthStore } from '@/store/auth'

export const adminKeys = {
  all: ['admin'] as const,
  stats: () => ['admin', 'stats'] as const,
  users: (q: UserListQuery) => ['admin', 'users', q] as const,
  user: (id: number) => ['admin', 'user', id] as const,
  payments: (q: PaymentListQuery) => ['admin', 'payments', q] as const,
}

function useEnabled() {
  return useAuthStore((s) => !!s.user?.is_superadmin && !!s.accessToken)
}

export function useAdminStats() {
  const enabled = useEnabled()
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: adminApi.stats,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useAdminUsers(q: UserListQuery = {}) {
  const enabled = useEnabled()
  return useQuery({
    queryKey: adminKeys.users(q),
    queryFn: () => adminApi.listUsers(q),
    enabled,
    staleTime: 15_000,
  })
}

export function useUpdateAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AdminUserPatch }) =>
      adminApi.patchUser(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}

export function useDeleteAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}

export function useAdminPayments(q: PaymentListQuery = {}) {
  const enabled = useEnabled()
  return useQuery({
    queryKey: adminKeys.payments(q),
    queryFn: () => adminApi.listPayments(q),
    enabled,
    staleTime: 15_000,
  })
}

export function useCreateAdminPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AdminPaymentCreate) => adminApi.createPayment(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}

export function useUpdateAdminPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AdminPaymentPatch }) =>
      adminApi.patchPayment(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}
