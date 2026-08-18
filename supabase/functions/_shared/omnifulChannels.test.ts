import { assertEquals } from 'jsr:@std/assert@1'
import { normalizeOmnifulChannel, omnifulChannelRows } from './omnifulChannels.ts'

Deno.test('extracts Omniful integrations from nested data', () => {
  const rows = omnifulChannelRows({ data: { integrations: [{ id: 'i-1' }] } })
  assertEquals(rows.length, 1)
})

Deno.test('normalizes a verified Trendyol channel', () => {
  const channel = normalizeOmnifulChannel({
    id: 'i-1',
    sales_channel: { name: 'Trendyol MENA' },
    seller_id: '1148158',
    orders_enabled: true,
  })
  assertEquals(channel?.platformCode, 'trendyol')
  assertEquals(channel?.externalIdentityKey, 'trendyol:seller:1148158')
  assertEquals(channel?.identityStatus, 'verified')
  assertEquals(channel?.capabilities.orders, true)
})

Deno.test('marks channels without a seller or store identity for review', () => {
  const channel = normalizeOmnifulChannel({ id: 'i-2', name: 'Amazon Seller Central' })
  assertEquals(channel?.platformCode, 'amazon')
  assertEquals(channel?.identityStatus, 'needs_review')
  assertEquals(channel?.externalIdentityKey, '')
})
