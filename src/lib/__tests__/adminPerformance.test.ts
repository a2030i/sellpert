import { describe, expect, it } from 'vitest'
import type { PerformanceData } from '../supabase'
import { filterPerformanceRows, performanceDateKey, summarizePerformance } from '../adminPerformance'

function row(id: string, dataDate: string, sales = 100, volume = 2): PerformanceData {
  return {
    id, merchant_code: 'M-TEST', platform: 'amazon', data_date: dataDate,
    created_at: '2026-08-02T12:00:00.000Z', total_sales: sales, order_count: volume,
    platform_fees: 0, margin: 0, ad_spend: 0,
  }
}

describe('admin performance business dates', () => {
  const rows = [row('today', '2026-08-02', 3711.7, 127), row('recent', '2026-07-31', 28, 1), row('older', '2026-07-24', 154, 6)]
  const now = new Date(2026, 7, 2, 16)

  it('filters by data_date even when every row was uploaded today', () => {
    expect(filterPerformanceRows(rows, 'today', now).map(r => r.id)).toEqual(['today'])
    expect(filterPerformanceRows(rows, 'last7', now).map(r => r.id)).toEqual(['today', 'recent'])
    expect(filterPerformanceRows(rows, 'last30', now)).toHaveLength(3)
  })

  it('falls back to created_at only for rows without a business date', () => {
    const fallback = { ...row('fallback', ''), data_date: undefined }
    expect(performanceDateKey(fallback)).toBe('2026-08-02')
  })

  it('summarizes the same rows shown by the filter', () => {
    expect(summarizePerformance(filterPerformanceRows(rows, 'today', now))).toEqual({ sales: 3711.7, volume: 127, fees: 0 })
  })
})
