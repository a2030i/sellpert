import { describe, expect, it } from 'vitest'
import { actionDestination, normalizeActionEffectiveness } from '../merchantActions'

describe('action effectiveness analytics', () => {
  it('normalizes the database response without trusting malformed values', () => {
    const result = normalizeActionEffectiveness({
      period_days: 90,
      generated_at: '2026-08-04T12:00:00Z',
      open: { total: 4, in_progress: 2, urgent: 1, overdue: 1, due_next_7_days: 2 },
      completed: {
        total: 3, achieved: 1, partial: 1, not_achieved: 1, unmeasured: 0,
        measured: 3, achieved_rate_pct: '33.3', positive_rate_pct: 66.7,
        average_cycle_days: '2.5',
      },
      categories: [
        { category: 'inventory', completed: 2, achieved: 1, partial: 1, not_achieved: 0, achieved_rate_pct: 50 },
        { category: '', completed: 100 },
      ],
      weeks: [
        { week_start: '2026-08-03', completed: 2, achieved: 1, partial: 1, not_achieved: 0 },
        { week_start: 'not-a-date', completed: 999 },
      ],
    })

    expect(result?.completed.achieved_rate_pct).toBe(33.3)
    expect(result?.completed.average_cycle_days).toBe(2.5)
    expect(result?.categories).toHaveLength(1)
    expect(result?.weeks).toHaveLength(1)
  })

  it('rejects invalid payloads', () => {
    expect(normalizeActionEffectiveness(null)).toBeNull()
    expect(normalizeActionEffectiveness([])).toBeNull()
  })
})

describe('action destination', () => {
  it('allows only known in-app execution destinations', () => {
    expect(actionDestination({ destination: '/inventory?status=out_of_stock' })).toBe('/inventory?status=out_of_stock')
    expect(actionDestination({ destination: '/products?profit=loss' })).toBe('/products?profit=loss')
    expect(actionDestination({ destination: 'https://attacker.invalid' })).toBeNull()
    expect(actionDestination({ destination: '/admin' })).toBeNull()
    expect(actionDestination({ destination: 'javascript:alert(1)' })).toBeNull()
  })
})
