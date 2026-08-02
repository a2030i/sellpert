export interface AmazonBusinessTotals {
  sales: number
  units: number
  orderItems?: number
}

export interface AmazonDashboardTotals {
  totalSales: number
  totalUnits: number
  orderItems?: number
  rangeStart?: string
  rangeEnd?: string
}

export interface AmazonReportReconciliation {
  matched: boolean
  salesDifference: number
  unitsDifference: number
  orderItemsDifference: number | null
  rangeStart?: string
  rangeEnd?: string
}

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100

/**
 * Amazon's Business Report and Sales Dashboard describe the same period from
 * two different angles. Matching them keeps the time series and ASIN funnel
 * linked without ever adding their totals together.
 */
export function reconcileAmazonReportTotals(
  business: AmazonBusinessTotals,
  dashboard: AmazonDashboardTotals,
): AmazonReportReconciliation {
  const salesDifference = money(business.sales - dashboard.totalSales)
  const unitsDifference = Math.trunc(business.units || 0) - Math.trunc(dashboard.totalUnits || 0)
  const hasOrderItems = Number.isFinite(business.orderItems) && Number.isFinite(dashboard.orderItems)
  const orderItemsDifference = hasOrderItems
    ? Math.trunc(business.orderItems || 0) - Math.trunc(dashboard.orderItems || 0)
    : null

  return {
    matched: Math.abs(salesDifference) <= 0.01
      && unitsDifference === 0
      && (orderItemsDifference === null || orderItemsDifference === 0),
    salesDifference,
    unitsDifference,
    orderItemsDifference,
    rangeStart: dashboard.rangeStart,
    rangeEnd: dashboard.rangeEnd,
  }
}

export interface AmazonDailySalesRow {
  data_date: string
  total_sales: number
  units: number
  upload_id?: string | null
}

export interface AmazonDailyMatch extends AmazonReportReconciliation {
  uploadId: string | null
  totalSales: number
  totalUnits: number
  days: number
}

/** Find the uploaded daily report whose sales and units equal a Business Report. */
export function findMatchingAmazonDailyReport(
  business: AmazonBusinessTotals,
  rows: AmazonDailySalesRow[],
): AmazonDailyMatch | null {
  const groups = new Map<string, AmazonDailySalesRow[]>()
  for (const row of rows) {
    const key = row.upload_id || '__legacy__'
    groups.set(key, [...(groups.get(key) || []), row])
  }

  const matches: AmazonDailyMatch[] = []
  for (const [key, group] of groups) {
    const dates = group.map(row => String(row.data_date).slice(0, 10)).filter(Boolean).sort()
    const dashboard: AmazonDashboardTotals = {
      totalSales: money(group.reduce((sum, row) => sum + Number(row.total_sales || 0), 0)),
      totalUnits: group.reduce((sum, row) => sum + Number(row.units || 0), 0),
      rangeStart: dates[0],
      rangeEnd: dates.length ? dates[dates.length - 1] : undefined,
    }
    const result = reconcileAmazonReportTotals(business, dashboard)
    if (result.matched) {
      matches.push({
        ...result,
        uploadId: key === '__legacy__' ? null : key,
        totalSales: dashboard.totalSales,
        totalUnits: dashboard.totalUnits,
        days: group.length,
      })
    }
  }

  return matches.sort((a, b) => String(b.rangeEnd || '').localeCompare(String(a.rangeEnd || '')))[0] || null
}
