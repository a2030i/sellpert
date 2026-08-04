import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  TRENDYOL_OTHER_FINANCIAL_TYPES,
  TRENDYOL_SETTLEMENT_TYPES,
  trendyolCommissionAmount,
  trendyolFinancialAmounts,
  trendyolTransactionNumber,
} from './trendyolFinance.ts'

Deno.test('covers the transaction types published for the international finance API', () => {
  assertEquals(TRENDYOL_SETTLEMENT_TYPES, ['Sale', 'Return'])
  assertEquals(TRENDYOL_OTHER_FINANCIAL_TYPES.length, 4)
  assertEquals(TRENDYOL_OTHER_FINANCIAL_TYPES.includes('DeductionInvoices'), true)
  assertEquals(TRENDYOL_OTHER_FINANCIAL_TYPES.includes('CommissionInvoice'), true)
})

Deno.test('uses debit and credit direction even when the response type is localised', () => {
  assertEquals(
    trendyolFinancialAmounts({ transactionType: 'Satış', credit: 450, debt: 0, sellerRevenue: 382.5 }, 'settlements'),
    { debit: 0, credit: 450, netAmount: 382.5 },
  )
  assertEquals(
    trendyolFinancialAmounts({ transactionType: 'İade', credit: 0, debt: 450, sellerRevenue: 382.5 }, 'settlements'),
    { debit: 450, credit: 0, netAmount: -382.5 },
  )
  assertEquals(
    trendyolFinancialAmounts({ transactionType: 'Ödeme', credit: 900, debt: 0, sellerRevenue: null }, 'otherfinancials'),
    { debit: 0, credit: 900, netAmount: 900 },
  )
})

Deno.test('keeps provider ids and creates a deterministic legacy fallback', () => {
  assertEquals(trendyolTransactionNumber({ id: 725041340 }, 'settlements', 0), '725041340')
  const fallback = trendyolTransactionNumber({ transactionDate: 1, orderNumber: 2, barcode: 'B', transactionType: 'Sale' }, 'settlements', 0)
  assertEquals(fallback, 'settlements:1:2:B:Sale:0')
  assertEquals(trendyolCommissionAmount({ commissionAmount: -6.21 }), 6.21)
})
