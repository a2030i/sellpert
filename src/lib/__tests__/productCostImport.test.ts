import { describe, expect, it } from 'vitest'
import { parseProductCostRows } from '../../components/ProductCostImport'

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
})
