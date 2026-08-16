export type OmnifulObservation = {
  omnifulOrderId: string
  externalOrderId: string
  salesChannelTag: string
  salesChannelName: string
  storeName: string
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  raw: Record<string, unknown>
}

export type OmnifulMarketplace = 'amazon' | 'noon' | 'trendyol'

export function omnifulOrderRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as Record<string, unknown>
  const direct = body.data
  if (Array.isArray(direct)) return direct.filter(isRecord)
  if (isRecord(direct)) {
    for (const key of ['orders', 'items', 'results', 'records']) {
      const rows = direct[key]
      if (Array.isArray(rows)) return rows.filter(isRecord)
    }
  }
  for (const key of ['orders', 'items', 'results', 'records']) {
    const rows = body[key]
    if (Array.isArray(rows)) return rows.filter(isRecord)
  }
  return []
}

export function omnifulNextCursor(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const body = payload as Record<string, unknown>
  const meta = isRecord(body.meta) ? body.meta : {}
  const pagination = isRecord(meta.pagination) ? meta.pagination : {}
  return firstString(
    meta.next_cursor,
    meta.search_after,
    pagination.next_cursor,
    pagination.search_after,
    body.next_cursor,
    body.search_after,
  )
}

export function normalizeOmnifulObservation(row: Record<string, unknown>): OmnifulObservation | null {
  const channel = isRecord(row.sales_channel) ? row.sales_channel : {}
  const store = isRecord(row.store) ? row.store : {}
  const seller = isRecord(row.seller) ? row.seller : {}
  const omnifulOrderId = firstString(row.omniful_order_id, row.id, row.uuid)
  const externalOrderId = firstString(
    row.order_id,
    row.sales_channel_order_id,
    row.seller_sales_channel_order_id,
    row.order_alias,
  )
  if (!omnifulOrderId || !externalOrderId) return null

  return {
    omnifulOrderId,
    externalOrderId,
    salesChannelTag: firstString(channel.tag, channel.code, row.sales_channel_tag, row.channel),
    salesChannelName: firstString(channel.name, row.sales_channel_name, row.channel_name),
    storeName: firstString(row.store_name, store.name, store.code, seller.name, seller.code),
    sourceCreatedAt: isoDate(row.created_at ?? row.order_created_at),
    sourceUpdatedAt: isoDate(row.updated_at ?? row.order_updated_at),
    raw: row,
  }
}

export function isAmazonOmnifulOrder(row: Record<string, unknown>): boolean {
  return omnifulOrderPlatform(row) === 'amazon'
}

export function omnifulOrderPlatform(row: Record<string, unknown>): OmnifulMarketplace | null {
  const channel = isRecord(row.sales_channel) ? row.sales_channel : {}
  const values = [
    channel.tag,
    channel.name,
    channel.code,
    row.sales_channel_tag,
    row.sales_channel_name,
    row.channel,
    row.channel_name,
  ].map(value => String(value ?? '').trim().toLowerCase())
  if (values.some(value => value.includes('amazon'))) return 'amazon'
  if (values.some(value => value.includes('noon'))) return 'noon'
  if (values.some(value => value.includes('trendyol') || value.includes('trendy ol'))) return 'trendyol'
  return null
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value as string | number)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
