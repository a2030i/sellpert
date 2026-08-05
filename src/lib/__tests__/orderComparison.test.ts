import { describe, expect, it } from 'vitest'
import type { Order } from '../supabase'
import { buildOrderPlatformComparison } from '../orderComparison'

function order(overrides: Partial<Order>): Order {
  return {
    id: crypto.randomUUID(),
    merchant_code: 'M-TEST',
    platform: 'trendyol',
    order_id: crypto.randomUUID(),
    status: 'delivered',
    quantity: 1,
    unit_price: 100,
    total_amount: 100,
    currency: 'SAR',
    order_date: '2026-08-05T10:00:00Z',
    created_at: '2026-08-05T10:00:00Z',
    ...overrides,
  }
}

describe('order platform comparison', () => {
  it('uses canonical order rows for revenue, counts and rates', () => {
    const result = buildOrderPlatformComparison([
      order({ platform: 'trendyol', total_amount: 100, status: 'delivered' }),
      order({ platform: 'trendyol', total_amount: 50, status: 'cancelled' }),
      order({ platform: 'amazon', total_amount: 300, status: 'returned' }),
    ])

    expect(result).toEqual([
      expect.objectContaining({ platform: 'amazon', revenue: 300, count: 1, returnRate: '100.0', averageOrderValue: 300 }),
      expect.objectContaining({ platform: 'trendyol', revenue: 150, count: 2, deliveryRate: '50.0', cancelRate: '50.0', averageOrderValue: 75 }),
    ])
  })

  it('never invents a platform when no canonical order exists for it', () => {
    expect(buildOrderPlatformComparison([
      order({ platform: 'amazon', total_amount: 80 }),
    ]).map(row => row.platform)).toEqual(['amazon'])
  })
})
