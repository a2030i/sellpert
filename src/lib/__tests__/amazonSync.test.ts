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
} from '../../../supabase/functions/_shared/amazonSync'
import { amazonFeeByOrder, mapAmazonOrder, mapAmazonOrderItems } from '../../../supabase/functions/_shared/amazonOrders'

const now = new Date('2026-11-27T12:00:00Z')
const DAY = 86_400_000

describe('Amazon order cursor', () => {
  it('starts with the newest 30 days and never requests buyer or recipient data', () => {
    const state = initialSyncState(now)
    const { params, phase } = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    expect(phase).toBe('backfill')
    const before = Date.parse(params.get('createdBefore') as string)
    expect(before).toBeLessThan(now.getTime() - 2 * 60_000)
    expect(before - Date.parse(params.get('createdAfter') as string)).toBe(30 * DAY)
    expect(params.getAll('includedData')).toEqual(['PROCEEDS', 'FULFILLMENT'])
    expect(params.getAll('marketplaceIds')).toEqual(['A17E79C6D8DWNP'])
  })

  it('pages inside a fixed window, then walks back month by month to 12 months', () => {
    const state = initialSyncState(now)
    const first = nextOrdersRequest(state.orders, ['A17E79C6D8DWNP'], now)
    advanceOrders(state.orders, first.phase, 'token-2')
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
    expect(readSyncState({ orders: { backfill_from: 'nope' } }, now)).toEqual(initialSyncState(now))
    expect(readSyncState({ orders: {}, finances: {} }, now).version).toBe(2)
  })
})

describe('Amazon finance cursor', () => {
  it('backfills newest months first, then moves forward from the backfill start', () => {
    const state = initialSyncState(now)
    const first = nextFinanceRequest(state.finances, now)
    expect(Date.parse(first.get('postedBefore') as string) - Date.parse(first.get('postedAfter') as string)).toBe(30 * DAY)
    advanceFinances(state.finances, null, now)
    expect(nextFinanceRequest(state.finances, now).get('postedBefore')).toBe(first.get('postedAfter'))
    let guard = 0
    while (!state.finances.backfill_done && guard++ < 50) {
      nextFinanceRequest(state.finances, now)
      advanceFinances(state.finances, null, now)
    }
    expect(state.finances.backfill_done).toBe(true)
    const forward = nextFinanceRequest(state.finances, now)
    expect(Date.parse(forward.get('postedAfter') as string)).toBeLessThan(Date.parse(state.finances.backfill_started))
    const span = Date.parse(forward.get('postedBefore') as string) - Date.parse(forward.get('postedAfter') as string)
    expect(span).toBeLessThanOrEqual(AMAZON_FINANCE_WINDOW_DAYS * DAY)
    expect(advanceFinances(state.finances, null, now)).toBe(true)
    expect(state.finances.caught_up).toBe(true)
  })

  it('reuses the frozen window while following nextToken', () => {
    const state = initialSyncState(now)
    const first = nextFinanceRequest(state.finances, now)
    advanceFinances(state.finances, 'next-1', now)
    const second = nextFinanceRequest(state.finances, new Date(now.getTime() + 60_000))
    expect(second.get('postedBefore')).toBe(first.get('postedBefore'))
    expect(second.get('nextToken')).toBe('next-1')
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
    expect(financePage({ payload: { transactions: [{ transactionId: 't' }], nextToken: '' } }))
      .toEqual({ transactions: [{ transactionId: 't' }], nextToken: null })
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

describe('sync-amazon contract', () => {
  const source = readFileSync('supabase/functions/sync-amazon/index.ts', 'utf8')
  const worker = readFileSync('supabase/functions/queue-worker/index.ts', 'utf8')
  const migration = readFileSync('supabase/migrations/20261127090000_enqueue_amazon_sync.sql', 'utf8')

  it('authorizes the caller, requires an active workspace and never returns secrets', () => {
    expect(source).toContain('authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode')
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
