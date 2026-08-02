export const UPLOAD_STALLED_AFTER_MS = 30 * 60 * 1000

export type UploadDisplayStatus = 'success' | 'partial' | 'failed' | 'processing' | 'stalled' | 'unknown'

const SUCCESS_STATUSES = new Set(['success', 'completed'])
const FAILED_STATUSES = new Set(['failed', 'error'])
const PROCESSING_STATUSES = new Set(['processing', 'running'])

export function isStalledUpload(status: string | null | undefined, uploadedAt: string | null | undefined, now = Date.now()) {
  if (!status || !PROCESSING_STATUSES.has(status.toLowerCase()) || !uploadedAt) return false
  const startedAt = new Date(uploadedAt).getTime()
  return Number.isFinite(startedAt) && now - startedAt >= UPLOAD_STALLED_AFTER_MS
}

export function uploadDisplayStatus(status: string | null | undefined, uploadedAt: string | null | undefined, now = Date.now()): UploadDisplayStatus {
  const normalized = status?.toLowerCase() || ''
  if (SUCCESS_STATUSES.has(normalized)) return 'success'
  if (normalized === 'partial') return 'partial'
  if (FAILED_STATUSES.has(normalized)) return 'failed'
  if (PROCESSING_STATUSES.has(normalized)) return isStalledUpload(normalized, uploadedAt, now) ? 'stalled' : 'processing'
  return 'unknown'
}
