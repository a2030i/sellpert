import { describe, expect, it } from 'vitest'
import { calculateOrderProfit, orderContributionBeforeProductCost } from '../orderProfit'

describe('order profit', () => {
  it('calculates the order net only when every line has a known cost', () => {
    const result = calculateOrderProfit(
      { total_amount: 100, gross_amount: 103, platform_fee: 11.5, shipping_cost: 5, discount_amount: 3, quantity: 2, sku: 'A' },
      [{ sku: 'A', quantity: 2 }], new Map([['sku:a', 20]]), 11.5,
    )
    expect(result).toMatchObject({ revenue: 103, discounts: 3, productCost: 40, missingCostUnits: 0, costComplete: true, netProfit: 43.5, usesGrossAmount: true })
  })

  it('does not subtract a discount twice when total amount is already net', () => {
    const result = calculateOrderProfit(
      { total_amount: 100, platform_fee: 10, discount_amount: 8, quantity: 1, sku: 'A' },
      [], new Map([['sku:a', 40]]),
    )
    expect(result).toMatchObject({ revenue: 100, discounts: 0, netProfit: 50, usesGrossAmount: false })
  })

  it('keeps order contribution based on the net marketplace total', () => {
    expect(orderContributionBeforeProductCost({ total_amount: 100, platform_fee: 10, shipping_cost: 5 })).toBe(85)
  })

  it('withholds the net when one line has no cost', () => {
    const result = calculateOrderProfit(
      { total_amount: 100, quantity: 2 },
      [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }], new Map([['sku:a', 20]]),
    )
    expect(result).toMatchObject({ productCost: 20, missingCostUnits: 1, costComplete: false, netProfit: null })
  })
})
