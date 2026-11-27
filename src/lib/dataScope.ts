/** Calendar boundaries are shared by summary cards and their drilldowns. */
export function riyadhDay(value: string | Date) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
}
export function dateScope(period: string, from?: string | null, to?: string | null, now = new Date()) {
  const today = riyadhDay(now)
  let start = from || today
  let end = to || today
  if (period !== 'custom') {
    end = today
    if (period === 'month' || period === 'thisMonth') start = `${today.slice(0, 7)}-01`
    else {
      const days = { today: 1, last7: 7, last30: 30, last90: 90 }[period] || Number(period)
      if (!Number.isFinite(days) || days < 1) return null
      start = new Date(Date.parse(`${today}T12:00:00+03:00`) - (days - 1) * 86400000).toISOString().slice(0, 10)
    }
  }
  return [new Date(`${start}T00:00:00+03:00`), new Date(`${end}T23:59:59.999+03:00`)] as const
}
export function ratio(numerator: number, denominator: number): number | null {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null
}
export function formatRatio(value: number | null, suffix: string, scale = 1) {
  return value === null ? 'غير قابل للحساب' : `${(value * scale).toFixed(2)}${suffix}`
}
export function orderIsPending(order: { status?: string | null }) {
  return ['pending', 'processing', 'new', 'confirmed', 'ready_to_ship'].includes(String(order.status).toLowerCase())
}
