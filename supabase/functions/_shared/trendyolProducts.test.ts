import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { normalizeTrendyolDeliveryUpdate, normalizeTrendyolProductCreateV2, normalizeTrendyolV2Products } from './trendyolProducts.ts'

Deno.test('Product Create V2 keeps only the supported normalized merchant fields', () => {
  const result = normalizeTrendyolProductCreateV2({ items:[{
    barcode:'AR-123', title:'منتج عربي', productMainId:'MODEL-1', brandId:'12', categoryId:34,
    quantity:'7', stockCode:'SKU-1', description:'وصف واضح', listPrice:'60', salePrice:'54', vatRate:'20',
    images:[{ url:'https://cdn.example.com/1.jpg' }],
    attributes:[
      { attributeId:1, attributeValueIds:['10', 11] },
      { attributeId:2, attributeValue:'قيمة مخصصة' },
    ],
    origin:'sa', shipmentAddressId:'88', returningAddressId:89,
    deliveryOption:{ deliveryDuration:'1', fastDeliveryType:'fast_delivery' },
    attackerControlledField:'discard me',
  }] }) as any

  assertEquals(result.items[0], {
    barcode:'AR-123', title:'منتج عربي', productMainId:'MODEL-1', brandId:12, categoryId:34,
    quantity:7, stockCode:'SKU-1', description:'وصف واضح', listPrice:60, salePrice:54, vatRate:20,
    images:[{ url:'https://cdn.example.com/1.jpg' }],
    attributes:[
      { attributeId:1, attributeValueIds:[10, 11] },
      { attributeId:2, attributeValue:'قيمة مخصصة' },
    ],
    origin:'SA', shipmentAddressId:88, returningAddressId:89,
    deliveryOption:{ deliveryDuration:1, fastDeliveryType:'FAST_DELIVERY' },
  })
})

Deno.test('Product Create V2 rejects unsafe or commercially invalid payloads', () => {
  const base = {
    barcode:'BAR-1', title:'Product', productMainId:'MODEL-1', brandId:1, categoryId:2,
    quantity:1, stockCode:'SKU-1', description:'Description', listPrice:60, salePrice:54, vatRate:20,
    images:[{ url:'https://cdn.example.com/1.jpg' }], attributes:[],
  }
  assertThrows(() => normalizeTrendyolProductCreateV2({ items:[{ ...base, barcode:'bad barcode' }] }), Error, 'دون مسافات')
  assertThrows(() => normalizeTrendyolProductCreateV2({ items:[{ ...base, images:[{ url:'http://cdn.example.com/1.jpg' }] }] }), Error, 'HTTPS')
  assertThrows(() => normalizeTrendyolProductCreateV2({ items:[{ ...base, listPrice:50 }] }), Error, 'سعر البيع')
  assertThrows(() => normalizeTrendyolProductCreateV2({ items:[{ ...base, attributes:[{ attributeId:1 }] }] }), Error, 'اختر قيمة')
})

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

Deno.test('delivery update accepts merchant options and rejects inconsistent fast delivery', () => {
  assertEquals(normalizeTrendyolDeliveryUpdate({ items:[{
    barcode:'BAR-1', deliveryOptions:{ deliveryDuration:1, fastDeliveryType:'FAST_DELIVERY' },
  }] }), { items:[{ barcode:'BAR-1', deliveryOptions:{ deliveryDuration:1, fastDeliveryType:'FAST_DELIVERY' } }] })
  assertEquals(normalizeTrendyolDeliveryUpdate({ items:[{
    barcode:'BAR-2', deliveryOptions:{ deliveryDuration:3, fastDeliveryType:null },
  }] }), { items:[{ barcode:'BAR-2', deliveryOptions:{ deliveryDuration:3, fastDeliveryType:null } }] })
  assertThrows(() => normalizeTrendyolDeliveryUpdate({ items:[{
    barcode:'BAR-3', deliveryOptions:{ deliveryDuration:2, fastDeliveryType:'SAME_DAY_SHIPPING' },
  }] }), Error, 'مدة تجهيز يوم واحد')
})
