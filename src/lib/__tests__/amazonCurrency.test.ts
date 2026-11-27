import { describe, expect, it, vi } from 'vitest'
import { AMAZON_MARKETPLACES } from '../../../supabase/functions/_shared/amazonSpApi'
import { AMAZON_SAUDI_MARKETPLACE, assertAmazonSarAmounts, selectAmazonSyncMarkets } from '../../../supabase/functions/_shared/amazonCurrency'
import { financePage, ordersPage } from '../../../supabase/functions/_shared/amazonSync'
import { persistAmazonPage, recomputeAmazonOrderFees } from '../../../supabase/functions/_shared/amazonSyncStorage'

const order = {
  orderId: 'SYNTHETIC-ORDER', createdTime: '2026-11-27T08:00:00Z', orderItems: [{
    orderItemId: 'SYNTHETIC-ITEM', quantityOrdered: 1, product: { title: 'Test' },
  }],
}
const transaction = { transactionId: 'SYNTHETIC-TX', postedDate: '2026-11-27T08:00:00Z', totalAmount: { currencyCode: 'SAR', currencyAmount: 100 } }

describe('Amazon Saudi financial scope', () => {
  it('uses the existing Saudi marketplace ID and warns when excluding other connected markets', () => {
    expect(AMAZON_MARKETPLACES[AMAZON_SAUDI_MARKETPLACE].country).toBe('SA')
    expect(selectAmazonSyncMarkets([{ id: AMAZON_SAUDI_MARKETPLACE }]))
      .toEqual({ marketplaceIds: [AMAZON_SAUDI_MARKETPLACE], warning: null })
    expect(selectAmazonSyncMarkets([{ id: 'A2VIGQ35RCS4UG' }, { id: AMAZON_SAUDI_MARKETPLACE }, { id: 'ARBP9OOSHTCHU' }]))
      .toEqual({ marketplaceIds: [AMAZON_SAUDI_MARKETPLACE], warning: expect.stringContaining('السعودية فقط') })
  })

  it.each([{ markets: [] }, { markets: [{ id: 'A2VIGQ35RCS4UG' }] }, { markets: [{ id: 'ARBP9OOSHTCHU' }] }])('rejects accounts without Saudi participation: $markets', ({ markets }) => {
    expect(() => selectAmazonSyncMarkets(markets)).toThrow('أمازون السعودية')
  })

  it('accepts pending orders with genuinely missing monetary fields', () => {
    expect(ordersPage({ orders: [order] }).orders).toEqual([order])
    expect(() => assertAmazonSarAmounts({ currency: 'SAR', raw: order })).not.toThrow()
  })

  it.each(['AED', 'EGP', 'USD'])('rejects %s order totals before mapping', currencyCode => {
    expect(() => ordersPage({ orders: [{ ...order, proceeds: { grandTotal: { amount: '100', currencyCode } } }] }))
      .toThrow('عملة غير الريال السعودي')
  })

  it('rejects an item price in foreign currency even when the order total is SAR', () => {
    const foreignItem = { ...order.orderItems[0], product: { price: { unitPrice: { amount: '100', currencyCode: 'AED' } } } }
    expect(() => ordersPage({ orders: [{ ...order, proceeds: { grandTotal: { amount: '100', currencyCode: 'SAR' } }, orderItems: [foreignItem] }] }))
      .toThrow('عملة غير الريال السعودي')
  })

  it('rejects native foreign finance totals and nested fees despite a SAR transaction total', () => {
    expect(() => financePage({ payload: { transactions: [{ ...transaction, totalAmount: { currencyCode: 'EGP', currencyAmount: 100 } }] } }))
      .toThrow('عملة غير الريال السعودي')
    expect(() => financePage({ payload: { transactions: [{ ...transaction, breakdowns: [{ breakdownType: 'AmazonFees', breakdownAmount: { currencyCode: 'AED', currencyAmount: -10 } }] }] } }))
      .toThrow('عملة غير الريال السعودي')
  })

  it('rejects the entire mapped page before any writes or checkpoint when its final row is foreign', async () => {
    const from = vi.fn()
    const checkpoint = vi.fn()
    await expect(persistAmazonPage({ from }, 'M-TEST', {
      orders: [{ currency: 'SAR', order_id: 'O1' }],
      transactions: [{ currency: 'AED', transaction_no: 'T1', order_id: 'O1' }],
    }, checkpoint)).rejects.toMatchObject({ status: 502 })
    expect(from).not.toHaveBeenCalled()
    expect(checkpoint).not.toHaveBeenCalled()
  })

  it('fails closed before overwriting order fees if stored raw transactions contain a foreign currency', async () => {
    let writes = 0
    const admin = { from: () => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        range: async () => ({ data: [{ raw: { ...transaction, totalAmount: { currencyCode: 'AED', currencyAmount: 100 } } }], error: null }),
        update: () => { writes++; return q },
      }
      return q
    } }
    await expect(recomputeAmazonOrderFees(admin, 'M-TEST', ['O1'])).rejects.toMatchObject({ status: 502 })
    expect(writes).toBe(0)
  })
})
