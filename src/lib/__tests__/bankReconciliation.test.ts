import { describe, expect, it } from 'vitest'
import { bankReconciliationSummary, reconcileBankReceipts } from '../bankReconciliation'
import type { SettlementReconciliation } from '../settlementReconciliation'

const settlement = (reference:string, transfer:number, transferDate='2026-08-03'): SettlementReconciliation => ({
  reference, platform:'trendyol', status:transfer ? 'matched' : 'awaiting_transfer', transactionCount:2,
  firstActivity:'2026-08-01', lastActivity:'2026-08-03', transferDate,
  sales:100, returns:0, deductions:10, additions:0, entitlement:90, transferRecorded:transfer, variance:0,
})

describe('bank receipt reconciliation', () => {
  it('verifies an exact bank reference and amount', () => {
    const results = reconcileBankReceipts([settlement('SET-1', 90)], [{
      id:'bank-1', transaction_date:'2026-08-04', credit:90, reference:'PAYOUT SET-1', currency:'SAR',
    }])
    expect(results[0].status).toBe('reference_match')
    expect(results[0].bankTransaction?.id).toBe('bank-1')
  })

  it('keeps amount-only matching as a suggestion and exposes ambiguous receipts', () => {
    const suggested = reconcileBankReceipts([settlement('SET-2', 75)], [
      { id:'bank-2', transaction_date:'2026-08-04', credit:75 },
    ])
    expect(suggested[0].status).toBe('suggested')
    const ambiguous = reconcileBankReceipts([settlement('SET-2', 75)], [
      { id:'bank-2', transaction_date:'2026-08-04', credit:75 },
      { id:'bank-3', transaction_date:'2026-08-05', credit:75 },
    ])
    expect(ambiguous[0]).toMatchObject({ status:'ambiguous', candidateCount:2 })
  })

  it('prefers an explicit merchant confirmation and reports unmatched bank credits', () => {
    const rows = [
      { id:'bank-1', transaction_date:'2026-08-04', credit:90 },
      { id:'bank-extra', transaction_date:'2026-08-04', credit:12 },
    ]
    const results = reconcileBankReceipts([settlement('SET-1', 90)], rows, [{
      id:'match-1', bank_transaction_id:'bank-1', platform:'trendyol', settlement_id:'SET-1', expected_amount:90, confirmed_at:'2026-08-05',
    }])
    expect(results[0].status).toBe('confirmed')
    expect(bankReconciliationSummary(results, rows).unmatchedCredits).toBe(1)
  })
})
