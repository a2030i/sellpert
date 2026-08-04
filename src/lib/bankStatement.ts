import * as XLSX from 'xlsx'
import { normalize, xlsxDateOnly } from './platformParsers'

export type BankStatementRow = {
  transaction_key: string
  transaction_date: string
  value_date: string | null
  description: string | null
  reference: string | null
  debit: number
  credit: number
  balance: number | null
  currency: string
  account_hint: string | null
}

export type ParsedBankStatement = {
  rows: BankStatementRow[]
  skipped: number
  warnings: string[]
  periodStart: string
  periodEnd: string
  totalCredits: number
  totalDebits: number
}

const ALIASES = {
  date: ['تاريخ العملية', 'تاريخ الحركة', 'التاريخ', 'transaction date', 'booking date', 'date'],
  valueDate: ['تاريخ القيمة', 'value date'],
  description: ['وصف العملية', 'تفاصيل العملية', 'البيان', 'الوصف', 'description', 'narrative', 'details'],
  reference: ['الرقم المرجعي', 'رقم المرجع', 'المرجع', 'reference number', 'reference no', 'reference', 'ref no'],
  debit: ['مبلغ مدين', 'المدين', 'مدين', 'السحب', 'debit amount', 'withdrawal amount', 'withdrawals', 'debit'],
  credit: ['مبلغ دائن', 'الدائن', 'دائن', 'الإيداع', 'credit amount', 'deposit amount', 'deposits', 'credit'],
  amount: ['مبلغ العملية', 'المبلغ', 'transaction amount', 'amount'],
  direction: ['نوع العملية', 'نوع الحركة', 'transaction type', 'debit credit', 'type'],
  balance: ['الرصيد بعد العملية', 'الرصيد', 'closing balance', 'balance'],
  currency: ['العملة', 'currency'],
  account: ['رقم الحساب', 'الحساب', 'account number', 'account'],
} as const

function digits(value: string) {
  return value
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
}

export function bankNumber(value: unknown): number {
  let raw = digits(String(value ?? '')).trim()
  if (!raw || raw === '-') return 0
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-') || raw.endsWith('-')
  raw = raw.replace(/ر\.?س|SAR/gi, '').replace(/[()\s\u00a0]/g, '').replace(/٬/g, ',').replace(/٫/g, '.')
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/,/g, '')
  else if ((raw.match(/,/g) || []).length === 1 && /,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.')
  else raw = raw.replace(/,/g, '')
  const parsed = Number(raw.replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return Math.round(Math.abs(parsed) * (negative ? -1 : 1) * 100) / 100
}

function indexOf(headers: unknown[], aliases: readonly string[]) {
  const normalized = headers.map(normalize)
  for (const alias of aliases) {
    const target = normalize(alias)
    const exact = normalized.indexOf(target)
    if (exact >= 0) return exact
  }
  for (const alias of aliases) {
    const target = normalize(alias)
    const partial = normalized.findIndex(header => header.includes(target))
    if (partial >= 0) return partial
  }
  return -1
}

function headerMap(row: unknown[]) {
  return Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, indexOf(row, aliases)])) as Record<keyof typeof ALIASES, number>
}

function headerScore(row: unknown[]) {
  const map = headerMap(row)
  let score = map.date >= 0 ? 5 : 0
  if (map.credit >= 0) score += 3
  if (map.debit >= 0) score += 3
  if (map.amount >= 0) score += 3
  if (map.description >= 0) score += 1
  if (map.reference >= 0) score += 1
  return score
}

