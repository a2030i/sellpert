import { assertEquals } from 'jsr:@std/assert'
import {
  amazonFeeByOrder,
  amazonRequestHeaders,
  mapAmazonFinancialTransaction,
  mapAmazonOrder,
  mapAmazonOrderItems,
  mapAmazonPackages,
} from './amazonOrders.ts'

const sample = {
  orderId: 'ORDER-1',
  createdTime: '2026-08-01T10:00:00Z',
  lastUpdatedTime: '2026-08-02T10:00:00Z',
  fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'MERCHANT' },
  proceeds: { grandTotal: { amount: '54.00', currencyCode: 'SAR' } },
  recipient: { deliveryAddress: { name: 'Customer', city: 'Riyadh', countryCode: 'SA' } },
  orderItems: [{
    orderItemId: 'LINE-1', quantityOrdered: 2,
    product: { asin: 'B012345678', sellerSku: 'SKU-1', title: 'Product', price: { unitPrice: { amount: '27', currencyCode: 'SAR' } } },
    proceeds: { proceedsTotal: { amount: '54', currencyCode: 'SAR' }, breakdowns: [{ type: 'DISCOUNT', subtotal: { amount: '-2', currencyCode: 'SAR' } }] },
  }],
  packages: [{ packageReferenceId: 'PKG-1', packageStatus: { status: 'IN_TRANSIT' }, carrier: 'Carrier', trackingNumber: 'TRACK-1', packageItems: [{ orderItemId: 'LINE-1', quantity: 2 }] }],
}

Deno.test('maps the official Amazon Orders 2026 model without estimating fees', () => {
  const order = mapAmazonOrder(sample, 'MERCHANT-1', '2026-08-03T00:00:00Z')!
  assertEquals(order.status, 'shipped')
  assertEquals(order.total_amount, 54)
  assertEquals(order.platform_fee, 0)
  assertEquals(order.customer_city, 'Riyadh')
  assertEquals(order.cargo_tracking_number, 'TRACK-1')
  assertEquals(order.fulfillment_model, 'MERCHANT')
})

Deno.test('maps Amazon items and packages for order details', () => {
  const [item] = mapAmazonOrderItems(sample, 'MERCHANT-1')
  const [pkg] = mapAmazonPackages(sample, 'MERCHANT-1')
  assertEquals(item.content_id, 'B012345678')
  assertEquals(item.unit_price, 27)
  assertEquals(pkg.shipment_package_id, 'PKG-1')
  assertEquals(pkg.quantity, 2)
  assertEquals(pkg.status, 'shipped')
})

Deno.test('adds every required Amazon request header', () => {
  const headers = amazonRequestHeaders('TOKEN', new Date('2026-08-03T12:34:56Z'))
  assertEquals(headers['x-amz-access-token'], 'TOKEN')
  assertEquals(headers['x-amz-date'], '20260803T123456Z')
  assertEquals(headers['user-agent'].startsWith('Sellpert/'), true)
})

Deno.test('uses Amazon Finances breakdowns as the authoritative order fee', () => {
  const transaction = {
    transactionId: 'TX-1', postedDate: '2026-08-03T00:00:00Z', transactionType: 'Shipment', transactionStatus: 'RELEASED',
    relatedIdentifiers: [{ relatedIdentifierName: 'ORDER_ID', relatedIdentifierValue: 'ORDER-1' }],
    totalAmount: { currencyAmount: 47.79, currencyCode: 'SAR' },
    breakdowns: [
      { breakdownType: 'Sales', breakdownAmount: { currencyAmount: 54, currencyCode: 'SAR' } },
      { breakdownType: 'Expenses', breakdownAmount: { currencyAmount: -6.21, currencyCode: 'SAR' }, breakdowns: [
        { breakdownType: 'CommissionFee', breakdownAmount: { currencyAmount: -6.21, currencyCode: 'SAR' } },
      ] },
    ],
  }
  const row = mapAmazonFinancialTransaction(transaction, 'MERCHANT-1')!
  assertEquals(row.net_amount, 47.79)
  assertEquals(row.order_id, 'ORDER-1')
  assertEquals(amazonFeeByOrder([transaction]).get('ORDER-1'), 6.21)
})
