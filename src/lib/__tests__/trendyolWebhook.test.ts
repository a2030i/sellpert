import { describe, expect, it } from 'vitest'
import {
  commissionFromLines,
  mapTrendyolOrderStatus,
  numberOrNull,
  validIso,
} from '../../../supabase/functions/_shared/trendyolWebhook'

describe('Trendyol webhook normalization', () => {
  it('does not invent zeroes when a status-only event omits finance fields', () => {
    expect(numberOrNull(undefined)).toBeNull()
    expect(numberOrNull('')).toBeNull()
    expect(commissionFromLines([])).toBeNull()
  })

  it('calculates VAT-inclusive commission to halala precision', () => {
    expect(commissionFromLines([
      { price: 54, commissionRate: 10 },
      { unitPrice: 20, quantity: 2, commission_rate: 8 },
    ])).toBe(9.89)
  })

  it('preserves the current status when Trendyol sends an unknown state', () => {
    expect(mapTrendyolOrderStatus('FutureStatus', 'shipped')).toBe('shipped')
    expect(mapTrendyolOrderStatus('Delivered', 'pending')).toBe('delivered')
  })

  it('accepts valid dates and rejects malformed dates', () => {
    expect(validIso('2026-06-23T10:00:00Z')).toBe('2026-06-23T10:00:00.000Z')
    expect(validIso('not-a-date')).toBeNull()
  })
})
