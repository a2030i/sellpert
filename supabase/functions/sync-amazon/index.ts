import { accountScopedClient, resolveMarketplaceAccount } from '../_shared/marketplaceAccountScope.ts'
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
import { HttpError, json, numberValue } from '../_shared/sync.ts'
import { authorizeAmazonSync } from '../_shared/amazonSyncAuth.ts'
import { acquireAmazonSyncLease, readAmazonSyncLease, saveAmazonSyncState, persistAmazonPage, type AmazonSyncLease } from '../_shared/amazonSyncStorage.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'
import { loadAmazonAppConfig } from '../_shared/amazonAppConfig.ts'
import { refreshAccessToken, type AmazonSpRegion } from '../_shared/amazonSpApi.ts'
import { selectAmazonSyncMarkets } from '../_shared/amazonCurrency.ts'
import {
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
  const startedAt = Date.now()
  // Bound database requests too: a provider timeout must not leave an old run
  // writing after the 120-second connection lease can be replaced.
  const hardDeadline = startedAt + 45_000
  let admin = createClient(SUPABASE_URL, SERVICE_KEY, { global: { fetch: (input, init) => {
    const signals = [AbortSignal.timeout(Math.max(1, hardDeadline - Date.now()))]
    if (init?.signal) signals.push(init.signal)
    return fetch(input, { ...init, signal: AbortSignal.any(signals) })
  } } })
  let logId = ''
  let lease: AmazonSyncLease | undefined
  try {
    const body = await req.json().catch(() => ({}))
    const merchantCode = String(body?.merchant_code || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeAmazonSync(req, admin, SERVICE_KEY, SUPABASE_URL, createClient, merchantCode)
    const account=await resolveMarketplaceAccount(admin,merchantCode,'amazon',body.marketplace_account_id)
    admin=accountScopedClient(admin,account)

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
    const { marketplaceIds, warning: marketWarning } = selectAmazonSyncMarkets(credential.extra?.marketplaces)

    lease = await acquireAmazonSyncLease(admin, credential)

    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode, platform: 'amazon', status: 'running', records_synced: 0,
    }).select('id').single()
    if (logError) throw logError
    logId = log.id

    const { accessToken } = await refreshAccessToken(config, secret.refresh_token, (input, init) => {
      const signals = [AbortSignal.timeout(Math.max(1, Math.min(20_000, startedAt + RUN_BUDGET_MS - Date.now())))]
      if (init?.signal) signals.push(init.signal)
      return fetch(input, { ...init, signal: AbortSignal.any(signals) })
    }).catch(error => {
      if (error instanceof HttpError && error.status === 401) {
        throw new HttpError(401, 'انتهى إذن أمازون أو أُلغي. أعد ربط الحساب من صفحة الربط')
      }
      throw error
    })

    const state = readSyncState(credential.extra?.sync, new Date(), marketplaceIds)
    const deadline = startedAt + RUN_BUDGET_MS
    const details: Record<string, unknown> = { orders: 0, order_items: 0, transactions: 0, fee_orders: 0 }
    const warnings: string[] = marketWarning ? [marketWarning] : []
    const finishedMarkets = new Set<string>()
    let ordersDone = false

    // Alternate streams so a large order backfill cannot starve financial data.
    // Stop the whole run on 429, resuming the other stream on the next run.
    while (Date.now() < deadline && (!ordersDone || finishedMarkets.size < marketplaceIds.length)) {
      const stream = ordersDone ? 'finances' : finishedMarkets.size === marketplaceIds.length ? 'orders' : state.next_stream
      await readAmazonSyncLease(admin, lease)
      try {
        if (stream === 'orders') {
          const { params, phase } = nextOrdersRequest(state.orders, marketplaceIds, new Date())
          const page = ordersPage(await spApiGet(accessToken, region, '/orders/2026-01-01/orders', params, fetch,
            Math.max(1, Math.min(20_000, deadline - Date.now()))))
          await readAmazonSyncLease(admin, lease)
          const syncedAt = new Date().toISOString()
          const orders = page.orders.flatMap((order: any) => {
            const row = mapAmazonOrder(order, merchantCode, syncedAt)
            if (!row) return []
            const { platform_fee: _fee, ...rest } = row
            return [rest]
          })
          const items = page.orders.flatMap((order: any) => mapAmazonOrderItems(order, merchantCode, syncedAt))
          details.fee_orders = numberValue(details.fee_orders) + await persistAmazonPage(admin, merchantCode, { orders, items }, async () => {
            ordersDone = advanceOrders(state.orders, phase, page.nextToken, new Date())
            state.next_stream = 'finances'
            await saveAmazonSyncState(admin, lease!, state)
          })
          details.orders = numberValue(details.orders) + orders.length
          details.order_items = numberValue(details.order_items) + items.length
        } else {
          // Each marketplace has its own frozen finance window and continuation.
          let marketIndex = state.finance_market_index % marketplaceIds.length
          while (finishedMarkets.has(marketplaceIds[marketIndex])) marketIndex = (marketIndex + 1) % marketplaceIds.length
          const marketplaceId = marketplaceIds[marketIndex]
          const cursor = state.finances_by_marketplace[marketplaceId]
          const params = nextFinanceRequest(cursor, new Date(), marketplaceId)
          const page = financePage(await spApiGet(accessToken, region, '/finances/2024-06-19/transactions', params, fetch,
            Math.max(1, Math.min(20_000, deadline - Date.now()))))
          await readAmazonSyncLease(admin, lease)
          const rows = page.transactions.flatMap((transaction: any) => {
            const row = mapAmazonFinancialTransaction(transaction, merchantCode)
            if (!row) return []
            return [{ ...row, raw: { ...transaction, sellpertSource: SP_API_SOURCE } }]
          })
          details.fee_orders = numberValue(details.fee_orders) + await persistAmazonPage(admin, merchantCode, { transactions: rows }, async () => {
            if (advanceFinances(cursor, page.nextToken, new Date())) finishedMarkets.add(marketplaceId)
            state.finance_market_index = (marketIndex + 1) % marketplaceIds.length
            state.next_stream = 'orders'
            await saveAmazonSyncState(admin, lease!, state)
          })
          details.transactions = numberValue(details.transactions) + rows.length
        }
      } catch (error) {
        if (!(error instanceof AmazonRateLimited)) throw error
        details[`${stream}_rate_limited`] = true
        warnings.push('وصلت المزامنة لحد طلبات أمازون، وستكمل تلقائيًا في الدورة القادمة')
        state.next_stream = stream === 'orders' ? 'finances' : 'orders'
        await saveAmazonSyncState(admin, lease, state)
        break
      }
    }
    const backfillDone = state.orders.backfill_done && Object.values(state.finances_by_marketplace).every(cursor => cursor.backfill_done)
    if (!backfillDone) warnings.push('backfill: سحب سجل آخر ١٢ شهرًا مستمر في الدورات القادمة (الأحدث أولًا)')
    if (!ordersDone || finishedMarkets.size < marketplaceIds.length) {
      warnings.push('المزامنة مستمرة من آخر موضع محفوظ في الدورة القادمة')
    }

    const { data: performanceRows, error: performanceError } = await admin.rpc('rebuild_performance_data', {
      p_merchant_code: merchantCode,
    })
    if (performanceError) throw performanceError
    details.performance_days = numberValue(performanceRows)
    details.backfill_done = backfillDone
    details.backfill_reached = state.orders.backfill_done ? state.orders.backfill_floor : state.orders.window_end
    details.warnings = warnings

    const now = new Date().toISOString()
    const recordCount = numberValue(details.orders) + numberValue(details.transactions)
    const status = warnings.length ? 'partial' : 'success'
    const { error: finishLogError } = await admin.from('sync_logs').update({
      status, records_synced: recordCount, finished_at: now, details,
      error_message: warnings.length ? warnings.join(' | ').slice(0, 4000) : null,
    }).eq('id', logId)
    if (finishLogError) throw finishLogError
    await saveAmazonSyncState(admin, lease, state, { last_sync_at: now, records_synced: recordCount })
    lease = undefined
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
  // On any error, leave the bounded lease in place. A transport failure does
  // not prove that an in-flight database mutation has stopped on the server.
})
