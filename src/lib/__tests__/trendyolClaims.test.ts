import { describe, expect, it } from 'vitest'
import { normalizeTrendyolClaimStatus } from '../../../supabase/functions/_shared/trendyolClaims'

describe('Trendyol claim normalization', () => {
  it.each([
    ['Accepted', 'approved'],
    ['AutoAccepted', 'approved'],
    ['Refunded', 'refunded'],
    ['Resolved', 'refunded'],
    ['Rejected', 'rejected'],
    ['Created', 'pending'],
    [undefined, 'pending'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeTrendyolClaimStatus(input)).toBe(expected)
  })
})
