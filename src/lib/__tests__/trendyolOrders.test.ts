import { describe, expect, it } from 'vitest'
import {
  mapTrendyolOrderStatus,
  mergeTrendyolShipment,
  trendyolLineFinancials,
  trendyolPackageId,
} from '../../../supabase/functions/_shared/trendyolOrders'

describe('Trendyol order mapping', () => {
  it('uses the documented package id and net package totals', () => {
    const orders = new Map<string, any>()
    mergeTrendyolShipment(orders, {
      id: 999,
      shipmentPackageId: 333,
      orderNumber: 'ORDER-1',
      packageGrossAmount: 200,
      packageTotalDiscount: 20,
      packageTotalPrice: 180,
      currencyCode: 'SAR',
      status: 'Created',
      orderDate: 1_767_000_000_000,
      lines: [{ quantity: 2, lineGrossAmount: 100, lineTotalDiscount: 10, lineUnitPrice: 90, commission: 10, vatRate: 15, stockCode: 'SKU-1' }],
    }, 'merchant-a', '2026-08-03T00:00:00.000Z')

    const order = orders.get('ORDER-1')
    expect(trendyolPackageId({ id: 999, shipmentPackageId: 333 })).toBe('333')
    expect(order).toMatchObject({
      shipment_package_id: '333',
      total_amount: 180,
      gross_amount: 200,
      discount_amount: 20,
      quantity: 2,
      unit_price: 90,
      commission_rate: 10,
      vat_rate: 15,
      currency: 'SAR',
    })
    expect(order.platform_fee).toBeCloseTo(20.7)
  })

  it('multiplies documented unit amounts by quantity', () => {
    expect(trendyolLineFinancials({
      quantity: 3,
      lineGrossAmount: 60,
      lineTotalDiscount: 6,
      lineUnitPrice: 54,
      commission: 10,
      vatRate: 15,
    })).toEqual({
      quantity: 3,
      unitPrice: 54,
      grossUnitPrice: 60,
      discountUnitAmount: 6,
      lineTotal: 162,
      grossTotal: 180,
      discountTotal: 18,
      commissionRate: 10,
      commissionAmount: 18.63,
      vatRate: 15,
    })
  })

  it('keeps a split order actionable while any package is open', () => {
    const orders = new Map<string, any>()
    mergeTrendyolShipment(orders, {
      shipmentPackageId: 1, orderNumber: 'SPLIT-1', packageTotalPrice: 100,
      status: 'Delivered', lines: [{ quantity: 1, lineUnitPrice: 100 }],
    }, 'merchant-a')
    mergeTrendyolShipment(orders, {
      shipmentPackageId: 2, orderNumber: 'SPLIT-1', packageTotalPrice: 50,
      status: 'Picking', lines: [{ quantity: 1, lineUnitPrice: 50 }],
    }, 'merchant-a')

    expect(orders.get('SPLIT-1')).toMatchObject({ status: 'processing', total_amount: 150, quantity: 2 })
    expect(mapTrendyolOrderStatus('AtCollectionPoint')).toBe('shipped')
    expect(mapTrendyolOrderStatus('UnSupplied')).toBe('cancelled')
  })
})
