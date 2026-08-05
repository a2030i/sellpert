import { describe, expect, it } from 'vitest'
import { buildFinancialSummary } from '../financialSummary'

describe('financial summary', () => {
  it('does not claim net profit when a platform summary exceeds detailed orders', () => {
    const result = buildFinancialSummary({
      performanceRows: [
        { total_sales: 65, order_count: 2, platform_fees: 8.97, ad_spend: 835.48 },
        { total_sales: 4785, order_count: 165, platform_fees: 0, ad_spend: 0 },
      ],
      returnRows: [],
      detailedRevenue: 65,
      detailedOrders: 2,
      knownCogs: 20,
      costedUnits: 2,
      missingCostUnits: 0,
    })

    expect(result.grossRevenue).toBe(4850)
    expect(result.detailCoverage).toBeCloseTo(1.34, 2)
    expect(result.source).toBe('mixed')
    expect(result.profitComplete).toBe(false)
    expect(result.estimatedProfit).toBeNull()
    expect(result.provisionalNetAfterKnownCosts).toBeCloseTo(3985.55, 2)
  })

  it('calculates profit only when sales details and product costs are complete', () => {
    const result = buildFinancialSummary({
      performanceRows: [{ total_sales: '1000', order_count: 10, platform_fees: '100', ad_spend: 50 }],
      returnRows: [{ return_amount: 25 }],
      detailedRevenue: 1000,
      detailedOrders: 10,
      knownCogs: 400,
      costedUnits: 10,
      missingCostUnits: 0,
    })

    expect(result.source).toBe('detailed_orders')
    expect(result.netBeforeProductCost).toBe(825)
    expect(result.provisionalNetAfterKnownCosts).toBe(425)
    expect(result.estimatedProfit).toBe(425)
    expect(result.margin).toBe(42.5)
  })

  it('tolerates minor currency rounding while rejecting missing product costs', () => {
    const result = buildFinancialSummary({
      performanceRows: [{ total_sales: 100, order_count: 1 }],
      returnRows: [],
      detailedRevenue: 99.96,
      detailedOrders: 1,
      knownCogs: 0,
      costedUnits: 0,
      missingCostUnits: 1,
    })

    expect(result.salesDetailsComplete).toBe(true)
    expect(result.productCostsComplete).toBe(false)
    expect(result.estimatedProfit).toBeNull()
  })
})
