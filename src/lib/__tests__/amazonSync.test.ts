import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AMAZON_FINANCE_WINDOW_DAYS,
  advanceFinances,
  advanceOrders,
  financePage,
  initialSyncState,
  nextFinanceRequest,
  nextOrdersRequest,
  ordersPage,
  readSyncState,
  spApiGet,
  AmazonRateLimited,
} from '../../../supabase/functions/_shared/amazonSync'
import { amazonFeeByOrder, mapAmazonOrder, mapAmazonOrderItems } from '../../../supabase/functions/_shared/amazonOrders'

const now = new Date('2026-11-27T12:00:00Z')
const DAY = 86_400_000
const SA = 'A17E79C6D8DWNP'
const AE = 'A2VIGQ35RCS4UG'
const transaction = {transactionId:'t',postedDate:'2026-11-20T10:00:00Z',totalAmount:{currencyAmount:115,currencyCode:'SAR'}}

describe('Amazon order cursor', () => {
  it('starts with the newest 30 days and never requests buyer or recipient data', () => {
    const state = initialSyncState(now, [SA])
    const { params, phase } = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    expect(phase).toBe('backfill')
    const before = Date.parse(params.get('createdBefore') as string)
    expect(before).toBeLessThan(now.getTime() - 2 * 60_000)
    expect(before - Date.parse(params.get('createdAfter') as string)).toBe(30 * DAY)
    expect(params.getAll('includedData')).toEqual(['PROCEEDS,FULFILLMENT'])
    expect(params.getAll('marketplaceIds')).toEqual(['A17E79C6D8DWNP'])
  })

  it('pages inside a fixed window, then walks back month by month to 12 months', () => {
    const state = initialSyncState(now, [SA])
    const first = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    advanceOrders(state.orders, first.phase, 'token-2', now)
    const second = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], new Date(now.getTime() + 600_000))
    expect(second.params.get('createdBefore')).toBe(first.params.get('createdBefore'))
    expect(second.params.get('paginationToken')).toBe('token-2')

    advanceOrders(state.orders, 'backfill', null)
    const older = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    expect(older.params.get('createdBefore')).toBe(first.params.get('createdAfter'))
    expect(older.params.has('paginationToken')).toBe(false)

    let windows = 2
    while (!state.orders.backfill_done && windows < 50) {
      advanceOrders(state.orders, 'backfill', null)
      if (!state.orders.backfill_done) windows++
    }
    expect(state.orders.backfill_done).toBe(true)
    expect(windows).toBe(13)
    const oldest = Date.parse(state.orders.backfill_floor)
    expect(now.getTime() - oldest).toBe(365 * DAY)

    const incremental = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    expect(incremental.phase).toBe('incremental')
    expect(Date.parse(incremental.params.get('lastUpdatedAfter') as string))
      .toBeLessThan(Date.parse(state.orders.backfill_started))
    expect(advanceOrders(state.orders, 'incremental', null)).toBe(true)
  })

  it('restarts safely from a damaged or older stored cursor', () => {
    expect(readSyncState({ orders: { backfill_from: 'nope' } }, now, [SA])).toEqual(initialSyncState(now, [SA]))
    expect(readSyncState({ orders: {}, finances: {} }, now, [SA]).version).toBe(3)
  })
})

describe('Amazon finance cursor', () => {
  it('backfills newest months first, then moves forward from the backfill start', () => {
    const state = initialSyncState(now, [SA])
    const first = nextFinanceRequest(state.finances_by_marketplace[SA], now, SA)
    expect(Date.parse(first.get('postedBefore') as string) - Date.parse(first.get('postedAfter') as string)).toBe(30 * DAY)
    advanceFinances(state.finances_by_marketplace[SA], null, now)
    expect(nextFinanceRequest(state.finances_by_marketplace[SA], now, SA).get('postedBefore')).toBe(first.get('postedAfter'))
    let guard = 0
    while (!state.finances_by_marketplace[SA].backfill_done && guard++ < 50) {
      nextFinanceRequest(state.finances_by_marketplace[SA], now, SA)
      advanceFinances(state.finances_by_marketplace[SA], null, now)
    }
    expect(state.finances_by_marketplace[SA].backfill_done).toBe(true)
    const forward = nextFinanceRequest(state.finances_by_marketplace[SA], now, SA)
    expect(Date.parse(forward.get('postedAfter') as string)).toBeLessThan(Date.parse(state.finances_by_marketplace[SA].backfill_started))
    const span = Date.parse(forward.get('postedBefore') as string) - Date.parse(forward.get('postedAfter') as string)
    expect(span).toBeLessThanOrEqual(AMAZON_FINANCE_WINDOW_DAYS * DAY)
    expect(advanceFinances(state.finances_by_marketplace[SA], null, now)).toBe(true)
    expect(state.finances_by_marketplace[SA].caught_up).toBe(true)
  })

  it('reuses the frozen window while following nextToken', () => {
    const state = initialSyncState(now, [SA])
    const first = nextFinanceRequest(state.finances_by_marketplace[SA], now, SA)
    advanceFinances(state.finances_by_marketplace[SA], 'next-1', now)
    const second = nextFinanceRequest(state.finances_by_marketplace[SA], new Date(now.getTime() + 60_000), SA)
    expect(second.get('postedBefore')).toBe(first.get('postedBefore'))
    expect(second.get('nextToken')).toBe('next-1')
  })
})

