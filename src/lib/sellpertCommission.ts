export type SellpertFeeType = 'none' | 'percentage' | 'fixed'

export type SellpertContractTerm = {
  sellpert_fee_type?: SellpertFeeType | string | null
  sellpert_fee_value?: number | string | null
}

export type SellpertCommissionOrder = {
  id?: string | null
  merchant_code?: string | null
  platform?: string | null
  order_id?: string | null
  status?: string | null
  total_amount?: number | string | null
  customer_shipping_amount?: number | string | null
}

export type SellpertCommissionSummary = {
  eligibleOrders: number
  commissionableSales: number
  commission: number
  byPlatform: Record<string, number>
}

function amount(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function normalizedFeeType(value: unknown): SellpertFeeType {
  return value === 'percentage' || value === 'fixed' ? value : 'none'
}

export function isSellpertCommissionEligible(status: unknown) {
  return String(status || '').trim().toLowerCase() === 'delivered'
}

export function sellpertCommissionableOrderTotal(order: SellpertCommissionOrder) {
  // Marketplace total_amount is the canonical amount paid for the order and
  // normally already contains customer shipping. The extra field is only for
  // sources that report customer-paid shipping separately.
  return amount(order.total_amount) + amount(order.customer_shipping_amount)
}

export function calculateSellpertOrderCommission(
  order: SellpertCommissionOrder,
  contract?: SellpertContractTerm | null,
) {
  if (!isSellpertCommissionEligible(order.status)) return 0
  const feeType = normalizedFeeType(contract?.sellpert_fee_type)
  const feeValue = amount(contract?.sellpert_fee_value)
  if (feeType === 'fixed') return feeValue
  if (feeType === 'percentage') {
    return sellpertCommissionableOrderTotal(order) * Math.min(100, feeValue) / 100
  }
  return 0
}

export function summarizeSellpertCommission(
  orders: SellpertCommissionOrder[],
  contract?: SellpertContractTerm | null,
): SellpertCommissionSummary {
  const feeType = normalizedFeeType(contract?.sellpert_fee_type)
  const feeValue = amount(contract?.sellpert_fee_value)
  const grouped = new Map<string, { platform: string; total: number }>()

  for (const order of orders) {
    if (!isSellpertCommissionEligible(order.status)) continue
    const platform = String(order.platform || 'other').trim().toLowerCase() || 'other'
    const reference = String(order.order_id || order.id || '').trim()
    const key = `${String(order.merchant_code || '')}:${platform}:${reference || `row-${grouped.size}`}`
    const current = grouped.get(key)
    if (current) current.total += sellpertCommissionableOrderTotal(order)
    else grouped.set(key, { platform, total: sellpertCommissionableOrderTotal(order) })
  }

  let commissionableSales = 0
  let commission = 0
  const byPlatform: Record<string, number> = {}
  for (const order of grouped.values()) {
    commissionableSales += order.total
    const orderCommission = feeType === 'fixed'
      ? feeValue
      : feeType === 'percentage' ? order.total * Math.min(100, feeValue) / 100 : 0
    commission += orderCommission
    byPlatform[order.platform] = (byPlatform[order.platform] || 0) + orderCommission
  }

  return { eligibleOrders: grouped.size, commissionableSales, commission, byPlatform }
}
