import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Trendyol international finance synchronization contract', () => {
  const syncSource = readFileSync('supabase/functions/sync-trendyol/index.ts', 'utf8')
  const financeSource = readFileSync('supabase/functions/_shared/trendyolFinance.ts', 'utf8')

  it('uses one transactionType per request for the Saudi storefront', () => {
    expect(syncSource).toContain('transactionType,')
    expect(syncSource).not.toContain('transactionTypes: transactionTypes.join')
    expect(syncSource).toContain("storeFrontCode: 'SA'")
  })

  it('uses the complete international transaction type set', () => {
    for (const type of ['Sale', 'Return', 'PaymentOrder', 'DeductionInvoices', 'CreditNote', 'CommissionInvoice']) {
      expect(financeSource).toContain(`'${type}'`)
    }
  })

  it('reuses settlement records when calculating exact order commission', () => {
    expect(syncSource).toContain("transactionType === 'Return' ? -1 : 1")
    expect(syncSource).toContain('orderCommissionTransactions.push(...sourceTransactions.map')
  })
})
