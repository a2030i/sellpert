import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { expandImportArchive, importArchiveContentType, importArchivePath, safeImportArchiveName, validateImportFile } from '../importArchive'

describe('private import archive paths', () => {
  it('binds every object to a merchant and immutable upload id', () => {
    expect(importArchivePath('M-ABC123', '550e8400-e29b-41d4-a716-446655440000', '../../تقرير طلبات.xlsx'))
      .toBe('M-ABC123/550e8400-e29b-41d4-a716-446655440000/تقرير-طلبات.xlsx')
  })

  it('normalizes unsafe names and content types', () => {
    expect(safeImportArchiveName('folder\\orders<script>.csv')).toBe('orders_script_.csv')
    expect(importArchiveContentType('orders.CSV')).toBe('text/csv')
    expect(importArchiveContentType('report.xlsm')).toContain('macroEnabled')
  })

  it('rejects unsupported, empty, and oversized files', () => {
    expect(validateImportFile({ name: 'payload.exe', size: 12 })).toContain('غير مدعومة')
    expect(validateImportFile({ name: 'orders.csv', size: 0 })).toContain('فارغ')
    expect(validateImportFile({ name: 'orders.csv', size: 26 * 1024 * 1024 })).toContain('25MB')
    expect(validateImportFile({ name: 'orders.csv', size: 100 })).toBeNull()
  })

  it('fails closed for invalid ZIP input instead of forwarding it to the spreadsheet parser', async () => {
    const invalid = new File(['PK\u0003\u0004not-a-valid-archive'], 'orders.zip', { type: 'application/zip' })
    await expect(expandImportArchive(invalid)).rejects.toThrow('ZIP')
  })

  it('expands supported reports and preserves normal spreadsheet files', async () => {
    const zip = new JSZip()
    zip.file('folder/orders.csv', 'order_id,total\n1,20')
    const archive = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'reports.zip')
    const expanded = await expandImportArchive(archive)
    expect(expanded.map(file => file.name)).toEqual(['orders.csv'])

    const workbook = new File(['PK\u0003\u0004workbook'], 'orders.xlsx')
    await expect(expandImportArchive(workbook)).resolves.toEqual([workbook])
  })
})
