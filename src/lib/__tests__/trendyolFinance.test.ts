import { describe, expect, it } from 'vitest'
import { financialTransactionMeta } from '../trendyolFinance'

describe('Trendyol financial labels', () => {
  it('translates provider codes and Turkish response labels for merchants', () => {
    expect(financialTransactionMeta('Sale')).toEqual({ label: 'مبيعات', category: 'sale' })
    expect(financialTransactionMeta('Satış')).toEqual({ label: 'مبيعات', category: 'sale' })
    expect(financialTransactionMeta('İade')).toEqual({ label: 'مرتجعات', category: 'return' })
    expect(financialTransactionMeta('DeductionInvoices')).toEqual({ label: 'فاتورة استقطاعات وخدمات', category: 'invoice' })
    expect(financialTransactionMeta('Ödeme')).toEqual({ label: 'دفعة مستحقات', category: 'payment' })
  })

  it('uses a clear merchant label for new provider values', () => {
    expect(financialTransactionMeta('NewCommissionCorrection').label).toBe('عمولة أو تصحيح عمولة')
  })
})
