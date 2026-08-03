import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  HttpError,
  authorizeMerchantSync,
  fetchJsonWithRetry,
  json,
  numberValue,
  parseSyncRange,
  splitRange,
} from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'
import {
  amazonRequestHeaders,
  amazonFeeByOrder,
  enrichAmazonOrderItems,
  mapAmazonFinancialTransaction,
  mapAmazonOrder,
  mapAmazonOrderItems,
  mapAmazonPackages,
} from '../_shared/amazonOrders.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_MARKETPLACE = 'A17E79C6D8DWNP' // Amazon.sa
const EU_ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''
  let mappingId = ''

  try {
    const body = await req.json()
    const merchantCode = String(body?.merchant_code || '')
    mappingId = String(body?.mapping_id || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode)

    const { data: merchant } = await admin.from('merchants')
      .select('subscription_status').eq('merchant_code', merchantCode).maybeSingle()
    if (!merchant) throw new HttpError(404, 'Merchant not found')
    if (merchant.subscription_status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED')

    const credentials = await resolveCredentials(admin, merchantCode, mappingId)
    const { from, to } = parseSyncRange(body, 90)
    const marketplaceId = credentials.marketplaceId || DEFAULT_MARKETPLACE
    const endpoint = credentials.endpoint || EU_ENDPOINT

    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode, platform: 'amazon', status: 'running', records_synced: 0,
    }).select().single()
    if (logError) throw logError
    logId = log.id

    const accessToken = await getLwaToken(credentials)
    const rows: any[] = []
    const itemRows: any[] = []
    const packageRows: any[] = []
    let customerDataAvailable = credentials.includeCustomerData
    let paginationToken = ''

    do {
      const query = new URLSearchParams({
        marketplaceIds: marketplaceId,
        createdAfter: from.toISOString(),
        createdBefore: to.toISOString(),
        maxResultsPerPage: '100',
        includedData: customerDataAvailable
          ? 'PROCEEDS,FULFILLMENT,CANCELLATION,PACKAGES,BUYER,RECIPIENT'
          : 'PROCEEDS,FULFILLMENT,CANCELLATION,PACKAGES',
      })
      if (paginationToken) query.set('paginationToken', paginationToken)
      let data: any
      try {
        data = await fetchJsonWithRetry(
          `${endpoint}/orders/2026-01-01/orders?${query}`,
          { headers: amazonRequestHeaders(accessToken) },
          'Amazon Orders API',
        )
      } catch (error) {
        // Buyer and recipient datasets require Amazon's restricted roles. A
        // missing PII grant must not stop orders, items, amounts and packages.
        if (!(error instanceof HttpError) || error.status !== 403 || !customerDataAvailable) throw error
        customerDataAvailable = false
        query.set('includedData', 'PROCEEDS,FULFILLMENT,CANCELLATION,PACKAGES')
        data = await fetchJsonWithRetry(
          `${endpoint}/orders/2026-01-01/orders?${query}`,
          { headers: amazonRequestHeaders(accessToken) },
          'Amazon Orders API',
        )
      }
      const orders: any[] = data?.orders || data?.payload?.orders || []
      for (const order of orders) {
        const row = mapAmazonOrder(order, merchantCode)
        if (row) rows.push(row)
        itemRows.push(...mapAmazonOrderItems(order, merchantCode))
        packageRows.push(...mapAmazonPackages(order, merchantCode))
      }
      paginationToken = String(data?.nextToken || data?.pagination?.nextToken || '')
    } while (paginationToken)

    let catalogDataAvailable = true
    let catalogItems: any[] = []
    try {
      catalogItems = await fetchAmazonCatalogItems(
        endpoint,
        accessToken,
        marketplaceId,
        [...new Set(itemRows.map(item => String(item.content_id || '')).filter(Boolean))],
      )
      enrichAmazonOrderItems(itemRows, catalogItems)
    } catch (error) {
      // Catalogue access uses the Product Listing role. Product enrichment is
      // useful, but it must never block the core orders synchronization.
      console.warn('[amazon:catalog]', error instanceof Error ? error.message : error)
      catalogDataAvailable = false
    }

    let financialDataAvailable = true
    let financialTransactions: any[] = []
    try {
      financialTransactions = await fetchAmazonTransactions(endpoint, accessToken, marketplaceId, from, to)
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 403) throw error
      financialDataAvailable = false
    }
    const feeByOrder = amazonFeeByOrder(financialTransactions)
    for (const row of rows) row.platform_fee = feeByOrder.get(row.order_id) || 0

    await upsertRows(admin, rows)
    await upsertOrderItems(admin, itemRows)
    await upsertPackages(admin, packageRows)
    await upsertTransactions(admin, financialTransactions.map(transaction =>
      mapAmazonFinancialTransaction(transaction, merchantCode)).filter(Boolean))
    const daily = buildDaily(rows)
    await upsertPerformance(admin, merchantCode, daily)

    const now = new Date().toISOString()
    const warnings = [
      ...(!customerDataAvailable ? ['بيانات العميل تحتاج صلاحية Restricted Data'] : []),
      ...(!catalogDataAvailable ? ['صور وتفاصيل المنتجات تحتاج صلاحية Product Listing'] : []),
      ...(!financialDataAvailable ? ['العمولات والتسويات تحتاج صلاحية Finances'] : []),
    ]
    const syncStatus = warnings.length ? 'partial' : 'success'
    const details = {
      orders: rows.length,
      order_items: itemRows.length,
      catalog_items: catalogItems.length,
      catalog_data: catalogDataAvailable ? 'included' : 'permission_required',
      packages: packageRows.length,
      customer_data: customerDataAvailable ? 'included' : 'permission_required',
      financial_transactions: financialTransactions.length,
      fees_source: financialDataAvailable ? 'amazon_finances_api_2024_06_19' : 'permission_required',
      financial_data_delay_hours: 48,
      warnings,
    }
    await admin.from('sync_logs').update({
      status: syncStatus,
      records_synced: rows.length,
      error_message: warnings.length ? warnings.join(' | ') : null,
      details,
      finished_at: now,
    }).eq('id', logId)
    await admin.from('platform_credentials').update({
      last_sync_at: now, records_synced: rows.length,
    }).eq('merchant_code', merchantCode).eq('platform', 'amazon')
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_at: now,
      last_sync_status: syncStatus,
      records_synced: rows.length,
      last_sync_error: warnings.length ? warnings.join(' | ') : null,
    }).eq('id', mappingId).eq('merchant_code', merchantCode)

    return json({
      ok: true,
      status: syncStatus,
      partial: warnings.length > 0,
      records_synced: daily.size,
      ...details,
    }, 200, corsHeaders)
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    if (logId) await admin.from('sync_logs').update({
      status: 'error', error_message: error.message, finished_at: new Date().toISOString(),
    }).eq('id', logId)
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_status: 'error', last_sync_error: error.message,
    }).eq('id', mappingId)
    return json({ error: error.message }, status, corsHeaders)
  }
})

