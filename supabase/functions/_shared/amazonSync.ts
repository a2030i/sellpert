// Resumable Amazon SP-API synchronization planning.
//
// Backfill covers 12 months, newest month first, then continues forward.
// Amazon's Orders API allows ~1 request every 3 minutes after a burst of 20,
// and a queue job has under a minute, so every sync run continues from a
// cursor stored in platform_credentials.extra.sync. The cursor holds no
// secrets. Pagination tokens are stored with the exact parameters that
// produced them, because Amazon requires the same arguments on the next page.

import { AMAZON_MARKETPLACES, AMAZON_SP_REGIONS, spApiHeaders, type AmazonSpRegion } from './amazonSpApi.ts'
import { HttpError } from './sync.ts'
import { assertAmazonSarAmounts } from './amazonCurrency.ts'

export const AMAZON_BACKFILL_DAYS = 365
// Backfill walks backwards in 30-day windows so the newest months arrive first.
export const AMAZON_BACKFILL_WINDOW_DAYS = 30
export const AMAZON_FINANCE_WINDOW_DAYS = 180
// Amazon rejects end times later than two minutes before the request.
const SAFE_LAG_MS = 3 * 60_000
const ORDER_OVERLAP_MS = 10 * 60_000
const FINANCE_OVERLAP_MS = 2 * 86_400_000
const DAY_MS = 86_400_000
const ORDER_TOKEN_TTL_MS = DAY_MS

export type AmazonOrderCursor = {
  /** Oldest creation time to backfill. */
  backfill_floor: string
  /** When the backfill started; incremental updates continue from here. */
  backfill_started: string
  /** End of the current backward window (exclusive upper bound). */
  window_end: string
  window_token: string | null
  window_token_created_at: string | null
  backfill_done: boolean
  updated_after: string | null
  updated_before: string | null
  updated_token: string | null
  updated_token_created_at: string | null
}

export type AmazonFinanceCursor = {
  backfill_floor: string
  backfill_started: string
  window_end: string
  window_token: string | null
  backfill_done: boolean
  /** Forward cursor after the backfill. */
  posted_after: string | null
  posted_before: string | null
  token: string | null
  caught_up: boolean
}

export type AmazonSyncState = {
  version: 3
  marketplace_ids: string[]
  next_stream: 'orders' | 'finances'
  finance_market_index: number
  orders: AmazonOrderCursor
  finances_by_marketplace: Record<string, AmazonFinanceCursor>
}

export class AmazonRateLimited extends Error {
  constructor() { super('Amazon rate limit reached') }
}

function supportedMarketplaceIds(marketplaceIds: string[]) {
  const ids = [...new Set(marketplaceIds)].sort()
  if (!ids.length || ids.some(id => !Object.prototype.hasOwnProperty.call(AMAZON_MARKETPLACES, id))) {
    throw new HttpError(400, 'سوق أمازون غير مدعوم')
  }
  return ids
}

export function initialSyncState(now: Date, marketplaceIds: string[]): AmazonSyncState {
  const ids = supportedMarketplaceIds(marketplaceIds)
  const floor = new Date(now.getTime() - AMAZON_BACKFILL_DAYS * DAY_MS).toISOString()
  const started = new Date(now.getTime() - SAFE_LAG_MS).toISOString()
  return {
    version: 3,
    marketplace_ids: ids,
    next_stream: 'orders',
    finance_market_index: 0,
    orders: {
      backfill_floor: floor, backfill_started: started, window_end: started, window_token: null,
      window_token_created_at: null, backfill_done: false,
      updated_after: null, updated_before: null, updated_token: null, updated_token_created_at: null,
    },
    finances_by_marketplace: Object.fromEntries(ids.map(id => [id, {
      backfill_floor: floor, backfill_started: started, window_end: started, window_token: null,
      backfill_done: false, posted_after: null, posted_before: null, token: null, caught_up: false,
    }])),
  }
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}
function nullableDate(value: unknown) { return value === null || validDate(value) }
function nullableToken(value: unknown) { return value === null || (typeof value === 'string' && value.length > 0) }
function validBaseCursor(value: unknown, now: Date): value is Record<string, any> {
  return record(value) && validDate(value.backfill_floor) && validDate(value.backfill_started)
    && validDate(value.window_end) && typeof value.backfill_done === 'boolean' && nullableToken(value.window_token)
    && Date.parse(value.backfill_floor) <= Date.parse(value.window_end)
    && Date.parse(value.window_end) <= Date.parse(value.backfill_started)
    && Date.parse(value.backfill_started) <= now.getTime()
}
function validForward(after: unknown, before: unknown, token: unknown, done: boolean) {
  return nullableDate(after) && nullableDate(before) && nullableToken(token)
    && (!done || validDate(after)) && (token === null || validDate(before))
    && (before === null || (validDate(after) && Date.parse(after) < Date.parse(before as string)))
}

