import { describe, expect, it } from 'vitest'
import { buildMerchantOpportunities } from '../merchantOpportunities'

describe('buildMerchantOpportunities', () => {
  it('blocks reliable profitability when cost coverage is below eighty percent', () => {
    const result = buildMerchantOpportunities({
      profitability: [
        { cost_price: 10, units_sold: 2, net_profit: 5, returns_amount: 0 },
        { cost_price: 0, units_sold: 1, net_profit: 5, returns_amount: 0 },
      ], inventory: [], ads: [],
    })
    expect(result[0]).toMatchObject({ sourceKey: 'cost_coverage', priority: 'urgent', confidence: 'high' })
    expect(result[0].value).toBeUndefined()
  })

  it('only calls losses fully costed when purchase cost is present', () => {
    const result = buildMerchantOpportunities({
      profitability: [
        { cost_price: 20, units_sold: 3, net_profit: -35.25, returns_amount: 0 },
        { cost_price: 0, units_sold: 3, net_profit: -80, returns_amount: 0 },
      ], inventory: [], ads: [],
    })
    const loss = result.find(item => item.sourceKey === 'confirmed_costed_product_losses')
    expect(loss?.value).toBe(35.25)
    expect(loss?.title).toContain(': 1')
  })

  it('does not present stale stockout history as a current replenishment opportunity', () => {
    const result = buildMerchantOpportunities({
      profitability: [], ads: [],
      inventory: [{ health_status: 'out_of_stock', daily_velocity: 2, sold_30d: 20, data_age_days: 5 }],
    })
    expect(result.some(item => item.sourceKey === 'inventory_data_stale')).toBe(true)
    expect(result.some(item => item.sourceKey === 'stockout_with_recent_demand')).toBe(false)
  })

  it('labels stockout value as historical units rather than guaranteed money', () => {
    const result = buildMerchantOpportunities({
      profitability: [], ads: [],
      inventory: [
        { health_status: 'out_of_stock', daily_velocity: 1, sold_30d: 9, data_age_days: 1 },
        { health_status: 'out_of_stock', daily_velocity: 1, sold_30d: 6, data_age_days: 0 },
      ],
    })
    const opportunity = result.find(item => item.sourceKey === 'stockout_with_recent_demand')
    expect(opportunity).toMatchObject({ value: 15, valueUnit: 'units', confidence: 'medium' })
    expect(opportunity?.detail).toContain('ليست مبيعات مضمونة')
  })

  it('calculates the advertising gap without calling it product profit', () => {
    const result = buildMerchantOpportunities({
      profitability: [], inventory: [],
      ads: [{ platform: 'trendyol', total_spend: 500, total_net: 320, net_roas: 0.64 }],
    })
    const opportunity = result.find(item => item.kind === 'marketing')
    expect(opportunity).toMatchObject({ value: 180, valueLabel: 'فجوة الإنفاق والإيراد', confidence: 'medium' })
    expect(opportunity?.detail).toContain('قبل احتساب تكلفة المنتج')
  })

  it('sorts urgent evidence before monetary size and caps the list', () => {
    const result = buildMerchantOpportunities({
      profitability: [
        { cost_price: 10, units_sold: 1, net_profit: -5, returns_amount: 0 },
        { cost_price: 0, units_sold: 1, net_profit: 2, returns_amount: 0 },
      ],
      inventory: [{ health_status: 'out_of_stock', daily_velocity: 0, sold_30d: 0, data_age_days: 0 }],
      ads: [{ platform: 'x', total_spend: 1000, total_net: 0, net_roas: 0 }],
      latestCash: { month: '2026-08-01', net: -900 },
    })
    expect(result).toHaveLength(5)
    expect(result[0].priority).toBe('urgent')
    expect(result[1].priority).toBe('urgent')
  })
})