async function resolveCredentials(admin: any, merchantCode: string, mappingId: string) {
  let data: any
  if (mappingId) {
    const result = await admin.from('merchant_platform_mappings')
      .select('seller_id,merchant_code,platform,platform_connections(api_key,api_secret,extra)')
      .eq('id', mappingId).eq('merchant_code', merchantCode).eq('platform', 'amazon').maybeSingle()
    const connection = result.data?.platform_connections as any
    if (!result.data || !connection) throw new HttpError(404, 'Amazon connection not found')
    data = { seller_id: result.data.seller_id, api_key: connection.api_key, api_secret: connection.api_secret, extra: connection.extra }
  } else {
    const result = await admin.from('platform_credentials').select('seller_id,api_key,api_secret,extra')
      .eq('merchant_code', merchantCode).eq('platform', 'amazon').eq('is_active', true).maybeSingle()
    data = result.data
  }
  if (!data) throw new HttpError(400, 'لا توجد بيانات ربط مفعلة لأمازون')
  const secret = await resolveSecretPayload(data)
  const clientId = secret.api_key || (data.extra?.auth_type === 'oauth' ? Deno.env.get('AMAZON_LWA_CLIENT_ID') : '')
  const clientSecret = secret.api_secret || (data.extra?.auth_type === 'oauth' ? Deno.env.get('AMAZON_LWA_CLIENT_SECRET') : '')
  if (!clientId || !clientSecret || !secret.refresh_token) {
    throw new HttpError(400, 'بيانات Amazon غير مكتملة (LWA Client ID / Secret / Refresh Token)')
  }
  return {
    clientId,
    clientSecret,
    refreshToken: secret.refresh_token,
    marketplaceId: data.extra?.marketplace_id,
    endpoint: normalizeEndpoint(data.extra?.endpoint),
    includeCustomerData: data.extra?.include_customer_data !== false,
  }
}