/** Legacy, changed-market and damaged cursors replay idempotently; no invalid token can skip history. */
export function readSyncState(value: unknown, now: Date, marketplaceIds: string[]): AmazonSyncState {
  const ids = supportedMarketplaceIds(marketplaceIds)
  if (record(value) && value.version === 3 && Array.isArray(value.marketplace_ids)
    && JSON.stringify(value.marketplace_ids) === JSON.stringify(ids)
    && ['orders', 'finances'].includes(value.next_stream)
    && Number.isInteger(value.finance_market_index) && value.finance_market_index >= 0 && value.finance_market_index < ids.length
    && validBaseCursor(value.orders, now) && record(value.finances_by_marketplace)) {
    const order = value.orders
    const validOrders = validForward(order.updated_after, order.updated_before, order.updated_token, order.backfill_done)
      && nullableDate(order.window_token_created_at) && nullableDate(order.updated_token_created_at)
      && (order.window_token === null || validDate(order.window_token_created_at))
      && (order.updated_token === null || validDate(order.updated_token_created_at))
    const validFinances = Object.keys(value.finances_by_marketplace).length === ids.length && ids.every(id => {
      const finance = value.finances_by_marketplace[id]
      return validBaseCursor(finance, now) && typeof finance.caught_up === 'boolean'
        && validForward(finance.posted_after, finance.posted_before, finance.token, finance.backfill_done)
    })
    if (validOrders && validFinances) return value as AmazonSyncState
  }
  return initialSyncState(now, ids)
}

/** Start of the backward window that ends at windowEnd. */
function windowStart(windowEnd: string, floor: string) {
  return new Date(Math.max(Date.parse(windowEnd) - AMAZON_BACKFILL_WINDOW_DAYS * DAY_MS, Date.parse(floor))).toISOString()
}

export type OrdersRequest = { params: URLSearchParams; phase: 'backfill' | 'incremental' }

/** The next Orders API request; a window's parameters stay fixed while paging. */
export function nextOrdersRequest(cursor: AmazonOrderCursor, marketplaceIds: string[], now: Date): OrdersRequest {
  const params = new URLSearchParams()
  params.set('marketplaceIds', supportedMarketplaceIds(marketplaceIds).join(','))
  // Never request buyer or recipient data: Sellpert holds no PII roles.
  // Amazon's Swagger 2 array parameters use the default CSV collection format.
  params.set('includedData', 'PROCEEDS,FULFILLMENT')
  params.set('maxResultsPerPage', '100')
  if (!cursor.backfill_done) {
    if (cursor.window_token && (!cursor.window_token_created_at || now.getTime() - Date.parse(cursor.window_token_created_at) >= ORDER_TOKEN_TTL_MS)) {
      cursor.window_token = null
      cursor.window_token_created_at = null
    }
    params.set('createdAfter', windowStart(cursor.window_end, cursor.backfill_floor))
    params.set('createdBefore', cursor.window_end)
    if (cursor.window_token) params.set('paginationToken', cursor.window_token)
    return { params, phase: 'backfill' }
  }
  if (cursor.updated_token && (!cursor.updated_token_created_at || now.getTime() - Date.parse(cursor.updated_token_created_at) >= ORDER_TOKEN_TTL_MS)) {
    cursor.updated_token = null
    cursor.updated_token_created_at = null
  }
  if (!cursor.updated_token || !cursor.updated_before) {
    cursor.updated_before = new Date(now.getTime() - SAFE_LAG_MS).toISOString()
    cursor.updated_token = null
  }
  params.set('lastUpdatedAfter', cursor.updated_after || cursor.backfill_started)
  params.set('lastUpdatedBefore', cursor.updated_before)
  if (cursor.updated_token) params.set('paginationToken', cursor.updated_token)
  return { params, phase: 'incremental' }
}