describe('Amazon persisted cursor boundaries', () => {
  it('serializes multi-market Orders filters once and isolates finance pagination by market', () => {
    const state = initialSyncState(now, [AE, SA])
    const params = nextOrdersRequest(state.orders, [AE, SA], now).params
    expect(params.getAll('marketplaceIds')).toEqual([[SA, AE].sort().join(',')])
    expect(params.getAll('includedData')).toEqual(['PROCEEDS,FULFILLMENT'])
    const sa = state.finances_by_marketplace[SA]
    advanceFinances(sa, 'sa-only-token', now)
    expect(nextFinanceRequest(sa, now, SA).get('marketplaceId')).toBe(SA)
    expect(nextFinanceRequest(sa, now, SA).get('nextToken')).toBe('sa-only-token')
    expect(nextFinanceRequest(state.finances_by_marketplace[AE], now, AE).get('marketplaceId')).toBe(AE)
    expect(nextFinanceRequest(state.finances_by_marketplace[AE], now, AE).has('nextToken')).toBe(false)
    expect(readSyncState(state, now, [AE, SA])).toEqual(state)
    expect(readSyncState(state, now, [SA])).toEqual(initialSyncState(now, [SA]))
  })

  it('replays an expired Orders token without advancing past its unfinished window', () => {
    const state = initialSyncState(now, [SA])
    const first = nextOrdersRequest(state.orders, [SA], now).params
    advanceOrders(state.orders, 'backfill', 'expired-page', now)
    expect(nextOrdersRequest(state.orders, [SA], new Date(now.getTime() + DAY - 1)).params.get('paginationToken')).toBe('expired-page')
    const replay = nextOrdersRequest(state.orders, [SA], new Date(now.getTime() + DAY)).params
    expect(replay.has('paginationToken')).toBe(false)
    expect(replay.get('createdAfter')).toBe(first.get('createdAfter'))
    expect(replay.get('createdBefore')).toBe(first.get('createdBefore'))
  })

  it('keeps the unfinished incremental lower bound when its token expires', () => {
    const state = initialSyncState(now, [SA])
    while (!state.orders.backfill_done) advanceOrders(state.orders, 'backfill', null, now)
    const first = nextOrdersRequest(state.orders, [SA], now).params
    advanceOrders(state.orders, 'incremental', 'expired-incremental-page', now)
    const replay = nextOrdersRequest(state.orders, [SA], new Date(now.getTime() + DAY)).params
    expect(replay.has('paginationToken')).toBe(false)
    expect(replay.get('lastUpdatedAfter')).toBe(first.get('lastUpdatedAfter'))
    expect(Date.parse(replay.get('lastUpdatedBefore') as string)).toBeGreaterThan(Date.parse(first.get('lastUpdatedBefore') as string))
  })

  it.each([
    (state: any) => { delete state.orders.backfill_started },
    (state: any) => { state.orders.backfill_done = 'false' },
    (state: any) => { state.orders.updated_token = 'token-without-window' },
    (state: any) => { state.orders.window_end = '2024-01-01T00:00:00Z' },
    (state: any) => { state.finances_by_marketplace[SA].posted_after = 'not-a-date' },
    (state: any) => { state.finances_by_marketplace[SA].caught_up = 1 },
    (state: any) => { state.next_stream = 'unknown' },
    (state: any) => { state.finance_market_index = 1 },
  ])('restarts a malformed persisted cursor rather than skipping a range', mutate => {
    const state = initialSyncState(now, [SA])
    mutate(state)
    expect(readSyncState(state, now, [SA])).toEqual(initialSyncState(now, [SA]))
  })

  it('preserves the next stream and marketplace to resume fairly after throttling', () => {
    const state = initialSyncState(now, [SA, AE])
    state.next_stream = 'finances'
    state.finance_market_index = 1
    expect(readSyncState(state, now, [SA, AE])).toMatchObject({next_stream:'finances',finance_market_index:1})
  })
})

