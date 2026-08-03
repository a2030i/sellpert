import { describe, expect, it } from 'vitest'
import { isStrongPassword, passwordChecks } from '../passwordPolicy'

describe('password policy', () => {
  it('requires length, a letter, and a number', () => {
    expect(isStrongPassword('short1')).toBe(false)
    expect(isStrongPassword('longpassword')).toBe(false)
    expect(isStrongPassword('1234567890')).toBe(false)
    expect(isStrongPassword('متجرآمن1234')).toBe(true)
  })

  it('returns each requirement for the recovery UI', () => {
    const checks = passwordChecks('SecureStore42')
    expect(checks).toHaveLength(3)
    expect(checks.every(check => check.passed)).toBe(true)
  })
})