/** Advances the cursor after a page. Returns true when this phase has no more pages now. */
export function advanceOrders(cursor: AmazonOrderCursor, phase: 'backfill' | 'incremental', nextToken: string | null, now = new Date()) {
  if (phase === 'backfill') {
    if (nextToken) { cursor.window_token = nextToken; cursor.window_token_created_at = now.toISOString(); return false }
    cursor.window_token = null
    cursor.window_token_created_at = null
    const start = windowStart(cursor.window_end, cursor.backfill_floor)
    if (Date.parse(start) <= Date.parse(cursor.backfill_floor)) {
      cursor.backfill_done = true
      // Orders created during the backfill window may have changed while it ran.
      cursor.updated_after = new Date(Date.parse(cursor.backfill_started) - ORDER_OVERLAP_MS).toISOString()
    } else {
      cursor.window_end = start
    }
    return false
  }
  if (nextToken) { cursor.updated_token = nextToken; cursor.updated_token_created_at = now.toISOString(); return false }
  cursor.updated_after = new Date(Date.parse(cursor.updated_before as string) - ORDER_OVERLAP_MS).toISOString()
  cursor.updated_before = null
  cursor.updated_token = null
  cursor.updated_token_created_at = null
  return true
}

/** Next Finances API request: backward 30-day windows, then forward from the backfill start. */
export function nextFinanceRequest(cursor: AmazonFinanceCursor, now: Date, marketplaceId: string) {
  supportedMarketplaceIds([marketplaceId])
  if (!cursor.backfill_done) {
    const params = new URLSearchParams({
      marketplaceId,
      postedAfter: windowStart(cursor.window_end, cursor.backfill_floor),
      postedBefore: cursor.window_end,
    })
    if (cursor.window_token) params.set('nextToken', cursor.window_token)
    return params
  }
  if (!cursor.token || !cursor.posted_before) {
    const after = Date.parse(cursor.posted_after || cursor.backfill_started)
    const end = Math.min(after + AMAZON_FINANCE_WINDOW_DAYS * DAY_MS, now.getTime() - SAFE_LAG_MS)
    cursor.posted_after = new Date(after).toISOString()
    cursor.posted_before = new Date(end).toISOString()
    cursor.token = null
  }
  const params = new URLSearchParams({ marketplaceId, postedAfter: cursor.posted_after as string, postedBefore: cursor.posted_before as string })
  if (cursor.token) params.set('nextToken', cursor.token)
  return params
}

/** Advances the finance cursor. Returns true when caught up to the present for this run. */
export function advanceFinances(cursor: AmazonFinanceCursor, nextToken: string | null, now: Date) {
  if (!cursor.backfill_done) {
    if (nextToken) { cursor.window_token = nextToken; return false }
    cursor.window_token = null
    const start = windowStart(cursor.window_end, cursor.backfill_floor)
    if (Date.parse(start) <= Date.parse(cursor.backfill_floor)) {
      cursor.backfill_done = true
      cursor.posted_after = new Date(Date.parse(cursor.backfill_started) - FINANCE_OVERLAP_MS).toISOString()
    } else {
      cursor.window_end = start
    }
    return false
  }
  if (nextToken) { cursor.token = nextToken; return false }
  const windowEnd = Date.parse(cursor.posted_before as string)
  cursor.token = null
  cursor.posted_before = null
  if (windowEnd >= now.getTime() - SAFE_LAG_MS - 60_000) {
    cursor.caught_up = true
    // Re-read recent days: deferred transactions can be released later.
    cursor.posted_after = new Date(windowEnd - FINANCE_OVERLAP_MS).toISOString()
    return true
  }
  cursor.posted_after = new Date(windowEnd).toISOString()
  return false
}

