import { describe, expect, it } from 'vitest'
import { orderDataLineage, productDataLineage } from '../dataLineage'

describe('orderDataLineage', () => {
  it('uses the archived upload as the authoritative source and exposes its merchant-friendly name', () => {
    expect(orderDataLineage(
      { platform: 'salla', upload_id: 'upload-1', last_synced_at: '2026-08-05T10:00:00Z' },
      { id: 'upload-1', platform: 'salla', file_name: 'طلبات-اغسطس.xlsx', uploaded_at: '2026-08-05T09:00:00Z' },
    )).toMatchObject({
      kind: 'file', label: 'ملف سلة', fileName: 'طلبات-اغسطس.xlsx', occurredAt: '2026-08-05T09:00:00Z',
    })
  })

  it('identifies every direct platform sync instead of assuming only Trendyol can use an API', () => {
    expect(orderDataLineage({ platform: 'amazon', upload_id: null, last_synced_at: '2026-08-05T10:00:00Z' }))
      .toMatchObject({ kind: 'api', label: 'API أمازون' })
    expect(orderDataLineage({ platform: 'salla', upload_id: null, last_synced_at: '2026-08-05T10:00:00Z' }))
      .toMatchObject({ kind: 'api', label: 'API سلة' })
  })

  it('does not invent an API source for legacy rows without evidence', () => {
    expect(orderDataLineage({ platform: 'amazon', upload_id: null, last_synced_at: null }))
      .toMatchObject({ kind: 'unknown', label: 'مصدر غير محدد' })
  })
})

describe('productDataLineage', () => {
  it('shows a composite lineage when a file product is later enriched by a marketplace API', () => {
    expect(productDataLineage(
      { platform: 'trendyol', upload_id: 'upload-1', platform_source: 'trendyol_api_v2', last_synced_at: '2026-08-05T10:00:00Z' },
      { id: 'upload-1', platform: 'noon', file_name: 'catalog.xlsx', uploaded_at: '2026-08-04T10:00:00Z' },
    )).toMatchObject({ kind: 'combined', label: 'ملف نون + API Trendyol', fileName: 'catalog.xlsx' })
  })

  it('distinguishes manual products from undocumented legacy products', () => {
    expect(productDataLineage({ platform: '', platform_source: 'manual' })).toMatchObject({ kind: 'manual', label: 'إضافة يدوية' })
    expect(productDataLineage({ platform: '', platform_source: null })).toMatchObject({ kind: 'unknown', label: 'مصدر غير موثق' })
  })
})
