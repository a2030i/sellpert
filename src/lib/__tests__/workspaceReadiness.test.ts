import { describe, expect, it } from 'vitest'
import { workspaceReadiness } from '../workspaceReadiness'

describe('workspaceReadiness', () => {
  it('starts with only the isolated workspace complete', () => {
    const result = workspaceReadiness({ sourceReady: false, orderCount: 0, productCount: 0, costedProductCount: 0 })
    expect(result.percentage).toBe(25)
    expect(result.nextStep?.key).toBe('source')
    expect(result.ready).toBe(false)
  })

  it('keeps the order step incomplete until commerce data arrives', () => {
    const result = workspaceReadiness({ sourceReady: true, orderCount: 0, productCount: 0, costedProductCount: 0 })
    expect(result.completed).toBe(2)
    expect(result.nextStep?.key).toBe('orders')
  })

  it('requires eighty percent product-cost coverage for reliable profitability', () => {
    expect(workspaceReadiness({ sourceReady: true, orderCount: 10, productCount: 10, costedProductCount: 7 }).ready).toBe(false)
    const ready = workspaceReadiness({ sourceReady: true, orderCount: 10, productCount: 10, costedProductCount: 8 })
    expect(ready.ready).toBe(true)
    expect(ready.percentage).toBe(100)
  })

  it('clamps invalid counts instead of overstating completion', () => {
    const result = workspaceReadiness({ sourceReady: true, orderCount: -5, productCount: 2, costedProductCount: 9 })
    expect(result.steps.find(step => step.key === 'orders')?.complete).toBe(false)
    expect(result.steps.find(step => step.key === 'costs')?.complete).toBe(true)
  })
})
