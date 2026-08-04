import { describe, expect, it } from 'vitest'
import { parseProductCostRows, preferredProductIdentifier, productCostTemplateCsv } from '../../components/ProductCostImport'
import type { Product } from '../supabase'

describe('product cost import', () => {
  it('recognizes Arabic cost and SKU headers', () => {
    expect(parseProductCostRows([{ 'رمز المنتج': 'SKU-1', 'تكلفة الشراء': 25.5 }])).toEqual([
      { identifier: 'SKU-1', cost_price: '25.5', row: 2 },
    ])
  })

  it('recognizes common English and barcode headers', () => {
    expect(parseProductCostRows([{ Barcode: '628100', 'Cost Price': '12,75' }])).toEqual([
      { identifier: '628100', cost_price: '12,75', row: 2 },
    ])
  })

  it('keeps the source row number for merchant feedback', () => {
    const rows = parseProductCostRows([{ SKU: 'A', Cost: 1 }, { SKU: 'B', Cost: 2 }])
    expect(rows.map(row => row.row)).toEqual([2, 3])
  })

  it('builds a merchant-ready template from only products missing costs', () => {
    const products = [
      { id:'1', name:'قهوة, عربية', sku:'COFFEE-1', cost_price:0 },
      { id:'2', name:'شاي', sku:'', barcode:'6281002', cost_price:0 },
      { id:'3', name:'تم احتسابه', sku:'DONE-1', cost_price:12 },
    ] as Product[]

    const csv = productCostTemplateCsv(products)
    expect(csv).toContain('اسم المنتج,SKU,تكلفة الشراء')
    expect(csv).toContain('"قهوة, عربية",COFFEE-1,')
    expect(csv).toContain('شاي,6281002,')
    expect(csv).not.toContain('DONE-1')
  })

  it('uses the first usable marketplace identifier for quick entry', () => {
    expect(preferredProductIdentifier({ sku:'', barcode:' 6281003 ', asin:'A1' } as Product)).toBe('6281003')
  })
})
