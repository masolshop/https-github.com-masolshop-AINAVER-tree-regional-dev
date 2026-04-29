/**
 * Backup API — /api/v1/admin/backup/*
 * (require_superadmin 백엔드 가드)
 */
import { api, getAuthHeaders, getApiBase } from './client'

export type BackupCategory = 'db' | 'users' | 'code'

export interface BackupFile {
  filename: string
  size: number
  size_human: string
  mtime: string // KST ISO
}

export interface BackupListResponse {
  now_kst: string
  db: BackupFile[]
  users: BackupFile[]
  code: BackupFile[]
}

export interface BackupCategoryStats {
  count: number
  bytes: number
  size_human: string
  latest_mtime: string | null
}

export interface GDriveStatus {
  enabled: boolean
  ready: boolean
  libs_installed: boolean
  credentials_path_set: boolean
  credentials_path_exists: boolean
  folder_id_set: boolean
  folder_id: string | null
  retention_days: number
  remote_total?: number
  remote_total_size?: number
  remote_total_size_human?: string
  remote_by_category?: Record<BackupCategory, number>
  remote_error?: string
}

export interface BackupStatusResponse {
  now_kst: string
  total_bytes: number
  total_size_human: string
  s3_enabled: boolean
  s3_bucket: string | null
  retention_days: number
  schedule: Record<BackupCategory, string>
  categories: Record<BackupCategory, BackupCategoryStats>
  gdrive: GDriveStatus
}

export interface GDriveFile {
  category: BackupCategory
  file_id: string
  name: string
  size: number
  created_time: string
  modified_time: string | null
  web_view_link: string | null
}

export interface GDriveListResponse {
  ok: boolean
  files: GDriveFile[]
  count?: number
  reason?: string
  status?: GDriveStatus
  now_kst?: string
}

export interface GDriveUploadResponse {
  ok: boolean
  category: BackupCategory
  filename: string
  file_id: string
  name: string
  size: number
  created_time: string
  web_view_link: string | null
}

export interface GDriveSyncResponse {
  ok: boolean
  category: BackupCategory
  uploaded: { name: string; file_id: string; size: number }[]
  uploaded_count: number
  skipped_count: number
  errors: { name: string; error: string }[]
  now_kst: string
}

export interface GDrivePruneResponse {
  ok: boolean
  deleted: number
  kept: number
  errors: { file_id: string; name: string; error: string }[]
  cutoff_iso: string
  retention_days: number
}

export interface BackupRunResponse {
  ok: boolean
  category: BackupCategory
  started_at: string
  method: 'systemctl' | 'direct'
  unit?: string
  pid?: number
  systemctl_error?: string
  message: string
}

export const backupApi = {
  list: () => api.get<BackupListResponse>('/api/v1/admin/backup/list'),

  status: () => api.get<BackupStatusResponse>('/api/v1/admin/backup/status'),

  run: (category: BackupCategory) =>
    api.post<BackupRunResponse>(`/api/v1/admin/backup/run/${category}`, {}),

  /**
   * 다운로드 URL — 파일 다운로드용 absolute URL 생성.
   * (api wrapper 가 JSON 만 다루므로, anchor href 로 직접 사용)
   */
  downloadUrl: (category: BackupCategory, filename: string) => {
    const base = getApiBase()
    const path = `/api/v1/admin/backup/download/${category}/${encodeURIComponent(filename)}`
    return `${base}${path}`
  },

  /**
   * fetch 로 다운로드 (Authorization 헤더 필요) → blob → save
   */
  download: async (category: BackupCategory, filename: string): Promise<void> => {
    const url = backupApi.downloadUrl(category, filename)
    const res = await fetch(url, {
      headers: getAuthHeaders(),
    })
    if (!res.ok) {
      throw new Error(`다운로드 실패: ${res.status} ${res.statusText}`)
    }
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000)
  },

  // ── Google Drive ───────────────────────────────────────
  gdriveStatus: () => api.get<GDriveStatus>('/api/v1/admin/backup/gdrive/status'),

  gdriveList: (category?: BackupCategory) =>
    api.get<GDriveListResponse>(
      `/api/v1/admin/backup/gdrive/list${category ? `?category=${category}` : ''}`,
    ),

  gdriveUpload: (category: BackupCategory, filename: string) =>
    api.post<GDriveUploadResponse>(
      `/api/v1/admin/backup/gdrive/upload/${category}/${encodeURIComponent(filename)}`,
      {},
    ),

  gdriveSync: (category: BackupCategory) =>
    api.post<GDriveSyncResponse>(`/api/v1/admin/backup/gdrive/sync/${category}`, {}),

  gdrivePrune: (category?: BackupCategory, days?: number) => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    if (typeof days === 'number') qs.set('days', String(days))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return api.post<GDrivePruneResponse>(
      `/api/v1/admin/backup/gdrive/prune${suffix}`,
      {},
    )
  },

  gdriveDelete: (fileId: string) =>
    api.del<{ ok: boolean; file_id: string }>(
      `/api/v1/admin/backup/gdrive/file/${encodeURIComponent(fileId)}`,
    ),
}