type Fetch = typeof fetch

export async function spApiGet(accessToken: string, region: AmazonSpRegion, path: string, params: URLSearchParams, fetchImpl: Fetch = fetch, timeoutMs = 20_000) {
  let response: Response
  try {
    response = await fetchImpl(`${AMAZON_SP_REGIONS[region]}${path}?${params}`, {
      headers: spApiHeaders(accessToken),
      signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, Math.floor(timeoutMs)))),
    })
  } catch {
    throw new HttpError(502, 'تعذر الاتصال بأمازون')
  }
  if (response.status === 429) throw new AmazonRateLimited()
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(403, 'لا يوجد إذن كافٍ من أمازون. أعد ربط الحساب أو راجع صلاحيات التطبيق')
  }
  // Provider bodies are not echoed: they can contain request material.
  if (!response.ok) throw new HttpError(502, `أمازون أعاد خطأ (${response.status})`)
  return await response.json().catch(() => { throw new HttpError(502, 'رد أمازون غير مقروء') })
}

function pageError(): never { throw new HttpError(502, 'رد أمازون غير مكتمل؛ لم يتم تقديم مؤشر المزامنة') }
function pageToken(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') pageError()
  return value as string
}
function validMoney(value: unknown) {
  return record(value) && typeof value.currencyCode === 'string' && /^[A-Z]{3}$/.test(value.currencyCode)
    && ['string', 'number'].includes(typeof (value.amount ?? value.currencyAmount))
    && String(value.amount ?? value.currencyAmount).trim() !== ''
    && Number.isFinite(Number(value.amount ?? value.currencyAmount))
}

export function ordersPage(body: unknown) {
  if (!record(body) || body.errors !== undefined || !Array.isArray(body.orders) || (body.pagination !== undefined && !record(body.pagination))) pageError()
  assertAmazonSarAmounts(body.orders)
  for (const order of body.orders) {
    if (!record(order) || typeof order.orderId !== 'string' || !order.orderId
      || !validDate(order.createdTime) || !Array.isArray(order.orderItems)) pageError()
    if (order.proceeds?.grandTotal !== undefined && !validMoney(order.proceeds.grandTotal)) pageError()
    for (const item of order.orderItems) {
      if (!record(item) || typeof item.orderItemId !== 'string' || !item.orderItemId
        || !Number.isInteger(item.quantityOrdered) || item.quantityOrdered < 0 || !record(item.product)) pageError()
      if (item.proceeds?.proceedsTotal !== undefined && !validMoney(item.proceeds.proceedsTotal)) pageError()
    }
  }
  return { orders: body.orders, nextToken: pageToken(body.pagination?.nextToken) }
}

export function financePage(body: unknown) {
  if (!record(body) || body.errors !== undefined || !record(body.payload)) pageError()
  const payload = body.payload
  // Amazon permits an empty page with only nextToken; still follow that token.
  if (payload.transactions !== undefined && !Array.isArray(payload.transactions)) pageError()
  const transactions = payload.transactions || []
  assertAmazonSarAmounts(transactions)
  for (const transaction of transactions) {
    if (!record(transaction) || typeof transaction.transactionId !== 'string' || !transaction.transactionId
      || !validDate(transaction.postedDate) || !validMoney(transaction.totalAmount)) pageError()
  }
  return { transactions, nextToken: pageToken(payload.nextToken) }
}
