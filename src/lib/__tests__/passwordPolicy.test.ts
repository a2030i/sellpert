import { describe, expect, it } from 'vitest'
import { isStrongPassword, passwordChecks } from '../passwordPolicy'

describe('password policy', () => {
  it('requires bounded length, a letter, a number, and a symbol', () => {
    expect(isStrongPassword('short1')).toBe(false)
    expect(isStrongPassword('longpassword')).toBe(false)
    expect(isStrongPassword('1234567890')).toBe(false)
    expect(isStrongPassword('password123')).toBe(false)
    expect(isStrongPassword('SecureStore42')).toBe(false)
    expect(isStrongPassword('SecureStore42!')).toBe(true)
    expect(isStrongPassword('متجر-آمن-1234!')).toBe(true)
    expect(isStrongPassword(`A1!${'x'.repeat(126)}`)).toBe(false)
  })

  it('returns each requirement for the recovery UI', () => {
    const checks = passwordChecks('SecureStore42!')
    expect(checks).toHaveLength(5)
    expect(checks.every(check => check.passed)).toBe(true)
  })

  it('rejects common marketplace and administrative passwords', () => {
    expect(isStrongPassword('Sellpert123!')).toBe(false)
    expect(isStrongPassword('Trendyol123!')).toBe(false)
    expect(isStrongPassword('Admin123456!')).toBe(false)
  })
})