function hash(value: string, seed: number) {
  let result = seed >>> 0
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

function transactionKey(canonical: string, occurrence: number) {
  return `bank:${hash(canonical, 2166136261)}${hash(canonical, 3339675911)}:${occurrence}`
}

function text(value: unknown, max: number) {
  const result = String(value ?? '').trim()
  return result ? result.slice(0, max) : null
}

function direction(value: unknown) {
  return normalize(value).replace(/أ|إ|آ/g, 'ا')
}

function currency(value: unknown) {
  const raw = String(value ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(raw)) return raw
  return 'SAR'
}

function accountHint(value: unknown) {
  const raw = digits(String(value ?? '')).replace(/\s/g, '')
  return raw ? raw.slice(-4) : null
}

export function parseBankStatementMatrix(matrix: unknown[][]): ParsedBankStatement {
  if (!matrix.length) throw new Error('الملف فارغ')
  let headerIndex = -1
  let bestScore = 0
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const score = headerScore(matrix[i] || [])
    if (score > bestScore) { bestScore = score; headerIndex = i }
  }
  if (headerIndex < 0 || bestScore < 8) {
    throw new Error('لم نتعرف على أعمدة التاريخ والمبلغ. استخدم كشفًا يحتوي على التاريخ ومدين/دائن أو مبلغ العملية.')
  }

  const columns = headerMap(matrix[headerIndex])
  if (columns.date < 0 || (columns.amount < 0 && columns.debit < 0 && columns.credit < 0)) {
    throw new Error('يلزم وجود عمود للتاريخ وعمود للمبلغ أو للمدين والدائن.')
  }

  const rows: BankStatementRow[] = []
  const occurrences = new Map<string, number>()
  let skipped = 0
  for (const source of matrix.slice(headerIndex + 1)) {
    if (!Array.isArray(source) || source.every(cell => String(cell ?? '').trim() === '')) continue
    const transactionDate = xlsxDateOnly(source[columns.date])
    if (!transactionDate) { skipped++; continue }

    let debit = columns.debit >= 0 ? Math.abs(bankNumber(source[columns.debit])) : 0
    let credit = columns.credit >= 0 ? Math.abs(bankNumber(source[columns.credit])) : 0
    if (debit === 0 && credit === 0 && columns.amount >= 0) {
      const signed = bankNumber(source[columns.amount])
      const kind = columns.direction >= 0 ? direction(source[columns.direction]) : ''
      if (/debit|withdraw|مدين|سحب/.test(kind)) debit = Math.abs(signed)
      else if (/credit|deposit|دائن|داين|ايداع/.test(kind)) credit = Math.abs(signed)
      else if (signed < 0) debit = Math.abs(signed)
      else credit = Math.abs(signed)
    }
    if (debit === 0 && credit === 0) { skipped++; continue }
    // A row cannot be both an incoming and outgoing bank movement.
    if (debit > 0 && credit > 0) { skipped++; continue }

    const description = columns.description >= 0 ? text(source[columns.description], 1000) : null
    const reference = columns.reference >= 0 ? text(source[columns.reference], 300) : null
    const valueDate = columns.valueDate >= 0 ? xlsxDateOnly(source[columns.valueDate]) : null
    const balanceValue = columns.balance >= 0 ? bankNumber(source[columns.balance]) : 0
    const canonical = [transactionDate, valueDate || '', debit.toFixed(2), credit.toFixed(2), reference || '', description || ''].join('|')
    const occurrence = occurrences.get(canonical) || 0
    occurrences.set(canonical, occurrence + 1)
    rows.push({
      transaction_key: transactionKey(canonical, occurrence),
      transaction_date: transactionDate,
      value_date: valueDate,
      description,
      reference,
      debit,
      credit,
      balance: columns.balance >= 0 && String(source[columns.balance] ?? '').trim() ? balanceValue : null,
      currency: columns.currency >= 0 ? currency(source[columns.currency]) : 'SAR',
      account_hint: columns.account >= 0 ? accountHint(source[columns.account]) : null,
    })
  }

  if (!rows.length) throw new Error('لم نجد حركات مالية صالحة داخل الملف.')
  const dates = rows.map(row => row.transaction_date).sort()
  const warnings: string[] = []
  if (skipped) warnings.push(`تم تجاهل ${skipped.toLocaleString('ar-SA-u-nu-latn')} صف غير مكتمل أو بلا مبلغ.`)
  const currencies = new Set(rows.map(row => row.currency))
  if (currencies.size > 1) warnings.push('يحتوي الكشف على أكثر من عملة؛ تتم المطابقة داخل العملة نفسها فقط.')
  return {
    rows,
    skipped,
    warnings,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    totalCredits: Math.round(rows.reduce((sum, row) => sum + row.credit, 0) * 100) / 100,
    totalDebits: Math.round(rows.reduce((sum, row) => sum + row.debit, 0) * 100) / 100,
  }
}

export async function parseBankStatementFile(file: File): Promise<ParsedBankStatement> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['csv', 'tsv', 'txt', 'xls', 'xlsx', 'xlsm'].includes(extension)) {
    throw new Error('ارفع ملف Excel أو CSV صادرًا من البنك.')
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('حجم الملف يتجاوز 25 ميجابايت.')
  // Text reports must be decoded by the browser as UTF-8 first; reading their
  // bytes as a legacy workbook encoding corrupts Arabic bank headers.
  const workbook = ['csv', 'tsv', 'txt'].includes(extension)
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type:'string', raw:true, cellDates:false, FS:extension === 'tsv' ? '\t' : undefined })
    : XLSX.read(await file.arrayBuffer(), { type:'array', raw:true, cellDates:false })
  const sheetName = workbook.SheetNames.find(name => {
    const range = workbook.Sheets[name]?.['!ref']
    return Boolean(range && range !== 'A1')
  }) || workbook.SheetNames[0]
  if (!sheetName) throw new Error('الملف لا يحتوي على ورقة قابلة للقراءة.')
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header:1, defval:'', raw:true }) as unknown[][]
  return parseBankStatementMatrix(matrix)
}
