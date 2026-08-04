type SourceCredential = { is_active?: boolean | null }

export const SUCCESSFUL_UPLOAD_STATUSES = ['success', 'completed', 'done'] as const

export function isSuccessfulUploadStatus(status?: string | null) {
  return SUCCESSFUL_UPLOAD_STATUSES.includes(status as (typeof SUCCESSFUL_UPLOAD_STATUSES)[number])
}

export type DataSourceReadinessInput = {
  credentials?: SourceCredential[] | null
  hasSallaStore?: boolean
  successfulUploads?: number
}

export function hasUsableDataSource(input: DataSourceReadinessInput) {
  return Boolean(
    input.hasSallaStore
    || Number(input.successfulUploads || 0) > 0
    || input.credentials?.some(credential => credential.is_active === true),
  )
}
