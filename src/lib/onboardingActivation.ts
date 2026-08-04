type SourceCredential = { is_active?: boolean | null }

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
