/**
 * sync-amazon
 * ─────────────────────────────────────────────────────────────────────────────
 * Resumable Amazon SP-API synchronization for one merchant workspace.
 *
 * Each run continues from the cursor in platform_credentials.extra.sync and
 * stops well before the queue job timeout or at Amazon's rate limit:
 *   1. Orders (v2026-01-01 searchOrders): 12-month backfill by creation date
 *      in backward 30-day windows (newest first), then incremental by last
 *      update. Items are embedded; no buyer or recipient data is requested.
 *   2. Transactions (Finances v2024-06-19 listTransactions): the same 12-month
 *      backward backfill, then forward windows → account_transactions; each
 *      touched order's platform_fee is recomputed from all stored SP-API
 *      transactions for that order.
 *   3. rebuild_performance_data, using the database's source precedence.
 *
 * Owner decision 2026-11-26: the API is the authoritative Amazon source once a
 * merchant is connected; Amazon file uploads are blocked for that workspace.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { HttpError, authorizeMerchantSync, json, numberValue } from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'
import { loadAmazonAppConfig } from '../_shared/amazonAppConfig.ts'
import { AMAZON_MARKETPLACES, refreshAccessToken, type AmazonSpRegion } from '../_shared/amazonSpApi.ts'
import {
  amazonFeeByOrder,
  mapAmazonFinancialTransaction,
  mapAmazonOrder,
  mapAmazonOrderItems,
} from '../_shared/amazonOrders.ts'
import {
  AmazonRateLimited,
  advanceFinances,
  advanceOrders,
  financePage,
  nextFinanceRequest,
  nextOrdersRequest,
  ordersPage,
  readSyncState,
  spApiGet,
} from '../_shared/amazonSync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// queue-worker aborts a job after 55 s; leave room for the rebuild and logging.
const RUN_BUDGET_MS = 30_000
const SP_API_SOURCE = 'sp_api'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const startedAt = Date.now()
  let logId = ''
  try {
    const body = await req.json().catch(() => ({}))
    const merchantCode = String(body?.merchant_code || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode, ['integrations', 'orders', 'statement'])

    const { data: merchant } = await admin.from('merchants')
      .select('workspace_status').eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
    if (!merchant) throw new HttpError(404, 'Merchant not found')
    if (merchant.workspace_status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED')

    const { data: credential, error: credentialError } = await admin.from('platform_credentials')
      .select('id,seller_id,extra,updated_at').eq('merchant_code', merchantCode)
      .eq('platform', 'amazon').eq('is_active', true).maybeSingle()
    if (credentialError) throw credentialError
    if (!credential) throw new HttpError(400, 'لا يوجد ربط مفعل لأمازون')
    const config = await loadAmazonAppConfig(admin, Deno.env)
    if (!config) throw new HttpError(503, 'إعدادات تطبيق أمازون غير مكتملة')
    const secret = await resolveSecretPayload(credential)
    if (!secret.refresh_token) throw new HttpError(400, 'ربط أمازون غير مكتمل، أعد الربط')

    const region = (credential.extra?.region || 'eu') as AmazonSpRegion
    const marketplaceIds = (Array.isArray(credential.extra?.marketplaces) ? credential.extra.marketplaces : [])
      .map((market: any) => String(market?.id || '')).filter((id: string) => AMAZON_MARKETPLACES[id])
    if (!marketplaceIds.length) throw new HttpError(400, 'لا يوجد سوق أمازون مدعوم في هذا الربط')

    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode, platform: 'amazon', status: 'running', records_synced: 0,
    }).select('id').single()
    if (logError) throw logError
    logId = log.id

    const { accessToken } = await refreshAccessToken(config, secret.refresh_token).catch(error => {
      if (error instanceof HttpError && error.status === 401) {
        throw new HttpError(401, 'انتهى إذن أمازون أو أُلغي. أعد ربط الحساب من صفحة الربط')
      }
      throw error
    })

    const state = readSyncState(credential.extra?.sync, new Date())
    const deadline = startedAt + RUN_BUDGET_MS
    const details: Record<string, unknown> = { orders: 0, order_items: 0, transactions: 0, fee_orders: 0 }
    const warnings: string[] = []

    // Orders whose fee must be recomputed: new transactions, and orders that
    // arrive after their transactions were already stored.
    const touchedOrders = new Set<string>()

    // 1. Orders
    try {
      while (Date.now() < deadline) {
        const { params, phase } = nextOrdersRequest(state.orders, marketplaceIds, new Date())
        const page = ordersPage(await spApiGet(accessToken, region, '/orders/2026-01-01/orders', params))
        const syncedAt = new Date().toISOString()
        // platform_fee comes only from Finances transactions; never let an
        // order refresh overwrite a fee that was already reconciled.
        const orders = page.orders.flatMap((order: any) => {
          const row = mapAmazonOrder(order, merchantCode, syncedAt)
          if (!row) return []
          const { platform_fee: _fee, ...rest } = row
          return [rest]
        })
        const items = page.orders.flatMap((order: any) => mapAmazonOrderItems(order, merchantCode, syncedAt))
        await upsertChunks(admin, 'orders', orders, 'merchant_code,platform,order_id')
        await upsertChunks(admin, 'order_items', items, 'merchant_code,platform,order_id,line_id')
        for (const row of orders) touchedOrders.add(row.order_id)
        details.orders = numberValue(details.orders) + orders.length
        details.order_items = numberValue(details.order_items) + items.length
        const done = advanceOrders(state.orders, phase, page.nextToken)
        await saveState(admin, credential.id, state)
        if (done) break
      }
    } catch (error) {
      if (!(error instanceof AmazonRateLimited)) throw error
      details.orders_rate_limited = true
    }

    // 2. Financial transactions
    try {
      while (Date.now() < deadline) {
        const params = nextFinanceRequest(state.finances, new Date())
        const page = financePage(await spApiGet(accessToken, region, '/finances/2024-06-19/transactions', params))
        const rows = page.transactions.flatMap((transaction: any) => {
          const row = mapAmazonFinancialTransaction(transaction, merchantCode)
          if (!row) return []
          if (row.order_id) touchedOrders.add(row.order_id)
          return [{ ...row, raw: { ...transaction, sellpertSource: SP_API_SOURCE } }]
        })
        await upsertChunks(admin, 'account_transactions', dedupe(rows), 'merchant_code,platform,transaction_no')
        details.transactions = numberValue(details.transactions) + rows.length
        const caughtUp = advanceFinances(state.finances, page.nextToken, new Date())
        await saveState(admin, credential.id, state)
        if (caughtUp) break
      }
    } catch (error) {
      if (!(error instanceof AmazonRateLimited)) throw error
      details.finances_rate_limited = true
    }
    details.fee_orders = await recomputeOrderFees(admin, merchantCode, [...touchedOrders])

    if (!state.orders.backfill_done || !state.finances.backfill_done) warnings.push('backfill: سحب سجل آخر ١٢ شهرًا مستمر في الدورات القادمة (الأحدث أولًا)')

    const { data: performanceRows, error: performanceError } = await admin.rpc('rebuild_performance_data', {
      p_merchant_code: merchantCode,
    })
    if (performanceError) throw performanceError
    details.performance_days = numberValue(performanceRows)
    details.backfill_done = state.orders.backfill_done && state.finances.backfill_done
    details.backfill_reached = state.orders.backfill_done ? state.orders.backfill_floor : state.orders.window_end
    details.warnings = warnings

    const now = new Date().toISOString()
    const recordCount = numberValue(details.orders) + numberValue(details.transactions)
    const status = warnings.length ? 'partial' : 'success'
    await admin.from('sync_logs').update({
      status, records_synced: recordCount, finished_at: now, details,
      error_message: warnings.length ? warnings.join(' | ').slice(0, 4000) : null,
    }).eq('id', logId)
    await admin.from('platform_credentials').update({ last_sync_at: now, records_synced: recordCount })
      .eq('id', credential.id)
    return json({ ok: true, status, records_synced: recordCount, ...details }, 200, corsHeaders)
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof HttpError ? error.message : 'Unexpected error'
    if (status === 500) console.error('[sync-amazon] unexpected failure:', error?.name || 'Error')
    if (logId) await admin.from('sync_logs').update({
      status: 'error', error_message: message, finished_at: new Date().toISOString(),
    }).eq('id', logId)
    return json({ error: message }, status, corsHeaders)
  }
})

async function upsertChunks(admin: any, table: string, rows: any[], onConflict: string) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from(table).upsert(rows.slice(index, index + 100), { onConflict })
    if (error) throw error
  }
}

function dedupe(rows: any[]) {
  return [...new Map(rows.map(row => [row.transaction_no, row])).values()]
}

// Persist the cursor after every page without touching the encrypted secret.
async function saveState(admin: any, credentialId: string, state: unknown) {
  const { data: current, error: readError } = await admin.from('platform_credentials')
    .select('extra').eq('id', credentialId).maybeSingle()
  if (readError) throw readError
  if (!current) throw new HttpError(409, 'أُلغي ربط أمازون أثناء المزامنة')
  const { error } = await admin.from('platform_credentials')
    .update({ extra: { ...(current.extra || {}), sync: state } }).eq('id', credentialId)
  if (error) throw error
}

/**
 * An order's Amazon fees can arrive in several transactions across windows
 * (charges, refunds, reversals). Recompute from every stored SP-API
 * transaction for the order instead of adding page totals.
 */
