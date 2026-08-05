import { describe, expect, it } from 'vitest'
import { flattenTrendyolCategories, parseTrendyolAddresses, parseTrendyolAttributes, parseTrendyolAttributeValues, parseTrendyolBrands, trendyolCatalogReadiness } from '../trendyolCatalog'

describe('Trendyol catalogue responses', () => {
  it('shows merchant names while preserving internal IDs', () => {
    expect(parseTrendyolBrands({ brands:[{ id:7, name:'علامة' }] })).toEqual([{ id:7, name:'علامة' }])
    expect(flattenTrendyolCategories({ categories:[{ id:1, name:'رئيسية', subCategories:[{ id:2, name:'نهائية', subCategories:[] }] }] }))
      .toEqual([{ id:2, name:'نهائية', path:'رئيسية ← نهائية' }])
  })

  it('normalizes v1 and v2 attribute response shapes', () => {
    expect(parseTrendyolAttributes({ categoryAttributes:[{
      attribute:{ id:14, name:'المادة' }, required:true, allowCustom:false,
      attributeValues:[{ id:82, name:'جلد' }],
    }] })).toEqual([{ id:14, name:'المادة', required:true, allowCustom:false, allowMultiple:false, values:[{ id:82, name:'جلد' }] }])
    expect(parseTrendyolAttributeValues({ content:[{ attributeValueId:4, attributeValue:'كبير' }] }))
      .toEqual([{ id:4, name:'كبير' }])
  })

  it('labels addresses by merchant-readable text', () => {
    expect(parseTrendyolAddresses({ shipmentAddresses:[{ id:3, addressName:'مستودع الرياض', city:'الرياض' }], returningAddresses:[{ id:4, fullAddress:'جدة' }] }))
      .toEqual([{ id:3, name:'مستودع الرياض، الرياض', type:'shipment' }, { id:4, name:'جدة', type:'return' }])
  })
})

describe('Trendyol catalogue bulk readiness', () => {
  const product = { id:'p1', status:'active', barcode:'8690001', sku:'SKU-1', platform_source:'trendyol_api_v2', sale_price:54, msrp:60 }

  it('builds the documented price and inventory item for a linked product', () => {
    expect(trendyolCatalogReadiness(product, { sku:'SKU-1', quantity:7 }, { delivery_status:'success' })).toEqual({
      ready:true,
      linked:true,
      pending:false,
      reason:null,
      item:{ barcode:'8690001', quantity:7, salePrice:54, listPrice:60 },
    })
  })

  it('uses the calculated marketplace price and never lowers list price below it', () => {
    const result = trendyolCatalogReadiness({ ...product, msrp:40 }, { quantity:3 }, { delivery_status:'success' }, 65)
    expect(result.item).toEqual({ barcode:'8690001', quantity:3, salePrice:65, listPrice:65 })
  })

  it('blocks unlinked, pending and inventory-less products with merchant guidance', () => {
    expect(trendyolCatalogReadiness({ ...product, platform_source:null }, { quantity:1 }, undefined).reason).toContain('نشره')
    expect(trendyolCatalogReadiness(product, { quantity:1 }, { delivery_status:'processing' }).reason).toContain('قيد المعالجة')
    expect(trendyolCatalogReadiness(product, { quantity:1 }, { delivery_status:'failed', catalog_status:'rejected' }).reason).toContain('اعتماد المنتج')
    expect(trendyolCatalogReadiness(product, null, { delivery_status:'success' }).reason).toContain('المخزون')
  })
})
