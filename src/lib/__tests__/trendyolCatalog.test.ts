import { describe, expect, it } from 'vitest'
import { flattenTrendyolCategories, parseTrendyolAddresses, parseTrendyolAttributes, parseTrendyolAttributeValues, parseTrendyolBrands } from '../trendyolCatalog'

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
