import { assertEquals } from 'jsr:@std/assert'
import { normalizeTrendyolV2Products } from './trendyolProducts.ts'

Deno.test('Product V2 normalization preserves Arabic content and variant financials', () => {
  const result = normalizeTrendyolV2Products('M-1', [{
    contentId: 42,
    productMainId: 'MODEL-1',
    title: 'منتج عربي',
    description: 'وصف عربي',
    brand: { name: 'علامة' },
    category: { name: 'فئة' },
    images: [{ url: 'https://cdn.example/product.jpg' }],
    variants: [{
      variantId: 7, barcode: 'BAR-1', stockCode: 'SKU-1', commission: 6.21,
      vatRate: 15, onSale: true, archived: false, blacklisted: false,
      stock: { quantity: 8 }, price: { salePrice: 54, listPrice: 60 },
    }],
  }], [], '2026-08-04T00:00:00.000Z')

  assertEquals(result.approvedVariants, 1)
  assertEquals(result.products[0].name, 'منتج عربي')
  assertEquals(result.products[0].commission_rate, 6.21)
  assertEquals(result.products[0].sale_price, 54)
  assertEquals(result.products[0].msrp, 60)
  assertEquals(result.inventory[0].quantity, 8)
  assertEquals(result.inventory[0].is_active, true)
})

Deno.test('approved Product V2 variant wins over a duplicate rejected barcode', () => {
  const result = normalizeTrendyolV2Products('M-1', [{
    contentId: 8, title: 'Approved', variants: [{ barcode: 'BAR-2', stockCode: 'SKU-2', onSale: true }],
  }], [{
    barcode: 'BAR-2', stockCode: 'SKU-2', title: 'Rejected', status: 'rejected', quantity: 2,
    rejectReasonDetails: [{ rejectReason: 'صورة غير صالحة' }],
  }], '2026-08-04T00:00:00.000Z')

  assertEquals(result.products.length, 1)
  assertEquals(result.products[0].name, 'Approved')
  assertEquals(result.products[0].status, 'active')
  assertEquals(result.approvedVariants, 1)
  assertEquals(result.unapprovedVariants, 1)
})

