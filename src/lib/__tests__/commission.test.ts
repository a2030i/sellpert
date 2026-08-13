import { describe, expect, it } from 'vitest'
import { categoryCommission, commissionAmount, normalizeFeeCategory } from '../commission'

describe('category commissions', () => {
  it('normalizes food and spice catalogue categories to grocery', () => {
    expect(normalizeFeeCategory('food_beverage')).toBe('grocery')
    expect(normalizeFeeCategory('توابل أخرى')).toBe('grocery')
  })

  it('uses the platform category rate instead of a fixed platform percentage', () => {
    const result = categoryCommission([{ platform: 'noon', category_key: 'grocery', commission_rate: 5 }], 'noon', 'توابل أخرى')
    expect(result?.rate).toBe(5)
  })

  it('maps shared catalogue categories to the platform taxonomy', () => {
    const result = categoryCommission([{ platform: 'amazon', category_key: 'computers', commission_rate: 6 }], 'amazon', 'laptops')
    expect(result?.rate).toBe(6)
  })

  it('adds VAT to the commission itself, not to the commission percentage', () => {
    expect(commissionAmount(100, 10, 15)).toBeCloseTo(11.5)
  })
})
