// Centralized formatters — استخدمها في كل مكان للتسق

export function fmtCurrency(v: number | null | undefined, currency = 'SAR'): string {
  if (v === null || v === undefined || isNaN(v)) return '—'
  const symbol = currency === 'SAR' ? 'ر.س' : currency === 'AED' ? 'د.إ' : currency
  return `${Math.round(v).toLocaleString('ar-SA')} ${symbol}`
}

export function fmtCurrencyDecimal(v: number | null | undefined, currency = 'SAR'): string {
  if (v === null || v === undefined || isNaN(v)) return '—'
  const symbol = currency === 'SAR' ? 'ر.س' : currency === 'AED' ? 'د.إ' : currency
  return `${v.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}`
}

export function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return v.toLocaleString('ar-SA')
}

export function fmtPercent(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return `${v.toFixed(decimals)}%`
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short', day: 'numeric' })
}

export function fmtRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `قبل ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${h} ساعة`
  const days = Math.floor(h / 24)
  if (days < 30) return `قبل ${days} يوم`
  const months = Math.floor(days / 30)
  if (months < 12) return `قبل ${months} شهر`
  return `قبل ${Math.floor(months / 12)} سنة`
}

export function fmtDelta(v: number | null | undefined, decimals = 1): { text: string; color: string; arrow: '▲' | '▼' | '—' } {
  if (v === null || v === undefined || isNaN(v)) return { text: '—', color: 'var(--text3)', arrow: '—' }
  if (v > 0)  return { text: `+${v.toFixed(decimals)}%`, color: '#00b894', arrow: '▲' }
  if (v < 0)  return { text: `${v.toFixed(decimals)}%`, color: '#e84040', arrow: '▼' }
  return { text: '0%', color: 'var(--text3)', arrow: '—' }
}

// Status colors for KPIs
export const semanticColor = {
  good:    '#00b894',
  warn:    '#ff9900',
  bad:     '#e84040',
  info:    '#7c6bff',
  neutral: '#4cc9f0',
}
