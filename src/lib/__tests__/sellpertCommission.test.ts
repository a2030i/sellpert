import { describe, expect, it } from 'vitest'
import {
  calculateSellpertOrderCommission,
  summarizeSellpertCommission,
} from '../sellpertCommission'

describe('Sellpert order commission', () => {
  it('charges delivered orders only and reverses cancelled or returned orders', () => {
    const contract = { sellpert_fee_type:'percentage' as const, sellpert_fee_value:5 }
    expect(calculateSellpertOrderCommission({ status:'delivered', total_amount:100 }, contract)).toBe(5)
    expect(calculateSellpertOrderCommission({ status:'cancelled', total_amount:100 }, contract)).toBe(0)
    expect(calculateSellpertOrderCommission({ status:'returned', total_amount:100 }, contract)).toBe(0)
    expect(calculateSellpertOrderCommission({ status:'shipped', total_amount:100 }, contract)).toBe(0)
  })

  it('charges a fixed amount once when one order contains multiple products', () => {
    const result = summarizeSellpertCommission([
      { merchant_code:'M-1', platform:'amazon', order_id:'A-1', status:'delivered', total_amount:40 },
      { merchant_code:'M-1', platform:'amazon', order_id:'A-1', status:'delivered', total_amount:60 },
    ], { sellpert_fee_type:'fixed', sellpert_fee_value:10 })

    expect(result.eligibleOrders).toBe(1)
    expect(result.commissionableSales).toBe(100)
    expect(result.commission).toBe(10)
  })

  it('calculates percentage commission from sales including customer shipping', () => {
    const result = summarizeSellpertCommission([
      { merchant_code:'M-1', platform:'noon', order_id:'N-1', status:'delivered', total_amount:100, customer_shipping_amount:15 },
      { merchant_code:'M-1', platform:'noon', order_id:'N-2', status:'returned', total_amount:200, customer_shipping_amount:20 },
    ], { sellpert_fee_type:'percentage', sellpert_fee_value:10 })

    expect(result.eligibleOrders).toBe(1)
    expect(result.commissionableSales).toBe(115)
    expect(result.commission).toBe(11.5)
    expect(result.byPlatform.noon).toBe(11.5)
  })
})
