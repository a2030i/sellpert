import { describe, expect, it } from 'vitest'
import { calculateProductProfitability } from '../productProfitability'

describe('calculateProductProfitability', () => {
  it('deducts commission VAT and tax-inclusive shipping from the sale price', () => {
    const result = calculateProductProfitability({ salePrice:100, costPrice:50, commissionRate:10, shippingCostTaxInclusive:12 })
    expect(result.commissionValue).toBeCloseTo(11.5)
    expect(result.netReceived).toBeCloseTo(76.5)
    expect(result.netProfit).toBeCloseTo(26.5)
    expect(result.viability).toBe('profitable')
  })

  it('uses the minimum commission in the worst-case calculation', () => {
    const result = calculateProductProfitability({ salePrice:20, costPrice:10, commissionRate:3, minimumCommission:2, shippingCostTaxInclusive:8 })
    expect(result.commissionValue).toBeCloseTo(2.3)
    expect(result.netProfit).toBeCloseTo(-0.3)
    expect(result.viability).toBe('loss')
  })

  it('does not invent profitability when price or commission is missing', () => {
    const result = calculateProductProfitability({ salePrice:0, costPrice:10, commissionRate:null, shippingCostTaxInclusive:8 })
    expect(result.netReceived).toBeNull()
    expect(result.viability).toBe('missing')
  })

  it('estimates a percentage Sellpert commission on a successful order including shipping', () => {
    const result = calculateProductProfitability({ salePrice:100, costPrice:50, commissionRate:10, shippingCostTaxInclusive:12, sellpertFeeType:'percentage', sellpertFeeValue:2.5 })
    expect(result.sellpertCommissionValue).toBeCloseTo(2.8)
    expect(result.netReceived).toBeCloseTo(73.7)
    expect(result.netProfit).toBeCloseTo(23.7)
  })

  it('uses one fixed Sellpert order fee in the single-product worst-case estimate', () => {
    const fixed = calculateProductProfitability({ salePrice:100, costPrice:50, commissionRate:10, shippingCostTaxInclusive:12, sellpertFeeType:'fixed', sellpertFeeValue:4 })
    const none = calculateProductProfitability({ salePrice:100, costPrice:50, commissionRate:10, shippingCostTaxInclusive:12, sellpertFeeType:'none', sellpertFeeValue:0 })
    expect(fixed.sellpertCommissionValue).toBeCloseTo(4)
    expect(fixed.netReceived).toBeCloseTo(72.5)
    expect(none.sellpertCommissionValue).toBe(0)
    expect(none.netReceived).toBeCloseTo(76.5)
  })
})
