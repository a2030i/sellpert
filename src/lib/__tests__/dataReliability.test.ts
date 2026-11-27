import { describe, expect, it, vi } from 'vitest'
import { fetchAllStrict, withTimeout } from '../db'
import { dateScope, formatRatio, orderIsPending, ratio } from '../dataScope'

vi.mock('../../components/Toast', () => ({ toastErr: vi.fn() }))
describe('complete datasets', () => {
  it('loads all pages, including a record beyond the API limit', async () => {
    const rows = Array.from({ length: 3745 }, (_, id) => ({ id }))
    const build = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }))
    expect(await fetchAllStrict(build)).toEqual(rows)
    expect(build).toHaveBeenCalledTimes(4)
  })
  it('rejects a partial second-page failure instead of returning misleading totals', async () => {
    await expect(fetchAllStrict(async from => from === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
      : { data: null, error: { message: 'Network failed' } })).rejects.toThrow()
  })
  it('distinguishes successful empty data from a failed first page', async () => {
    await expect(fetchAllStrict(async () => ({ data: [], error: null }))).resolves.toEqual([])
    await expect(fetchAllStrict(async () => ({ data: null, error: { message: 'denied' } }))).rejects.toThrow()
  })
  it('does not wait forever for a broken transport', async () => {
    vi.useFakeTimers()
    const result = withTimeout(new Promise(() => {}), 100)
    const assertion = expect(result).rejects.toThrow('انتهت مهلة')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    vi.useRealTimers()
  })
})
describe('metric contracts', () => {
  it('does not report zero CTR when impressions are zero', () => {
    expect(formatRatio(ratio(1016, 0), '%', 100)).toBe('غير قابل للحساب')
    expect(formatRatio(ratio(0, 1000), '%', 100)).toBe('0.00%')
    expect(formatRatio(ratio(196, 100), 'x')).toBe('1.96x')
  })
  it('shares the broad pending-status definition with drilldowns', () => {
    expect(['pending','processing','new','confirmed','ready_to_ship'].filter(status => orderIsPending({status}))).toHaveLength(5)
    expect(orderIsPending({status:'shipped'})).toBe(false)
  })
  it('keeps 90 calendar days and Riyadh midnight boundaries', () => {
    const scope = dateScope('90', null, null, new Date('2026-11-27T22:00:00Z'))!
    expect(scope[0].toISOString()).toBe('2026-08-30T21:00:00.000Z')
    expect(scope[1].toISOString()).toBe('2026-11-28T20:59:59.999Z')
    expect(dateScope('all')).toBeNull()
  })
})
