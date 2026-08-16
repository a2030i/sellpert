import { assertEquals } from 'jsr:@std/assert@1'
import {
  isAmazonOmnifulOrder,
  normalizeOmnifulObservation,
  omnifulNextCursor,
  omnifulOrderPlatform,
  omnifulOrderRows,
} from './omnifulOrders.ts'

Deno.test('extracts v2 Omniful rows and cursor', () => {
  const payload = {
    data: { orders: [{ omniful_order_id: 'omni-1', order_id: 'amazon-1' }] },
    meta: { search_after: 'next-page' },
  }
  assertEquals(omnifulOrderRows(payload).length, 1)
  assertEquals(omnifulNextCursor(payload), 'next-page')
})

Deno.test('normalizes an Amazon seller order without changing its payload', () => {
  const raw = {
    omniful_order_id: 'omni-1',
    order_id: '408-1234567-1234567',
    store_name: 'عطارة شمول Amazon SA',
    created_at: '2026-08-15T10:00:00Z',
    sales_channel: { tag: 'amazon_sa', name: 'Amazon Seller Central' },
  }
  assertEquals(isAmazonOmnifulOrder(raw), true)
  assertEquals(normalizeOmnifulObservation(raw), {
    omnifulOrderId: 'omni-1',
    externalOrderId: '408-1234567-1234567',
    salesChannelTag: 'amazon_sa',
    salesChannelName: 'Amazon Seller Central',
    storeName: 'عطارة شمول Amazon SA',
    sourceCreatedAt: '2026-08-15T10:00:00.000Z',
    sourceUpdatedAt: null,
    raw,
  })
})

Deno.test('rejects rows that cannot be safely deduplicated', () => {
  assertEquals(normalizeOmnifulObservation({ omniful_order_id: 'omni-1' }), null)
  assertEquals(isAmazonOmnifulOrder({ sales_channel: { name: 'Noon' } }), false)
})

Deno.test('classifies every marketplace in the Shomool shadow trial', () => {
  assertEquals(omnifulOrderPlatform({ sales_channel: { tag: 'amazon_sa' } }), 'amazon')
  assertEquals(omnifulOrderPlatform({ sales_channel: { name: 'Noon KSA' } }), 'noon')
  assertEquals(omnifulOrderPlatform({ channel_name: 'Trendyol Gulf' }), 'trendyol')
  assertEquals(omnifulOrderPlatform({ sales_channel: { name: 'Salla' } }), null)
})
