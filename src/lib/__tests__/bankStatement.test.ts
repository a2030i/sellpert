import { describe, expect, it } from 'vitest'
import { bankNumber, parseBankStatementMatrix } from '../bankStatement'

describe('bank statement parser', () => {
  it('reads Arabic debit and credit columns while keeping only the account suffix', () => {
    const result = parseBankStatementMatrix([
      ['اسم العميل', 'متجر الاختبار'],
      ['تاريخ العملية', 'الوصف', 'الرقم المرجعي', 'مدين', 'دائن', 'الرصيد', 'رقم الحساب'],
      ['03/08/2026', 'تحويل ترنديول SET-1', 'SET-1', '', '٩٠٫٥٠', '1,500.50', 'SA0012345678'],
      ['04/08/2026', 'رسوم بنكية', 'FEE-1', '2.25', '', '1,498.25', 'SA0012345678'],
    ])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ transaction_date:'2026-08-03', credit:90.5, debit:0, account_hint:'5678' })
    expect(result.rows[1]).toMatchObject({ credit:0, debit:2.25 })
    expect(result.totalCredits).toBe(90.5)
    expect(result.totalDebits).toBe(2.25)
  })

  it('uses a signed amount and direction when separate debit and credit are absent', () => {
    const result = parseBankStatementMatrix([
      ['Date', 'Description', 'Amount', 'Transaction Type'],
      ['2026-08-05', 'Marketplace payout', 'SAR 135.00', 'Credit'],
      ['2026-08-06', 'Charge', '(5.25)', 'Debit'],
    ])
    expect(result.rows.map(row => [row.debit, row.credit])).toEqual([[0, 135], [5.25, 0]])
  })

  it('rejects files that do not expose a date and amount contract', () => {
    expect(() => parseBankStatementMatrix([['Name', 'Notes'], ['A', 'B']])).toThrow(/التاريخ والمبلغ/)
  })

  it('normalizes Arabic and western formatted amounts', () => {
    expect(bankNumber('١٬٢٣٤٫٥٠ ر.س')).toBe(1234.5)
    expect(bankNumber('(1,234.50)')).toBe(-1234.5)
  })
})
