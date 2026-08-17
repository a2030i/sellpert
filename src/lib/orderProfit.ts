type ProfitOrder = {
  total_amount: number
  gross_amount?: number | null
  platform_fee?: number | null
  shipping_cost?: number | null
  discount_amount?: number | null
  quantity: number
  sku?: string | null
}

type ProfitItem = { sku?: string | null; barcode?: string | null; quantity?: number | null }

export interface OrderProfitSummary {
  revenue: number
  fees: number
  shipping: number
  discounts: number
  sellpertCommission: number
  productCost: number
  missingCostUnits: number
  costComplete: boolean
  netProfit: number | null
  usesGrossAmount: boolean
}

function key(kind: 'sku' | 'barcode', value: unknown) {
  return `${kind}:${String(value || '').trim().toLowerCase()}`
}

export function calculateOrderProfit(order: ProfitOrder, items: ProfitItem[], costs: Map<string, number>, exactFees?: number, sellpertCommission = 0): OrderProfitSummary {
  const netOrderAmount = Number(order.total_amount || 0)
  const grossOrderAmount = Number(order.gross_amount || 0)
  const usesGrossAmount = grossOrderAmount > netOrderAmount
  const revenue = usesGrossAmount ? grossOrderAmount : netOrderAmount
  const fees = Number(exactFees ?? order.platform_fee ?? 0)
  const shipping = Number(order.shipping_cost || 0)
  // Marketplace order totals are commonly already net of discounts. Subtract
  // discounts only when a distinct gross amount is available.
  const discounts = usesGrossAmount ? Number(order.discount_amount || Math.max(0, grossOrderAmount - netOrderAmount)) : 0
  const normalizedSellpertCommission = Math.max(0, Number(sellpertCommission || 0))
  const lines = items.length ? items : [{ sku: order.sku, quantity: order.quantity }]
  let productCost = 0
  let missingCostUnits = 0

  for (const line of lines) {
    const quantity = Math.max(1, Number(line.quantity || 1))
    const unitCost = (line.sku ? costs.get(key('sku', line.sku)) : undefined)
      ?? (line.barcode ? costs.get(key('barcode', line.barcode)) : undefined)
    if (unitCost && unitCost > 0) productCost += unitCost * quantity
    else missingCostUnits += quantity
  }

  const costComplete = lines.length > 0 && missingCostUnits === 0
  return {
    revenue, fees, shipping, discounts, sellpertCommission:normalizedSellpertCommission, productCost, missingCostUnits, costComplete, usesGrossAmount,
    netProfit: costComplete ? revenue - fees - shipping - discounts - normalizedSellpertCommission - productCost : null,
  }
}

export function orderContributionBeforeProductCost(order: Pick<ProfitOrder, 'total_amount' | 'platform_fee' | 'shipping_cost'>) {
  // total_amount is the marketplace net order amount. Discounts remain useful
  // as a disclosure, but subtracting them here would count them twice.
  return Number(order.total_amount || 0)
    - Number(order.platform_fee || 0)
    - Number(order.shipping_cost || 0)
}
