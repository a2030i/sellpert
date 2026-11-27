import { describe, expect, it } from 'vitest'
import { createCatalogResolver } from '../catalogIdentity'

describe('catalog identity resolver', () => {
  const products = [{ id: 'p1', name: 'ملح إنجليزي 300جم', sku: '6287018622286', barcode: '6287018622286' }]

  it('resolves marketplace codes to the unified catalogue name', () => {
    const resolve = createCatalogResolver(products)
    expect(resolve({ identifiers: ['6287018622286'] })?.name).toBe('ملح إنجليزي 300جم')
  })

  it('never merges sellable variants by name alone', () => {
    const resolve = createCatalogResolver(products, [{ product_id: 'p1', source_name: 'English Salt 300g', match_status: 'linked' }])
    expect(resolve({ sourceName: 'English Salt 300g' })).toBeUndefined()
  })
})


it('isolates exact aliases by platform and selling account, including ambiguous identifiers', () => {
  const products = [{id:'red',name:'shirt',sku:'R'}, {id:'blue',name:'shirt',sku:'B'}]
  const resolve = createCatalogResolver(products, [
    {product_id:'red', platform:'amazon', marketplace_account_id:'one', identifier_value:'same',match_status:'linked'},
    {product_id:'blue', platform:'amazon', marketplace_account_id:'two', identifier_value:'same',match_status:'linked'},
    {product_id:'blue', platform:'noon', identifier_value:'legacy',match_status:'linked'},
  ])
  expect(resolve({platform:'amazon',marketplace_account_id:'one',identifiers:['same']})?.id).toBe('red')
  expect(resolve({platform:'amazon',marketplace_account_id:'two',identifiers:['same']})?.id).toBe('blue')
  expect(resolve({platform:'amazon',identifiers:['same']})).toBeUndefined()
  expect(resolve({platform:'amazon',identifiers:['legacy']})).toBeUndefined()
  expect(resolve({identifiers:['R','B']})).toBeUndefined()
  expect(resolve({identifiers:['r']})).toBeUndefined()
  expect(resolve({sourceName:'shirt'})).toBeUndefined()
})
