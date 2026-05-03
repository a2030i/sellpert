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
