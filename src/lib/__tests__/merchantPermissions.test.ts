import { describe, expect, it } from 'vitest'
import { hasMerchantPermission } from '../merchantPermissions'
import type { Merchant } from '../supabase'

const base = {
  id: '1', merchant_code: 'M-1', name: 'Store', email: 'store@example.com',
  currency: 'SAR', created_at: '2026-01-01T00:00:00Z',
} as Merchant

describe('merchant employee permissions', () => {
  it('gives the merchant owner full store access', () => {
    expect(hasMerchantPermission({ ...base, role: 'merchant' }, 'settings')).toBe(true)
  })

  it('honors object permissions without treating false keys as enabled', () => {
    const employee = {
      ...base,
      role: 'employee' as const,
      permissions: { orders: true, statement: false },
    }
    expect(hasMerchantPermission(employee, 'orders')).toBe(true)
    expect(hasMerchantPermission(employee, 'statement')).toBe(false)
  })

  it('denies every permission for a suspended employee', () => {
    const employee = {
      ...base,
      role: 'employee' as const,
      is_active: false,
      permissions: { orders: true },
    }
    expect(hasMerchantPermission(employee, 'orders')).toBe(false)
  })
})
