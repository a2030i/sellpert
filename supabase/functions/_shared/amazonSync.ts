// Resumable Amazon SP-API synchronization planning.
//
// Backfill covers 12 months, newest month first, then continues forward.
// Amazon's Orders API allows ~1 request every 3 minutes after a burst of 20,
// and a queue job has under a minute, so every sync run continues from a
// cursor stored in platform_credentials.extra.sync. The cursor holds no
// secrets. Pagination tokens are stored with the exact parameters that
// produced them, because Amazon requires the same arguments on the next page.

import { AMAZON_SP_REGIONS, spApiHeaders, type AmazonSpRegion } from './amazonSpApi.ts'
import { HttpError } from './sync.ts'

export const AMAZON_BACKFILL_DAYS = 365
// Backfill walks backwards in 30-day windows so the newest months arrive first.
export const AMAZON_BACKFILL_WINDOW_DAYS = 30
export const AMAZON_FINANCE_WINDOW_DAYS = 180
// Amazon rejects end times later than two minutes before the request.
const SAFE_LAG_MS = 3 * 60_000
const ORDER_OVERLAP_MS = 10 * 60_000
const FINANCE_OVERLAP_MS = 2 * 86_400_000
const DAY_MS = 86_400_000

export type AmazonOrderCursor = {
  /** Oldest creation time to backfill. */
  backfill_floor: string
  /** When the backfill started; incremental updates continue from here. */
  backfill_started: string
  /** End of the current backward window (exclusive upper bound). */
  window_end: string
  window_token: string | null
  backfill_done: boolean
  updated_after: string | null
  updated_before: string | null
  updated_token: string | null
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

export type AmazonSyncState = { version: 2; orders: AmazonOrderCursor; finances: AmazonFinanceCursor }

export class AmazonRateLimited extends Error {
  constructor() { super('Amazon rate limit reached') }
}

export function initialSyncState(now: Date): AmazonSyncState {
  const floor = new Date(now.getTime() - AMAZON_BACKFILL_DAYS * DAY_MS).toISOString()
  const started = new Date(now.getTime() - SAFE_LAG_MS).toISOString()
  return {
    version: 2,
    orders: {
      backfill_floor: floor, backfill_started: started, window_end: started, window_token: null,
      backfill_done: false, updated_after: null, updated_before: null, updated_token: null,
    },
    finances: {
      backfill_floor: floor, backfill_started: started, window_end: started, window_token: null,
      backfill_done: false, posted_after: null, posted_before: null, token: null, caught_up: false,
    },
  }
}

/** Accepts only a structurally valid stored cursor; anything else restarts safely. */
export function readSyncState(value: unknown, now: Date): AmazonSyncState {
  const state = value as AmazonSyncState
  const validDate = (input: unknown) => typeof input === 'string' && !Number.isNaN(Date.parse(input))
  if (state?.version === 2 && state.orders && state.finances
    && validDate(state.orders.backfill_floor) && validDate(state.orders.window_end)
    && validDate(state.finances.backfill_floor) && validDate(state.finances.window_end)) {
    return state
  }
  return initialSyncState(now)
}

/** Start of the backward window that ends at windowEnd. */
function windowStart(windowEnd: string, floor: string) {
  return new Date(Math.max(Date.parse(windowEnd) - AMAZON_BACKFILL_WINDOW_DAYS * DAY_MS, Date.parse(floor))).toISOString()
}

export type OrdersRequest = { params: URLSearchParams; phase: 'backfill' | 'incremental' }

/** The next Orders API request; a window's parameters stay fixed while paging. */
export function nextOrdersRequest(cursor: AmazonOrderCursor, marketplaceIds: string[], now: Date): OrdersRequest {
  const params = new URLSearchParams()
  for (const id of marketplaceIds) params.append('marketplaceIds', id)
  // Never request buyer or recipient data: Sellpert holds no PII roles.
  params.append('includedData', 'PROCEEDS')
  params.append('includedData', 'FULFILLMENT')
  params.set('maxResultsPerPage', '100')
  if (!cursor.backfill_done) {
    params.set('createdAfter', windowStart(cursor.window_end, cursor.backfill_floor))
    params.set('createdBefore', cursor.window_end)
    if (cursor.window_token) params.set('paginationToken', cursor.window_token)
    return { params, phase: 'backfill' }
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
export function advanceOrders(cursor: AmazonOrderCursor, phase: 'backfill' | 'incremental', nextToken: string | null) {
  if (phase === 'backfill') {
    if (nextToken) { cursor.window_token = nextToken; return false }
    cursor.window_token = null
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
  if (nextToken) { cursor.updated_token = nextToken; return false }
  cursor.updated_after = new Date(Date.parse(cursor.updated_before as string) - ORDER_OVERLAP_MS).toISOString()
  cursor.updated_before = null
  cursor.updated_token = null
  return true
}

/** Next Finances API request: backward 30-day windows, then forward from the backfill start. */
export function nextFinanceRequest(cursor: AmazonFinanceCursor, now: Date) {
  if (!cursor.backfill_done) {
    const params = new URLSearchParams({
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
  const params = new URLSearchParams({ postedAfter: cursor.posted_after as string, postedBefore: cursor.posted_before as string })
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

export async function spApiGet(accessToken: string, region: AmazonSpRegion, path: string, params: URLSearchParams, fetchImpl: Fetch = fetch) {
  let response: Response
  try {
    response = await fetchImpl(`${AMAZON_SP_REGIONS[region]}${path}?${params}`, {
      headers: spApiHeaders(accessToken),
      signal: AbortSignal.timeout(20_000),
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

export function ordersPage(body: any) {
  return {
    orders: Array.isArray(body?.orders) ? body.orders : [],
    nextToken: typeof body?.pagination?.nextToken === 'string' && body.pagination.nextToken ? body.pagination.nextToken : null,
  }
}

export function financePage(body: any) {
  const payload = body?.payload || {}
  return {
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
    nextToken: typeof payload.nextToken === 'string' && payload.nextToken ? payload.nextToken : null,
  }
}
