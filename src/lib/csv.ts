const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function safeCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (FORMULA_PREFIX.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function buildSafeCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n')
}

export function downloadCsv(rows: readonly (readonly unknown[])[], fileName: string) {
  const blob = new Blob([`\uFEFF${buildSafeCsv(rows)}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
