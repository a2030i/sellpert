import { calculateSellpertOrderCommission, type SellpertFeeType } from './sellpertCommission'

export type PricingViability = 'profitable' | 'weak' | 'loss' | 'missing'
export type { SellpertFeeType } from './sellpertCommission'

export type ProductProfitability = {
  salePrice: number
  costPrice: number
  commissionRate: number | null
  commissionValue: number | null
  shippingCost: number
  sellpertFeeType: SellpertFeeType
  sellpertFeeValue: number
  sellpertCommissionValue: number
  netReceived: number | null
  netProfit: number | null
  marginPercent: number | null
  viability: PricingViability
}

export function calculateProductProfitability(input: {
  salePrice: number
  costPrice: number
  commissionRate: number | null
  commissionVatRate?: number
  minimumCommission?: number
  shippingCostTaxInclusive: number
  sellpertFeeType?: SellpertFeeType
  sellpertFeeValue?: number
  sellpertCommissionShippingAmount?: number
}): ProductProfitability {
  const salePrice = Math.max(0, Number(input.salePrice || 0))
  const costPrice = Math.max(0, Number(input.costPrice || 0))
  const shippingCost = Math.max(0, Number(input.shippingCostTaxInclusive || 0))
  const sellpertFeeType: SellpertFeeType = input.sellpertFeeType === 'percentage' || input.sellpertFeeType === 'fixed' ? input.sellpertFeeType : 'none'
  const sellpertFeeValue = Math.max(0, Number(input.sellpertFeeValue || 0))
  // The catalog models the worst-case successful order containing this product
  // alone. A fixed Sellpert fee is therefore charged once for the whole
  // hypothetical order, while a percentage uses sales including shipping.
  const sellpertCommissionValue = calculateSellpertOrderCommission({
    status:'delivered',
    total_amount:salePrice,
    customer_shipping_amount:Math.max(0, Number(input.sellpertCommissionShippingAmount ?? shippingCost)),
  }, { sellpert_fee_type:sellpertFeeType, sellpert_fee_value:sellpertFeeValue })
  const rate = input.commissionRate == null ? null : Math.max(0, Number(input.commissionRate))
  if (salePrice <= 0 || rate == null) {
    return { salePrice, costPrice, commissionRate:rate, commissionValue:null, shippingCost, sellpertFeeType, sellpertFeeValue, sellpertCommissionValue, netReceived:null, netProfit:null, marginPercent:null, viability:'missing' }
  }

  const baseCommission = Math.max(salePrice * rate / 100, Math.max(0, Number(input.minimumCommission || 0)))
  const commissionValue = baseCommission * (1 + Math.max(0, Number(input.commissionVatRate ?? 15)) / 100)
  const netReceived = salePrice - commissionValue - shippingCost - sellpertCommissionValue
  const netProfit = netReceived - costPrice
  const marginPercent = salePrice > 0 ? netProfit / salePrice * 100 : null
  const viability: PricingViability = netProfit <= 0 ? 'loss' : marginPercent != null && marginPercent < 10 ? 'weak' : 'profitable'
  return { salePrice, costPrice, commissionRate:rate, commissionValue, shippingCost, sellpertFeeType, sellpertFeeValue, sellpertCommissionValue, netReceived, netProfit, marginPercent, viability }
}
