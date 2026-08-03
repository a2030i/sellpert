import { describe, expect, it } from 'vitest'
import { orderFinancialIssue, orderNeedsAction } from '../orderQuality'

describe('order financial quality', () => {
  it('flags fees that exceed the order total', () => {
    expect(orderFinancialIssue({ total_amount: 7, platform_fee: 18.35, unit_price: 7, quantity: 1 }))
      .toContain('رسوم المنصة أعلى')
  })

  it('flags a material line-total mismatch', () => {
    expect(orderFinancialIssue({ total_amount: 54, platform_fee: 6.21, unit_price: 26.99, quantity: 1 }))
      .toContain('لا يطابقان')
  })

  it('accepts small rounding differences', () => {
    expect(orderFinancialIssue({ total_amount: 54, platform_fee: 6.21, unit_price: 53.5, quantity: 1 }))
      .toBeNull()
  })
})

describe('order operational action', () => {
  it('requires action for open orders without tracking', () => {
    expect(orderNeedsAction({ status: 'pending', cargo_tracking_number: null })).toBe(true)
    expect(orderNeedsAction({ status: 'processing', cargo_tracking_number: '' })).toBe(true)
  })

  it('does not flag closed or tracked orders', () => {
    expect(orderNeedsAction({ status: 'delivered', cargo_tracking_number: null })).toBe(false)
    expect(orderNeedsAction({ status: 'processing', cargo_tracking_number: 'TRACK-1' })).toBe(false)
  })
})
