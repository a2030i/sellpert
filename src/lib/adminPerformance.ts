import type { PerformanceData } from './supabase'

export type PerformancePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'all'

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The business date represented by a performance row, not its upload timestamp. */
export function performanceDateKey(row: Pick<PerformanceData, 'data_date' | 'created_at'>): string {
  if (row.data_date && /^\d{4}-\d{2}-\d{2}/.test(row.data_date)) return row.data_date.slice(0, 10)
  const uploadedAt = new Date(row.created_at)
  return Number.isNaN(uploadedAt.getTime()) ? '' : localDateKey(uploadedAt)
}

function shiftedDateKey(now: Date, days: number): string {
  return localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}

export function filterPerformanceRows(rows: PerformanceData[], preset: PerformancePreset, now = new Date()): PerformanceData[] {
  if (preset === 'all') return rows

  const today = localDateKey(now)
  let start = today
  if (preset === 'last7') start = shiftedDateKey(now, -6)
  else if (preset === 'last30') start = shiftedDateKey(now, -29)
  else if (preset === 'thisMonth') start = `${today.slice(0, 7)}-01`

  return rows.filter(row => {
    const date = performanceDateKey(row)
    return date >= start && date <= today
  })
}

export function summarizePerformance(rows: PerformanceData[]) {
  return rows.reduce((summary, row) => ({
    sales: summary.sales + Number(row.total_sales || 0),
    volume: summary.volume + Number(row.order_count || 0),
    fees: summary.fees + Number(row.platform_fees || 0),
  }), { sales: 0, volume: 0, fees: 0 })
}
