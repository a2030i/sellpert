export type FinancialPerformanceRow = {
  total_sales?: number | string | null
  order_count?: number | string | null
  platform_fees?: number | string | null
  ad_spend?: number | string | null
}

export type FinancialReturnRow = {
  return_amount?: number | string | null
}

export type FinancialSummaryInput = {
  performanceRows: FinancialPerformanceRow[]
  returnRows: FinancialReturnRow[]
  detailedRevenue: number
  detailedOrders: number
  knownCogs: number
  costedUnits: number
  missingCostUnits: number
  sellpertCommission?: number
}

export type FinancialSummary = {
  grossRevenue: number
  platformFees: number
  adSpend: number
  totalReturns: number
  sellpertCommission: number
  afterFees: number
  netBeforeProductCost: number
  provisionalNetAfterKnownCosts: number
  estimatedProfit: number | null
  margin: number | null
  reportedActivity: number
  detailedOrders: number
  detailedRevenue: number
  detailCoverage: number
  salesDetailsComplete: boolean
  productCostsComplete: boolean
  profitComplete: boolean
  source: 'detailed_orders' | 'mixed' | 'platform_summary'
}

function amount(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildFinancialSummary(input: FinancialSummaryInput): FinancialSummary {
  const grossRevenue = input.performanceRows.reduce((sum, row) => sum + amount(row.total_sales), 0)
  const platformFees = input.performanceRows.reduce((sum, row) => sum + amount(row.platform_fees), 0)
  const adSpend = input.performanceRows.reduce((sum, row) => sum + amount(row.ad_spend), 0)
  const totalReturns = input.returnRows.reduce((sum, row) => sum + amount(row.return_amount), 0)
  const sellpertCommission = amount(input.sellpertCommission)
  const reportedActivity = input.performanceRows.reduce((sum, row) => sum + amount(row.order_count), 0)
  const detailedRevenue = Math.max(0, amount(input.detailedRevenue))
  const detailCoverage = grossRevenue > 0
    ? Math.min(100, detailedRevenue / grossRevenue * 100)
    : input.detailedOrders > 0 ? 100 : 0
  // Small currency rounding differences should not block a complete ledger.
  const allowedDifference = Math.max(0.05, grossRevenue * 0.005)
  const salesDetailsComplete = grossRevenue > 0
    ? Math.abs(grossRevenue - detailedRevenue) <= allowedDifference
    : input.detailedOrders === 0
  const productCostsComplete = input.missingCostUnits === 0 && input.costedUnits > 0
  const profitComplete = salesDetailsComplete && productCostsComplete
  const afterFees = grossRevenue - platformFees - adSpend - totalReturns - sellpertCommission
  const netBeforeProductCost = afterFees
  const provisionalNetAfterKnownCosts = netBeforeProductCost - amount(input.knownCogs)
  const estimatedProfit = profitComplete ? netBeforeProductCost - amount(input.knownCogs) : null
  const margin = estimatedProfit !== null && grossRevenue > 0 ? estimatedProfit / grossRevenue * 100 : null
  const source = salesDetailsComplete
    ? 'detailed_orders'
    : detailedRevenue > 0 ? 'mixed' : 'platform_summary'

  return {
    grossRevenue,
    platformFees,
    adSpend,
    totalReturns,
    sellpertCommission,
    afterFees,
    netBeforeProductCost,
    provisionalNetAfterKnownCosts,
    estimatedProfit,
    margin,
    reportedActivity,
    detailedOrders: input.detailedOrders,
    detailedRevenue,
    detailCoverage,
    salesDetailsComplete,
    productCostsComplete,
    profitComplete,
    source,
  }
}
