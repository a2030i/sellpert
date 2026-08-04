import type { SettlementReconciliation } from './settlementReconciliation'

export type BankTransaction = {
  id: string
  transaction_date: string
  value_date?: string | null
  description?: string | null
  reference?: string | null
  debit?: number | string | null
  credit?: number | string | null
  net_amount?: number | string | null
  currency?: string | null
}

export type ConfirmedBankMatch = {
  id: string
  bank_transaction_id: string
  platform: string
  settlement_id: string
  expected_amount: number | string
  confirmed_at: string
}

export type BankMatchStatus = 'confirmed' | 'reference_match' | 'suggested' | 'ambiguous' | 'missing' | 'awaiting_provider'

export type SettlementBankResult = {
  settlement: SettlementReconciliation
  status: BankMatchStatus
  bankTransaction: BankTransaction | null
  candidateCount: number
  manualMatchId: string | null
}

function amount(row: BankTransaction) {
  if (row.credit !== null && row.credit !== undefined) return Number(row.credit) || 0
  return Math.max(Number(row.net_amount) || 0, 0)
}

function day(value: string) {
  const timestamp = new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
  return Number.isFinite(timestamp) ? timestamp / 86_400_000 : 0
}

function searchable(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '')
}

function sameAmount(left: number, right: number) {
  return Math.abs(left - right) <= 0.01
}

export function reconcileBankReceipts(
  settlements: SettlementReconciliation[],
  bankRows: BankTransaction[],
  confirmedMatches: ConfirmedBankMatch[] = [],
): SettlementBankResult[] {
  const bankById = new Map(bankRows.map(row => [row.id, row]))
  const used = new Set<string>()

  return settlements.map(settlement => {
    const manual = confirmedMatches.find(match =>
      match.platform === settlement.platform && match.settlement_id === settlement.reference)
    if (manual) {
      const bankTransaction = bankById.get(manual.bank_transaction_id) || null
      if (bankTransaction) used.add(bankTransaction.id)
      return { settlement, status:'confirmed', bankTransaction, candidateCount:bankTransaction ? 1 : 0, manualMatchId:manual.id }
    }

    const expected = settlement.transferRecorded
    if (expected <= 0 || !settlement.transferDate) {
      return { settlement, status:'awaiting_provider', bankTransaction:null, candidateCount:0, manualMatchId:null }
    }
    const transferDay = day(settlement.transferDate)
    const candidates = bankRows.filter(row => {
      if (used.has(row.id) || amount(row) <= 0 || !sameAmount(amount(row), expected)) return false
      const delta = day(row.value_date || row.transaction_date) - transferDay
      return delta >= -2 && delta <= 14
    })
    const reference = searchable(settlement.reference)
    const referenced = reference.length >= 4
      ? candidates.filter(row => searchable(`${row.reference || ''} ${row.description || ''}`).includes(reference))
      : []
    if (referenced.length === 1) {
      used.add(referenced[0].id)
      return { settlement, status:'reference_match', bankTransaction:referenced[0], candidateCount:1, manualMatchId:null }
    }
    if (referenced.length > 1 || candidates.length > 1) {
      return { settlement, status:'ambiguous', bankTransaction:null, candidateCount:Math.max(referenced.length, candidates.length), manualMatchId:null }
    }
    if (candidates.length === 1) {
      used.add(candidates[0].id)
      return { settlement, status:'suggested', bankTransaction:candidates[0], candidateCount:1, manualMatchId:null }
    }
    return { settlement, status:'missing', bankTransaction:null, candidateCount:0, manualMatchId:null }
  })
}

export function bankReconciliationSummary(results: SettlementBankResult[], bankRows: BankTransaction[]) {
  const matchedBankIds = new Set(results.map(result => result.bankTransaction?.id).filter(Boolean))
  return {
    confirmed: results.filter(result => result.status === 'confirmed' || result.status === 'reference_match').length,
    suggested: results.filter(result => result.status === 'suggested').length,
    needsReview: results.filter(result => result.status === 'ambiguous' || result.status === 'missing').length,
    awaitingProvider: results.filter(result => result.status === 'awaiting_provider').length,
    unmatchedCredits: bankRows.filter(row => amount(row) > 0 && !matchedBankIds.has(row.id)).length,
  }
}
