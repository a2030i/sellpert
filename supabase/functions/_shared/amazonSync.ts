// Resumable Amazon SP-API synchronization planning.
//
// Amazon's Orders API allows ~1 request every 3 minutes after a burst of 20,
// and a queue job has under a minute, so every sync run continues from a
// cursor stored in platform_credentials.extra.sync. The cursor holds no
// secrets. Pagination tokens are stored with the exact parameters that
// produced them, because Amazon requires the same arguments on the next page.

import { AMAZON_SP_REGIONS, spApiHeaders, type AmazonSpRegion } from './amazonSpApi.ts'
import { HttpError } from './sync.ts'

export const AMAZON_BACKFILL_DAYS = 730
export const AMAZON_FINANCE_WINDOW_DAYS = 180
// Amazon rejects end times later than two minutes before the request.
const SAFE_LAG_MS = 3 * 60_000
const ORDER_OVERLAP_MS = 10 * 60_000
const FINANCE_OVERLAP_MS = 2 * 86_400_000
const DAY_MS = 86_400_000

export type AmazonOrderCursor = {
  backfill_from: string
  backfill_to: string
  backfill_token: string | null
  backfill_done: boolean
  updated_after: string | null
  updated_before: string | null
  updated_token: string | null
}

export type AmazonFinanceCursor = {
  posted_after: string
  posted_before: string | null
  token: string | null
  caught_up: boolean
}

export type AmazonSyncState = { orders: AmazonOrderCursor; finances: AmazonFinanceCursor }

export class AmazonRateLimited extends Error {
  constructor() { super('Amazon rate limit reached') }
}

export function initialSyncState(now: Date): AmazonSyncState {
  const backfillFrom = new Date(now.getTime() - AMAZON_BACKFILL_DAYS * DAY_MS).toISOString()
  return {
    orders: {
      backfill_from: backfillFrom,
      backfill_to: new Date(now.getTime() - SAFE_LAG_MS).toISOString(),
      backfill_token: null,
      backfill_done: false,
      updated_after: null,
      updated_before: null,
      updated_token: null,
    },
    finances: { posted_after: backfillFrom, posted_before: null, token: null, caught_up: false },
  }
}

/** Accepts only a structurally valid stored cursor; anything else restarts safely. */
export function readSyncState(value: unknown, now: Date): AmazonSyncState {
  const state = value as AmazonSyncState
  const validDate = (input: unknown) => typeof input === 'string' && !Number.isNaN(Date.parse(input))
  if (state && state.orders && state.finances
    && validDate(state.orders.backfill_from) && validDate(state.orders.backfill_to)
    && validDate(state.finances.posted_after)) {
    return state
  }
  return initialSyncState(now)
}

export type OrdersRequest = { params: URLSearchParams; phase: 'backfill' | 'incremental' }

/** The next Orders API request for the cursor, freezing the window on its first page. */
export function nextOrdersRequest(cursor: AmazonOrderCursor, marketplaceIds: string[], now: Date): OrdersRequest {
  const params = new URLSearchParams()
  for (const id of marketplaceIds) params.append('marketplaceIds', id)
  // Never request buyer or recipient data: Sellpert holds no PII roles.
  params.append('includedData', 'PROCEEDS')
  params.append('includedData', 'FULFILLMENT')
  params.set('maxResultsPerPage', '100')
  if (!cursor.backfill_done) {
    params.set('createdAfter', cursor.backfill_from)
    params.set('createdBefore', cursor.backfill_to)
    if (cursor.backfill_token) params.set('paginationToken', cursor.backfill_token)
    return { params, phase: 'backfill' }
  }
  if (!cursor.updated_token || !cursor.updated_before) {
    cursor.updated_before = new Date(now.getTime() - SAFE_LAG_MS).toISOString()
    cursor.updated_token = null
  }
  params.set('lastUpdatedAfter', cursor.updated_after || cursor.backfill_to)
  params.set('lastUpdatedBefore', cursor.updated_before)
  if (cursor.updated_token) params.set('paginationToken', cursor.updated_token)
  return { params, phase: 'incremental' }
}

/** Advances the cursor after a page. Returns true when this phase has no more pages now. */
export function advanceOrders(cursor: AmazonOrderCursor, phase: 'backfill' | 'incremental', nextToken: string | null) {
  if (phase === 'backfill') {
    if (nextToken) { cursor.backfill_token = nextToken; return false }
    cursor.backfill_token = null
    cursor.backfill_done = true
    // Orders created inside the backfill window may have changed while it ran.
    cursor.updated_after = new Date(Date.parse(cursor.backfill_to) - ORDER_OVERLAP_MS).toISOString()
    return false
  }
  if (nextToken) { cursor.updated_token = nextToken; return false }
  cursor.updated_after = new Date(Date.parse(cursor.updated_before as string) - ORDER_OVERLAP_MS).toISOString()
  cursor.updated_before = null
  cursor.updated_token = null
  return true
}

/** The next Finances API window (at most 180 days, ending safely before now). */
export function nextFinanceRequest(cursor: AmazonFinanceCursor, now: Date) {
  if (!cursor.token || !cursor.posted_before) {
    const safeEnd = now.getTime() - SAFE_LAG_MS
    const end = Math.min(Date.parse(cursor.posted_after) + AMAZON_FINANCE_WINDOW_DAYS * DAY_MS, safeEnd)
    cursor.posted_before = new Date(end).toISOString()
    cursor.token = null
  }
  const params = new URLSearchParams({ postedAfter: cursor.posted_after, postedBefore: cursor.posted_before as string })
  if (cursor.token) params.set('nextToken', cursor.token)
  return params
}

/** Advances the finance cursor. Returns true when caught up to the present for this run. */
export function advanceFinances(cursor: AmazonFinanceCursor, nextToken: string | null, now: Date) {
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
