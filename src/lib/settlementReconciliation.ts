import { financialTransactionMeta } from './trendyolFinance'

export type SettlementStatus = 'matched' | 'awaiting_transfer' | 'variance' | 'review'

export type SettlementTransaction = {
  platform?: string | null
  settlement_id?: string | null
  transaction_date?: string | null
  posted_date?: string | null
  transaction_type?: string | null
  debit?: number | string | null
  credit?: number | string | null
  net_amount?: number | string | null
}

export type SettlementReconciliation = {
  reference: string
  platform: string
  status: SettlementStatus
  transactionCount: number
  firstActivity: string
  lastActivity: string
  transferDate: string
  sales: number
  returns: number
  deductions: number
  additions: number
  entitlement: number
  transferRecorded: number
  variance: number
}

export type SettlementReconciliationSummary = {
  groups: SettlementReconciliation[]
  matched: number
  awaiting: number
  variance: number
  review: number
  totalEntitlement: number
  totalTransfers: number
  unlinkedTransactions: number
}

const CENT = 0.01

function amount(row: SettlementTransaction) {
  const explicit = Number(row.net_amount)
  if (row.net_amount !== null && row.net_amount !== undefined && row.net_amount !== '' && Number.isFinite(explicit)) return explicit
  return Math.abs(Number(row.credit) || 0) - Math.abs(Number(row.debit) || 0)
}

function dateValue(row: SettlementTransaction) {
  return String(row.posted_date || row.transaction_date || '')
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function reconcileSettlements(rows: SettlementTransaction[]): SettlementReconciliationSummary {
  const linked = new Map<string, SettlementTransaction[]>()
  let unlinkedTransactions = 0

  for (const row of rows) {
    const reference = String(row.settlement_id || '').trim()
    if (!reference) { unlinkedTransactions++; continue }
    const key = `${String(row.platform || 'other').toLowerCase()}:${reference}`
    const current = linked.get(key) || []
    current.push(row)
    linked.set(key, current)
  }

  const groups: SettlementReconciliation[] = [...linked.entries()].map(([key, transactions]) => {
    const reference = key.slice(key.indexOf(':') + 1)
    const platform = String(transactions[0]?.platform || 'other').toLowerCase()
    let sales = 0, returns = 0, deductions = 0, additions = 0, entitlement = 0, transferRecorded = 0
    const dates: string[] = []
    const transferDates: string[] = []

    for (const row of transactions) {
      const net = amount(row)
      const meta = financialTransactionMeta(row.transaction_type)
      const date = dateValue(row)
      if (date) dates.push(date)
      if (meta.category === 'payment') {
        transferRecorded += Math.abs(net)
        if (date) transferDates.push(date)
        continue
      }
      entitlement += net
      if (meta.category === 'sale') sales += Math.abs(net)
      else if (meta.category === 'return') returns += Math.abs(net)
      else if (net < 0) deductions += Math.abs(net)
      else if (net > 0) additions += net
    }

    entitlement = roundCurrency(entitlement)
    transferRecorded = roundCurrency(transferRecorded)
    // Before the provider records a payment there is no realised variance;
    // the full entitlement is pending, not a missing bank amount.
    const variance = transferRecorded === 0 ? 0 : roundCurrency(transferRecorded - Math.max(entitlement, 0))
    let status: SettlementStatus
    if (entitlement <= 0 || (transferRecorded > 0 && entitlement === 0)) status = 'review'
    else if (transferRecorded === 0) status = 'awaiting_transfer'
    else if (Math.abs(variance) <= CENT) status = 'matched'
    else status = 'variance'

    const orderedDates = [...dates].sort()
    const orderedTransferDates = [...transferDates].sort()
    return {
      reference, platform, status, transactionCount:transactions.length,
      firstActivity:orderedDates[0] || '', lastActivity:orderedDates[orderedDates.length - 1] || '',
      transferDate:orderedTransferDates[orderedTransferDates.length - 1] || '',
      sales:roundCurrency(sales), returns:roundCurrency(returns), deductions:roundCurrency(deductions), additions:roundCurrency(additions),
      entitlement, transferRecorded, variance,
    }
  }).sort((a, b) => (b.transferDate || b.lastActivity).localeCompare(a.transferDate || a.lastActivity))

  return {
    groups,
    matched:groups.filter(group => group.status === 'matched').length,
    awaiting:groups.filter(group => group.status === 'awaiting_transfer').length,
    variance:groups.filter(group => group.status === 'variance').length,
    review:groups.filter(group => group.status === 'review').length,
    totalEntitlement:roundCurrency(groups.reduce((sum, group) => sum + Math.max(group.entitlement, 0), 0)),
    totalTransfers:roundCurrency(groups.reduce((sum, group) => sum + group.transferRecorded, 0)),
    unlinkedTransactions,
  }
}
