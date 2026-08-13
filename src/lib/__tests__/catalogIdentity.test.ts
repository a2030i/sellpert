import { describe, expect, it } from 'vitest'
import { createCatalogResolver } from '../catalogIdentity'

describe('catalog identity resolver', () => {
  const products = [{ id: 'p1', name: 'ملح إنجليزي 300جم', sku: '6287018622286', barcode: '6287018622286' }]

  it('resolves marketplace codes to the unified catalogue name', () => {
    const resolve = createCatalogResolver(products)
    expect(resolve({ identifiers: ['6287018622286'] })?.name).toBe('ملح إنجليزي 300جم')
  })

  it('uses approved channel aliases without changing source data', () => {
    const resolve = createCatalogResolver(products, [{ product_id: 'p1', source_name: 'English Salt 300g', match_status: 'linked' }])
    expect(resolve({ sourceName: 'English Salt 300g' })?.id).toBe('p1')
  })
})

