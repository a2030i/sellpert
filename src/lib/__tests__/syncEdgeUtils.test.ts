import { describe, expect, it } from 'vitest'
import { numberValue, parseSyncRange, permissionEnabled, splitRange } from '../../../supabase/functions/_shared/sync'

describe('Edge sync utilities', () => {
  it('splits long date ranges below the platform maximum', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const to = new Date('2026-02-15T00:00:00.000Z')
    const windows = splitRange(from, to, 13)

    expect(windows.length).toBe(4)
    for (const window of windows) {
      expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(13 * 86_400_000)
    }
    expect(windows[0].from.toISOString()).toBe(from.toISOString())
    expect(windows[windows.length - 1]?.to.toISOString()).toBe(to.toISOString())
  })

  it('rejects inverted sync ranges', () => {
    expect(() => parseSyncRange({
      date_from: '2026-06-02T00:00:00.000Z',
      date_to: '2026-06-01T00:00:00.000Z',
    })).toThrow('date_from must be before date_to')
  })

  it('normalizes invalid numeric API values safely', () => {
    expect(numberValue('12.50')).toBe(12.5)
    expect(numberValue('not-a-number')).toBe(0)
    expect(numberValue(null)).toBe(0)
  })

  it('does not enable false object permissions', () => {
    expect(permissionEnabled({ integrations: true }, 'integrations')).toBe(true)
    expect(permissionEnabled({ integrations: false }, 'integrations')).toBe(false)
    expect(permissionEnabled(['integrations'], 'integrations')).toBe(true)
  })
})
