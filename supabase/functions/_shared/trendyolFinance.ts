export const TRENDYOL_SETTLEMENT_TYPES = [
  'Sale',
  'Return',
  'Discount',
  'DiscountCancel',
  'Coupon',
  'CouponCancel',
  'ProvisionPositive',
  'ProvisionNegative',
  'ManuelRefund',
  'ManualRefundCancel',
  'TYDiscount',
  'TYDiscountCancel',
  'TYCoupon',
  'TYCouponCancel',
  'SellerRevenuePositive',
  'SellerRevenueNegative',
  'CommissionPositive',
  'CommissionNegative',
  'SellerRevenuePositiveCancel',
  'SellerRevenueNegativeCancel',
  'CommissionPositiveCancel',
  'CommissionNegativeCancel',
] as const

export const TRENDYOL_OTHER_FINANCIAL_TYPES = [
  'Stoppage',
  'CashAdvance',
  'WireTransfer',
  'IncomingTransfer',
  'ReturnInvoice',
  'CommissionAgreementInvoice',
  'PaymentOrder',
  'DeductionInvoices',
  'FinancialItem',
] as const

export type TrendyolFinancialSource = 'settlements' | 'otherfinancials'

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function absoluteNumber(value: unknown) {
  return Math.abs(finiteNumber(value) || 0)
}

export function trendyolFinancialAmounts(transaction: Record<string, unknown>, source: TrendyolFinancialSource) {
  const debit = absoluteNumber(transaction.debt ?? transaction.debit)
  const credit = absoluteNumber(transaction.credit)
  const ledgerNet = credit - debit
  const sellerRevenue = finiteNumber(transaction.sellerRevenue ?? transaction.netAmount)

  // Settlement responses expose the merchant's actual earning separately from
  // gross debit/credit. Preserve its magnitude and derive its direction from
  // the ledger columns, which remain reliable even when Trendyol localises the
  // transactionType label in the response.
  const netAmount = source === 'settlements' && sellerRevenue !== null
    ? ledgerNet < 0 ? -Math.abs(sellerRevenue) : ledgerNet > 0 ? Math.abs(sellerRevenue) : sellerRevenue
    : ledgerNet

  return { debit, credit, netAmount }
}

export function trendyolTransactionNumber(
  transaction: Record<string, unknown>,
  source: TrendyolFinancialSource,
  index: number,
) {
  const providerId = transaction.id ?? transaction.transactionId ?? transaction.transactionNumber
  if (providerId !== null && providerId !== undefined && String(providerId).trim()) return String(providerId)

  // The provider normally returns id. This deterministic fallback avoids
  // duplicate ledger rows when a rare legacy response omits it.
  return [
    source,
    transaction.transactionDate ?? transaction.createdDate ?? 'undated',
    transaction.orderNumber ?? transaction.orderId ?? 'no-order',
    transaction.barcode ?? transaction.merchantSku ?? 'no-item',
    transaction.transactionType ?? transaction.type ?? 'transaction',
    transaction.receiptId ?? index,
  ].map(value => String(value)).join(':')
}

export function trendyolCommissionAmount(transaction: Record<string, unknown>) {
  return absoluteNumber(transaction.commissionAmount)
}