describe('Amazon response mapping', () => {
  const order = {
    orderId: '402-1234567-1234567',
    createdTime: '2026-11-20T10:00:00Z',
    salesChannel: { marketplaceId: 'A17E79C6D8DWNP' },
    fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' },
    proceeds: { grandTotal: { amount: '115.00', currencyCode: 'SAR' } },
    orderItems: [{
      orderItemId: 'item-1', quantityOrdered: 2,
      product: { asin: 'B0TEST', sellerSku: 'SKU-1', title: 'منتج' },
      proceeds: { proceedsTotal: { amount: '115.00', currencyCode: 'SAR' } },
    }],
  }

  it('maps v2026 orders and embedded items', () => {
    const row = mapAmazonOrder(order, 'M-1', '2026-11-27T00:00:00Z')
    expect(row).toMatchObject({ order_id: '402-1234567-1234567', status: 'shipped', total_amount: 115, currency: 'SAR', sku: 'SKU-1', quantity: 2 })
    expect(row?.shipment_address).toBeNull()
    expect(mapAmazonOrderItems(order, 'M-1')[0]).toMatchObject({ line_id: 'item-1', sku: 'SKU-1', quantity: 2, line_total: 115 })
  })

  it('reads the documented page envelopes', () => {
    expect(ordersPage({ orders: [order], pagination: { nextToken: 'n' } })).toEqual({ orders: [order], nextToken: 'n' })
    expect(ordersPage({ orders: [] }).nextToken).toBeNull()
    expect(financePage({ payload: { transactions: [transaction], nextToken: '' } }))
      .toEqual({ transactions: [transaction], nextToken: null })
    expect(financePage({payload:{nextToken:'empty-page-token'}})).toEqual({transactions:[],nextToken:'empty-page-token'})
  })

  it.each([null, {}, {orders:[],errors:[{code:'InvalidInput'}]}, {payload:{orders:[]}}, {orders:null}, {orders:[{orderId:'no-details'}]}, {orders:[],pagination:{nextToken:7}}])('rejects a malformed Orders success instead of treating it as a complete empty page', body => {
    expect(() => ordersPage(body)).toThrow('رد أمازون غير مكتمل')
  })

  it.each([null, {}, {payload:{transactions:[]},errors:[{code:'InvalidInput'}]}, {payload:[]}, {payload:{transactions:null}}, {payload:{transactions:[{transactionId:'no-money'}]}}, {payload:{transactions:[],nextToken:7}}])('rejects a malformed finance success instead of advancing the cursor', body => {
    expect(() => financePage(body)).toThrow('رد أمازون غير مكتمل')
  })

  it('nets Amazon fees per order across charge and refund transactions', () => {
    const tx = (id: string, fee: number) => ({
      transactionId: id,
      relatedIdentifiers: [{ relatedIdentifierName: 'ORDER_ID', relatedIdentifierValue: 'O-1' }],
      breakdowns: [{ breakdownType: 'AmazonFees', breakdownAmount: { currencyAmount: fee, currencyCode: 'SAR' } }],
    })
    expect(amazonFeeByOrder([tx('a', -17.25), tx('b', 3.5)]).get('O-1')).toBeCloseTo(13.75)
  })
})

describe('Amazon transport', () => {
  it('surfaces throttling once without advancing or automatically retrying', async () => {
    let calls = 0
    await expect(spApiGet('synthetic-token', 'eu', '/orders/2026-01-01/orders', new URLSearchParams(), async () => {
      calls++
      return new Response('private provider message', {status:429})
    })).rejects.toBeInstanceOf(AmazonRateLimited)
    expect(calls).toBe(1)
  })

  it('bounds a request by the caller remaining time and redacts provider errors', async () => {
    let signal: AbortSignal | undefined
    await expect(spApiGet('synthetic-token', 'eu', '/orders/2026-01-01/orders', new URLSearchParams(), async (_url, options) => {
      signal = options?.signal as AbortSignal
      return new Response('private provider message', {status:500})
    }, 1)).rejects.toThrow('أمازون أعاد خطأ (500)')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(signal?.aborted).toBe(true)
  })
})

describe('sync-amazon contract', () => {
  const source = readFileSync('supabase/functions/sync-amazon/index.ts', 'utf8')
  const worker = readFileSync('supabase/functions/queue-worker/index.ts', 'utf8')
  const migration = readFileSync('supabase/migrations/20261127090000_enqueue_amazon_sync.sql', 'utf8')

  it('authorizes the caller, requires an active workspace and never returns secrets', () => {
    expect(source).toContain('authorizeAmazonSync(req, admin, SERVICE_KEY, SUPABASE_URL, createClient, merchantCode)')
    expect(source).toContain("workspace_status !== 'active'")
    expect(source).not.toMatch(/json\([^)]*(refresh_token|accessToken)/)
  })

  it('never lets an order refresh overwrite a reconciled fee and rebuilds performance once', () => {
    expect(source).toContain('platform_fee: _fee')
    expect(source.match(/rpc\('rebuild_performance_data'/g)?.length).toBe(1)
  })

  it('stays inside the queue job timeout and is dispatched by the worker', () => {
    expect(source).toMatch(/RUN_BUDGET_MS = [23]\d_000/)
    expect(worker).toContain("amazon:   'sync-amazon'")
  })

  it('only widens the scheduler platform filter, failing closed on an unexpected definition', () => {
    expect(migration).toContain("credentials.platform = 'trendyol'")
    expect(migration).toContain("credentials.platform in ('trendyol', 'amazon')")
    expect(migration).toContain('raise exception')
  })
})
