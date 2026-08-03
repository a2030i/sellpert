import { describe, expect, it } from 'vitest'
import { importArchiveContentType, importArchivePath, safeImportArchiveName, validateImportFile } from '../importArchive'

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
})
