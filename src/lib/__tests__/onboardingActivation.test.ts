import { describe, expect, it } from 'vitest'
import { hasUsableDataSource, isSuccessfulUploadStatus, SUCCESSFUL_UPLOAD_STATUSES } from '../onboardingActivation'

describe('onboarding data source readiness', () => {
  it('accepts an active Trendyol or other API credential', () => {
    expect(hasUsableDataSource({ credentials: [{ is_active: true }] })).toBe(true)
  })

  it('accepts a successfully imported marketplace file', () => {
    expect(hasUsableDataSource({ successfulUploads: 1 })).toBe(true)
  })

  it('does not mark inactive or missing sources as complete', () => {
    expect(hasUsableDataSource({ credentials: [{ is_active: false }], successfulUploads: 0 })).toBe(false)
  })

  it('accepts only final successful upload states as activation evidence', () => {
    for (const status of SUCCESSFUL_UPLOAD_STATUSES) expect(isSuccessfulUploadStatus(status)).toBe(true)
    for (const status of ['processing', 'partial', 'failed', 'stalled', null]) {
      expect(isSuccessfulUploadStatus(status)).toBe(false)
    }
  })
})