function normalizeEndpoint(value: unknown) {
  const allowed = new Set([
    'https://sellingpartnerapi-na.amazon.com',
    'https://sellingpartnerapi-eu.amazon.com',
    'https://sellingpartnerapi-fe.amazon.com',
  ])
  return allowed.has(String(value)) ? String(value) : EU_ENDPOINT
}

async function getLwaToken(credentials: any) {
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new HttpError(res.status || 401, `Amazon LWA: ${data.error_description || data.error || 'authorization failed'}`)
  }
  return data.access_token
}

async function upsertRows(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('orders').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,order_id',
    })
    if (error) throw error
  }
}

async function upsertOrderItems(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('order_items').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,order_id,line_id',
    })
    if (error) throw error
  }
}

async function upsertPackages(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('order_packages').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,shipment_package_id',
    })
    if (error) throw error
  }
}

async function upsertTransactions(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('account_transactions').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,transaction_no',
    })
    if (error) throw error
  }
}

async function fetchAmazonTransactions(endpoint: string, accessToken: string, marketplaceId: string, from: Date, to: Date) {
  const transactions: any[] = []
  for (const window of splitRange(from, to, 180)) {
    let nextToken = ''
    const seenTokens = new Set<string>()
    do {
      const query = new URLSearchParams({
        postedAfter: window.from.toISOString(),
        postedBefore: window.to.toISOString(),
        marketplaceId,
      })
      if (nextToken) query.set('nextToken', nextToken)
      const data = await fetchJsonWithRetry(
        `${endpoint}/finances/2024-06-19/transactions?${query}`,
        { headers: amazonRequestHeaders(accessToken) },
        'Amazon Finances API',
      )
      transactions.push(...(data?.payload?.transactions || []))
      const candidate = String(data?.payload?.nextToken || '')
      if (candidate && seenTokens.has(candidate)) throw new HttpError(502, 'Amazon Finances API returned a repeated pagination token')
      if (candidate) seenTokens.add(candidate)
      nextToken = candidate
    } while (nextToken)
  }
  return transactions
}

async function fetchAmazonCatalogItems(
  endpoint: string,
  accessToken: string,
  marketplaceId: string,
  asins: string[],
) {
  const items: any[] = []
  for (let index = 0; index < asins.length; index += 20) {
    const identifiers = asins.slice(index, index + 20)
    const query = new URLSearchParams({
      identifiers: identifiers.join(','),
      identifiersType: 'ASIN',
      marketplaceIds: marketplaceId,
      includedData: 'images,summaries,identifiers,productTypes,classifications',
    })
    const data = await fetchJsonWithRetry(
      `${endpoint}/catalog/2022-04-01/items?${query}`,
      { headers: amazonRequestHeaders(accessToken) },
      'Amazon Catalog Items API',
    )
    items.push(...(data?.items || data?.payload?.items || []))
    // The default usage plan permits two requests per second.
    if (index + 20 < asins.length) await new Promise(resolve => setTimeout(resolve, 550))
  }
  return items
}

function buildDaily(rows: any[]) {
  const daily = new Map<string, { sales: number; orders: number; fees: number }>()
  for (const row of rows) {
    if (row.status === 'cancelled') continue
    const date = row.order_date.slice(0, 10)
    const value = daily.get(date) || { sales: 0, orders: 0, fees: 0 }
    value.sales += numberValue(row.total_amount)
    value.fees += numberValue(row.platform_fee)
    value.orders++
    daily.set(date, value)
  }
  return daily
}

async function upsertPerformance(admin: any, merchantCode: string, daily: Map<string, any>) {
  for (const [date, value] of daily) {
    const { error } = await admin.from('performance_data').upsert({
      merchant_code: merchantCode, platform: 'amazon', data_date: date,
      total_sales: value.sales, order_count: value.orders,
      platform_fees: value.fees, margin: 0, ad_spend: 0,
    }, { onConflict: 'merchant_code,platform,data_date' })
    if (error) throw error
  }
}
