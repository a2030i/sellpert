import type { Order } from './supabase'

type FinancialOrder = Pick<Order, 'total_amount' | 'unit_price' | 'quantity'> & { platform_fee?: number | null }
type ActionableOrder = Pick<Order, 'status' | 'cargo_tracking_number'>

export function orderFinancialIssue(order: FinancialOrder): string | null {
  const total = Number(order.total_amount || 0)
  const fees = Number(order.platform_fee || 0)
  const expectedLineTotal = Number(order.unit_price || 0) * Number(order.quantity || 1)

  if (fees > total && total > 0) {
    return 'رسوم المنصة أعلى من إجمالي الطلب في الملف المصدر.'
  }
  if (total > 0 && expectedLineTotal > 0 && Math.abs(expectedLineTotal - total) > Math.max(1, total * 0.05)) {
    return 'سعر الوحدة والكمية لا يطابقان إجمالي الطلب في الملف المصدر.'
  }
  return null
}

export function orderNeedsAction(order: ActionableOrder): boolean {
  return ['pending', 'processing'].includes(order.status) && !order.cargo_tracking_number
}
