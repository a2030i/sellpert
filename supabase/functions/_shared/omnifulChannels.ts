export type OmnifulChannel = {
  providerChannelId: string
  platformCode: string
  platformName: string
  displayName: string
  sellerRef: string
  storeRef: string
  externalIdentityKey: string
  identityStatus: 'verified' | 'needs_review'
  capabilities: Record<string, boolean>
  raw: Record<string, unknown>
}

const PLATFORM_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  noon: 'Noon',
  trendyol: 'Trendyol',
  salla: 'Salla',
  zid: 'Zid',
  shopify: 'Shopify',
}

export function omnifulChannelRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return objects(payload)
  const root = objectValue(payload)
  const data = root.data
  if (Array.isArray(data)) return objects(data)
  const dataObject = objectValue(data)
  for (const value of [
    dataObject.integrations,
    dataObject.channels,
    dataObject.sales_channels,
    dataObject.items,
    root.integrations,
    root.channels,
    root.sales_channels,
    root.items,
  ]) {
    if (Array.isArray(value)) return objects(value)
  }
  return []
}

export function normalizeOmnifulChannel(row: Record<string, unknown>): OmnifulChannel | null {
  const channel = objectValue(row.sales_channel ?? row.channel ?? row.integration)
  const store = objectValue(row.store)
  const seller = objectValue(row.seller)
  const descriptive = [
    row.platform, row.platform_code, row.sales_channel_tag, row.sales_channel_name,
    row.channel_name, row.name, channel.tag, channel.code, channel.name,
  ].map(clean).filter(Boolean).join(' ')
  const platformCode = platformFromText(descriptive)
  if (!platformCode) return null

  const sellerRef = firstString(
    row.seller_id, row.seller_code, row.seller_ref,
    seller.id, seller.code, seller.reference, seller.name,
  )
  const storeRef = firstString(
    row.store_id, row.store_code, row.store_ref, row.store_name,
    store.id, store.code, store.reference, store.name,
  )
  const providerChannelId = firstString(
    row.integration_id, row.channel_integration_id, row.sales_channel_integration_id,
    row.uuid, row.id, channel.id, channel.uuid,
    storeRef ? `${platformCode}:${storeRef}` : '',
    sellerRef ? `${platformCode}:${sellerRef}` : '',
  )
  if (!providerChannelId) return null

  const stableRef = storeRef || sellerRef
  const platformName = PLATFORM_NAMES[platformCode] || titleCase(platformCode)
  const rawName = firstString(row.display_name, row.store_name, row.name, channel.name)
  const displayName = rawName && rawName.toLowerCase() !== platformCode
    ? `${platformName} — ${rawName}`
    : stableRef ? `${platformName} — ${stableRef}` : platformName

  return {
    providerChannelId,
    platformCode,
    platformName,
    displayName,
    sellerRef,
    storeRef,
    externalIdentityKey: stableRef ? `${platformCode}:${storeRef ? 'store' : 'seller'}:${stableRef}`.toLowerCase() : '',
    identityStatus: stableRef ? 'verified' : 'needs_review',
    capabilities: {
      orders: booleanValue(row.orders_enabled, row.order_sync_enabled, row.sync_orders),
      catalog: booleanValue(row.catalog_enabled, row.catalog_sync_enabled, row.sync_catalog),
      inventory: booleanValue(row.inventory_enabled, row.inventory_sync_enabled, row.sync_inventory),
      returns: booleanValue(row.returns_enabled, row.return_sync_enabled, row.sync_returns),
    },
    raw: row,
  }
}

function platformFromText(value: string): string {
  const text = value.toLowerCase()
  if (text.includes('amazon')) return 'amazon'
  if (text.includes('noon')) return 'noon'
  if (text.includes('trendyol')) return 'trendyol'
  if (text.includes('salla')) return 'salla'
  if (text.includes('zid')) return 'zid'
  if (text.includes('shopify')) return 'shopify'
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
}

function booleanValue(...values: unknown[]) {
  return values.some(value => value === true || value === 1 || String(value).toLowerCase() === 'true')
}
function firstString(...values: unknown[]) { return values.map(clean).find(Boolean) || '' }
function clean(value: unknown) { return String(value ?? '').trim() }
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function objects(value: unknown[]) {
  return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
}
function titleCase(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
