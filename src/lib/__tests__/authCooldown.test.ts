import { describe, expect, it } from 'vitest'
import { authCooldownRemaining, startAuthCooldown } from '../authCooldown'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('authentication action cooldown', () => {
  it('prevents accidental repeated registration submissions for one minute', () => {
    const storage = memoryStorage()
    startAuthCooldown(storage, 'register', 10_000)
    expect(authCooldownRemaining(storage, 'register', 10_000)).toBe(60)
    expect(authCooldownRemaining(storage, 'register', 69_100)).toBe(1)
    expect(authCooldownRemaining(storage, 'register', 70_000)).toBe(0)
  })

  it('keeps registration and recovery limits independent', () => {
    const storage = memoryStorage()
    startAuthCooldown(storage, 'recover', 5_000)
    expect(authCooldownRemaining(storage, 'recover', 5_000)).toBe(60)
    expect(authCooldownRemaining(storage, 'register', 5_000)).toBe(0)
    expect(authCooldownRemaining(storage, 'resend', 5_000)).toBe(0)
  })

  it('rate limits verification email resends independently', () => {
    const storage = memoryStorage()
    startAuthCooldown(storage, 'resend', 20_000)
    expect(authCooldownRemaining(storage, 'resend', 20_000)).toBe(60)
    expect(authCooldownRemaining(storage, 'register', 20_000)).toBe(0)
  })
})
