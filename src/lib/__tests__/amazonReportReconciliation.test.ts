import { describe, expect, it } from 'vitest'
import { findMatchingAmazonDailyReport, reconcileAmazonReportTotals } from '../amazonReportReconciliation'

describe('Amazon report reconciliation', () => {
  it('يربط الملفين عندما تتطابق المبيعات والوحدات ومنتجات الطلب', () => {
    const result = reconcileAmazonReportTotals(
      { sales: 3711.70, units: 127, orderItems: 122 },
      { totalSales: 3711.70, totalUnits: 127, orderItems: 122, rangeStart: '2026-07-01', rangeEnd: '2026-07-31' },
    )
    expect(result).toMatchObject({ matched: true, salesDifference: 0, unitsDifference: 0, orderItemsDifference: 0 })
  })

  it('لا يربط تقريرين من نطاقين مختلفين', () => {
    const result = reconcileAmazonReportTotals(
      { sales: 3711.70, units: 127, orderItems: 122 },
      { totalSales: 3600, totalUnits: 120, orderItems: 115 },
    )
    expect(result.matched).toBe(false)
    expect(result.salesDifference).toBe(111.7)
    expect(result.unitsDifference).toBe(7)
  })

  it('يجد رفعة لوحة المبيعات المطابقة ولا يخلط الرفعات', () => {
    const match = findMatchingAmazonDailyReport({ sales: 300, units: 12 }, [
      { upload_id: 'old', data_date: '2026-06-01', total_sales: 99, units: 4 },
      { upload_id: 'new', data_date: '2026-07-01', total_sales: 100, units: 5 },
      { upload_id: 'new', data_date: '2026-07-02', total_sales: 200, units: 7 },
    ])
    expect(match).toMatchObject({ uploadId: 'new', matched: true, totalSales: 300, totalUnits: 12, days: 2, rangeStart: '2026-07-01', rangeEnd: '2026-07-02' })
  })
})
