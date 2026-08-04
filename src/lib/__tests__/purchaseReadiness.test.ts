import { describe, expect, it } from 'vitest'
import { normalizePurchaseReadiness } from '../purchaseReadiness'

describe('purchase cash readiness', () => {
  it('normalizes monetary database values and preserves the cash boundary', () => {
    const result = normalizePurchaseReadiness({
      horizon_days: 30,
      status: 'shortfall',
      confidence: 'high',
      bank: { balance: '100', balance_date: '2026-08-05', age_days: 0, is_fresh: true, currency: 'SAR' },
      payouts: { confirmed_total: '50.25', count: 1, rows: [{ platform: 'trendyol', payout_date: '2026-08-10', amount: '50.25', source: 'api_confirmed' }] },
      purchase_plan: { item_count: 1, unit_count: 5, estimated_cost: '200', top_items: [{ inventory_id: '1', sku: 'A', recommended_quantity: '5', estimated_cost: '200' }] },
      readiness: { available_before_purchase: '150.25', cash_after_purchase: '-49.75', funding_gap: '49.75', coverage_pct: '75.1' },
      data_quality: { missing_cost_count: 0, stale_inventory_count: 0 },
      unconfirmed_sales: { gross_total: '9000', included_in_available_cash: true },
    })

    expect(result.bank.balance).toBe(100)
    expect(result.payouts.confirmed_total).toBe(50.25)
    expect(result.readiness.funding_gap).toBe(49.75)
    expect(result.unconfirmed_sales.included_in_available_cash).toBe(false)
  })

  it('rejects empty and non-object responses', () => {
    expect(() => normalizePurchaseReadiness(null)).toThrow('INVALID_PURCHASE_READINESS')
    expect(() => normalizePurchaseReadiness([])).toThrow('INVALID_PURCHASE_READINESS')
    expect(() => normalizePurchaseReadiness('bad')).toThrow('INVALID_PURCHASE_READINESS')
  })
})
