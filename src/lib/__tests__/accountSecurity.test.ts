import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CODE_PATTERN,
  generateAccountCode,
  isStrongAccountPassword,
  normalizeEmail,
  normalizeMerchantPermissions,
  normalizeName,
} from '../../../supabase/functions/_shared/accountSecurity'

describe('account provisioning security', () => {
  it('generates scalable, prefixed account identifiers', () => {
    const values = new Set(Array.from({ length: 2_000 }, () => generateAccountCode('M')))
    expect(values.size).toBe(2_000)
    for (const value of values) expect(value).toMatch(ACCOUNT_CODE_PATTERN)
  })

  it('uses the same strong password contract as self-registration', () => {
    expect(isStrongAccountPassword('short1')).toBe(false)
    expect(isStrongAccountPassword('longpassword')).toBe(false)
    expect(isStrongAccountPassword('1234567890')).toBe(false)
    expect(isStrongAccountPassword('Secure12345')).toBe(true)
    expect(isStrongAccountPassword('آمنة1234567')).toBe(true)
  })

  it('normalizes identity fields and rejects malformed values', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeName('  متجر موثوق  ')).toBe('متجر موثوق')
    expect(normalizeName('x')).toBeNull()
  })

  it('accepts only known boolean merchant permissions', () => {
    const defaults = { dashboard: true, orders: false }
    expect(normalizeMerchantPermissions({ orders: true }, defaults)).toEqual({
      dashboard: true,
      orders: true,
    })
    expect(normalizeMerchantPermissions({ team: true }, defaults)).toBeNull()
    expect(normalizeMerchantPermissions({ orders: 'yes' }, defaults)).toBeNull()
  })
})