async function recomputeOrderFees(admin: any, merchantCode: string, orderIds: string[]) {
  let updated = 0
  for (let index = 0; index < orderIds.length; index += 100) {
    const chunk = orderIds.slice(index, index + 100)
    const { data, error } = await admin.from('account_transactions').select('raw')
      .eq('merchant_code', merchantCode).eq('platform', 'amazon').in('order_id', chunk)
      .eq('raw->>sellpertSource', SP_API_SOURCE)
    if (error) throw error
    const fees = amazonFeeByOrder((data || []).map((row: any) => row.raw))
    const updates = chunk.filter(orderId => fees.has(orderId))
    // No SP-API transaction yet: keep the existing fee (e.g. from an earlier
    // file import) instead of overwriting it with zero.
    for (let start = 0; start < updates.length; start += 25) {
      const results = await Promise.all(updates.slice(start, start + 25).map(orderId => admin.from('orders')
        .update({ platform_fee: Math.max(0, Math.round((fees.get(orderId) || 0) * 100) / 100) })
        .eq('merchant_code', merchantCode).eq('platform', 'amazon').eq('order_id', orderId)
        .select('id')))
      for (const { data: changed, error: updateError } of results) {
        if (updateError) throw updateError
        updated += changed?.length || 0
      }
    }
  }
  return updated
}
