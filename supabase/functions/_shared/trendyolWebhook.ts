export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validIso(value: unknown): string | null {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function commissionFromLines(lines: any[]): number | null {
  if (!Array.isArray(lines) || !lines.length) return null
  let found = false
  const total = lines.reduce((sum, line) => {
    const rate = numberOrNull(line.commissionRate ?? line.commission_rate)
    if (rate === null) return sum
    found = true
    const lineTotal = numberOrNull(line.price ?? line.lineTotal ?? line.amount)
      ?? (Number(line.unitPrice || 0) * Number(line.quantity || 1))
    return sum + lineTotal * rate / 100 * 1.15
  }, 0)
  return found ? Math.round(total * 100) / 100 : null
}

export function mapTrendyolOrderStatus(raw: string, fallback = 'pending'): string {
  const normalized = raw?.toLowerCase()
  if (['delivered', 'teslim'].some(value => normalized?.includes(value))) return 'delivered'
  if (['cancel', 'iptal'].some(value => normalized?.includes(value))) return 'cancelled'
  if (['return', 'iade'].some(value => normalized?.includes(value))) return 'returned'
  if (['ship', 'kargo'].some(value => normalized?.includes(value))) return 'shipped'
  if (['created', 'awaiting', 'picking', 'invoiced', 'unpacked', 'pending'].some(value => normalized?.includes(value))) return 'pending'
  return fallback
}
