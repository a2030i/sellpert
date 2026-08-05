import type { Order } from './supabase'

export interface OrderPlatformComparison {
  platform: string
  revenue: number
  count: number
  delivered: number
  cancelled: number
  returned: number
  deliveryRate: string
  cancelRate: string
  returnRate: string
  averageOrderValue: number
}

/** Compare marketplaces from canonical order rows only. */
export function buildOrderPlatformComparison(orders: Order[]): OrderPlatformComparison[] {
  const byPlatform = new Map<string, {
    revenue: number
    count: number
    delivered: number
    cancelled: number
    returned: number
  }>()

  for (const order of orders) {
    const row = byPlatform.get(order.platform) || {
      revenue: 0,
      count: 0,
      delivered: 0,
      cancelled: 0,
      returned: 0,
    }
    row.revenue += Number(order.total_amount || 0)
    row.count += 1
    if (order.status === 'delivered') row.delivered += 1
    if (order.status === 'cancelled') row.cancelled += 1
    if (order.status === 'returned') row.returned += 1
    byPlatform.set(order.platform, row)
  }

  return [...byPlatform.entries()]
    .map(([platform, row]) => ({
      platform,
      ...row,
      revenue: Math.round(row.revenue),
      deliveryRate: row.count ? ((row.delivered / row.count) * 100).toFixed(1) : '0.0',
      cancelRate: row.count ? ((row.cancelled / row.count) * 100).toFixed(1) : '0.0',
      returnRate: row.count ? ((row.returned / row.count) * 100).toFixed(1) : '0.0',
      averageOrderValue: row.count ? Math.round(row.revenue / row.count) : 0,
    }))
    .sort((left, right) => right.revenue - left.revenue)
}
