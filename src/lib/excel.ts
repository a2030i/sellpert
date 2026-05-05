import * as XLSX from 'xlsx'

export function exportToExcel(rows: any[], fileName: string, sheetName = 'Sheet1') {
  if (rows.length === 0) return
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

export function exportMultiSheet(sheets: { name: string; rows: any[] }[], fileName: string) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    if (s.rows.length === 0) continue
    const ws = XLSX.utils.json_to_sheet(s.rows)
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 30))
  }
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

// Accounting-friendly export: dual-entry style (Zoho/QuickBooks compatible)
export function exportAccounting(transactions: Array<{
  date: string; description: string; debit?: number; credit?: number;
  account: string; reference?: string; tax?: number; platform?: string
}>, fileName: string, period: string = '') {
  const rows = transactions.map(t => ({
    Date:        t.date,
    Reference:   t.reference || '',
    Description: t.description,
    Account:     t.account,
    Debit:       t.debit  || 0,
    Credit:      t.credit || 0,
    'Tax (15%)': t.tax    || 0,
    Platform:    t.platform || '',
  }))
  exportToExcel(rows, fileName + (period ? '-' + period : ''), 'Transactions')
}

