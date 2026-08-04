import { describe, expect, it } from 'vitest'
import { attentionTotals, buildAttentionItems, type AttentionCenterInput } from '../attentionCenter'

const empty: AttentionCenterInput = { orders: [], packages: [], questions: [], listings: [], actionLogs: [], products: [] }

describe('attention center', () => {
  it('turns operational exceptions into merchant actions with direct links', () => {
    const items = buildAttentionItems({
      ...empty,
      orders: [{ id: 'o1', order_id: 'T-10', status: 'processing', cargo_tracking_number: null, total_amount: 54, platform_fee: 6.21, unit_price: 54, quantity: 1, sku: 'SKU-1', order_date: '2026-08-04T09:00:00Z' }],
      packages: [{ order_id: 'T-10', status: 'Created', cargo_tracking_number: null, invoice_status: 'Rejected', invoice_rejected_reasons: ['invalid'], modified_at: '2026-08-04T10:00:00Z' }],
      questions: [{ status: 'WAITING_FOR_ANSWER', asked_at: '2026-08-04T08:00:00Z' }],
      listings: [{ product_id: 'p1', delivery_status: 'failed', delivery_error: 'provider error' }],
      actionLogs: [{ status: 'partial', action: 'update-product' }],
      products: [{ sku: 'SKU-1', cost_price: 20 }],
    })

    expect(items.map(item => item.id)).toEqual(expect.arrayContaining([
      'invoice-rejected', 'packages-without-tracking', 'customer-questions', 'rejected-listings', 'failed-actions',
    ]))
    expect(items.find(item => item.id === 'invoice-rejected')?.path).toBe('/orders?order=T-10')
    expect(items.some(item => item.id === 'orders-without-shipment')).toBe(false)
  })

  it('flags delivered units when their final profit cannot be calculated', () => {
    const items = buildAttentionItems({
      ...empty,
      orders: [{ id: 'o1', order_id: 'T-11', status: 'delivered', total_amount: 100, platform_fee: 10, unit_price: 50, quantity: 2, sku: 'UNKNOWN', order_date: '2026-08-03T09:00:00Z' }],
    })

    expect(items.find(item => item.id === 'missing-product-costs')?.count).toBe(1)
  })

  it('counts open orders with missing costs and summarizes priorities', () => {
    const items = buildAttentionItems({
      ...empty,
      orders: [{ id: 'o1', order_id: 'T-12', status: 'processing', total_amount: 100, platform_fee: 10, unit_price: 50, quantity: 2, sku: 'UNKNOWN', order_date: '2026-08-03T09:00:00Z' }],
    })

    expect(items.find(item => item.id === 'missing-product-costs')?.description).toContain('2 وحدة')
    expect(attentionTotals(items).total).toBeGreaterThanOrEqual(2)
  })
})
