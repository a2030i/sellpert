import { describe, expect, it } from 'vitest'
import { hasUsableDataSource } from '../onboardingActivation'

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
})
