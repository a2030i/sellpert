import { describe, expect, it } from 'vitest'
import { reconcileSettlements } from '../settlementReconciliation'

describe('settlement reconciliation', () => {
  it('matches an exact Trendyol entitlement and transfer without double counting the payment', () => {
    const result = reconcileSettlements([
      { platform:'trendyol', settlement_id:'SET-1', transaction_type:'Sale', net_amount:100, transaction_date:'2026-08-01' },
      { platform:'trendyol', settlement_id:'SET-1', transaction_type:'CommissionNegative', net_amount:-10, transaction_date:'2026-08-01' },
      { platform:'trendyol', settlement_id:'SET-1', transaction_type:'WireTransfer', net_amount:-90, posted_date:'2026-08-03' },
    ])
    expect(result.groups[0]).toMatchObject({ status:'matched', entitlement:90, transferRecorded:90, variance:0, sales:100, deductions:10 })
    expect(result.matched).toBe(1)
  })

  it('separates awaiting transfers from real value differences', () => {
    const result = reconcileSettlements([
      { platform:'trendyol', settlement_id:'SET-2', transaction_type:'Sale', credit:75, debit:0, transaction_date:'2026-08-02' },
      { platform:'trendyol', settlement_id:'SET-3', transaction_type:'Sale', net_amount:50, transaction_date:'2026-08-02' },
      { platform:'trendyol', settlement_id:'SET-3', transaction_type:'PaymentOrder', net_amount:-45, posted_date:'2026-08-04' },
    ])
    expect(result.groups.find(group => group.reference === 'SET-2')?.status).toBe('awaiting_transfer')
    expect(result.groups.find(group => group.reference === 'SET-3')).toMatchObject({ status:'variance', variance:-5 })
  })

  it('reports transactions that cannot be traced to a settlement', () => {
    const result = reconcileSettlements([{ platform:'trendyol', transaction_type:'Sale', net_amount:20 }])
    expect(result.groups).toHaveLength(0)
    expect(result.unlinkedTransactions).toBe(1)
  })
})
