import { describe, expect, it } from 'vitest'
import { attentionTotals, buildAttentionItems, buildMarketplaceOperations, type AttentionCenterInput } from '../attentionCenter'

const empty: AttentionCenterInput = { orders: [], packages: [], questions: [], listings: [], actionLogs: [], products: [] }

describe('attention center', () => {
  it('turns operational exceptions into merchant actions with direct links', () => {
    const items = buildAttentionItems({
      ...empty,
      orders: [{ id: 'o1', order_id: 'T-10', status: 'processing', cargo_tracking_number: null, total_amount: 54, platform_fee: 6.21, unit_price: 54, quantity: 1, sku: 'SKU-1', order_date: '2026-08-04T09:00:00Z' }],
      packages: [{ order_id: 'T-10', status: 'Created', cargo_tracking_number: null, invoice_status: 'Rejected', invoice_rejected_reasons: ['invalid'], modified_at: '2026-08-04T10:00:00Z' }],
      questions: [{ status: 'WAITING_FOR_ANSWER', asked_at: '2026-08-04T08:00:00Z' }],
      listings: [{ product_id: 'p1', delivery_status: 'failed', delivery_error: 'provider error' }],
      actionLogs: [{ status: 'partial', action: 'update-product', target_type:'integration' }],
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

  it('routes marketplace operations to the affected product or order without exposing technical errors', () => {
    const input: AttentionCenterInput = {
      ...empty,
      packages: [{ order_id:'T-20', shipment_package_id:'PKG-20', status:'processing', cargo_tracking_number:'TRK-20' }],
      products: [{ id:'p20', sku:'SKU-20', barcode:'BAR-20', external_id:'20020', cost_price:20 }],
      actionLogs: [
        { id:'a1', status:'failed', action:'products.v2_update_content', error_message:'[object Object]', target_type:'product', target_id:'p20', started_at:'2026-08-04T10:00:00Z' },
        { id:'a2', status:'partial', action:'packages.tracking', target_type:'order', target_id:'T-20', started_at:'2026-08-04T11:00:00Z' },
      ],
    }

    const operations = buildMarketplaceOperations(input)
    expect(operations[0]).toMatchObject({ path:'/product-detail?id=p20', actionLabel:'فتح المنتج', tone:'failed' })
    expect(operations[0].error).not.toContain('[object Object]')
    expect(operations[1]).toMatchObject({ path:'/orders?order=T-20', actionLabel:'فتح الطلب', tone:'warning' })
  })

  it('does not count the same rejected product update twice', () => {
    const items = buildAttentionItems({
      ...empty,
      listings: [{ product_id:'p30', delivery_status:'failed', delivery_error:'rejected' }],
      products: [{ id:'p30', external_id:'30030', cost_price:10 }],
      actionLogs: [{ status:'failed', action:'products.v2_update_content', target_type:'product', target_id:'p30' }],
    })

    expect(items.find(item => item.id === 'rejected-listings')?.count).toBe(1)
    expect(items.some(item => item.id === 'failed-actions')).toBe(false)
  })

  it('keeps successful read-only polling out of the merchant operation history', () => {
    const operations = buildMarketplaceOperations({
      ...empty,
      actionLogs: [{ id:'poll-1', risk_level:'read', status:'success', action:'products.batch_result', target_type:'products' }],
    })

    expect(operations).toEqual([])
  })

  it('uses merchant-friendly labels and routes Trendyol returns to their workspace', () => {
    const operations = buildMarketplaceOperations({
      ...empty,
      actionLogs: [
        { id:'claim-1', risk_level:'write', status:'success', action:'claims.approve', target_type:'returns' },
        { id:'cancel-1', risk_level:'destructive', status:'accepted', action:'packages.cancel', target_type:'orders' },
      ],
    })

    expect(operations[0]).toMatchObject({ label:'قبول طلب مرتجع', path:'/statement?tab=returns', actionLabel:'فتح المرتجعات' })
    expect(operations[1].label).toBe('إلغاء بند من الطلب')
  })
})
