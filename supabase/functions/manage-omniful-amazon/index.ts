import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import {
  authorizeMerchantSync,
  fetchJsonWithRetry,
  HttpError,
  json,
  parseSyncRange,
} from '../_shared/sync.ts'
import {
  normalizeOmnifulObservation,
  omnifulNextCursor,
  omnifulOrderPlatform,
  omnifulOrderRows,
  type OmnifulMarketplace,
  type OmnifulObservation,
} from '../_shared/omnifulOrders.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_BASE_URL = 'https://prodapi.omniful.com'
const TRIAL_PLATFORMS: OmnifulMarketplace[] = ['amazon', 'noon', 'trendyol']

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''
  let merchantCode = ''
  try {
    const body = await req.json().catch(() => ({}))
    merchantCode = String(body?.merchant_code || '').trim()
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode, ['integrations'])

    const connections = await getConnections(admin, merchantCode)
    const action = String(body?.action || 'status')
    if (action === 'status') return json(await connectionStatus(admin, connections), 200, corsHeaders)
    if (action !== 'sync') throw new HttpError(400, 'Unsupported action')
    const enabledConnections = connections.filter((connection: any) => connection.status !== 'disabled')
    if (enabledConnections.length === 0) throw new HttpError(409, 'تجربة Omniful موقوفة لهذا المتجر')

    const tokenContext = resolveAccessToken(merchantCode)
    if (!tokenContext.token) {
      await markConnectionsError(admin, merchantCode, 'لم يُضبط رمز وصول Omniful الآمن بعد')
      throw new HttpError(409, 'يلزم إكمال إعداد حساب Omniful المركزي قبل أول مزامنة')
    }
    if (tokenContext.source === 'central' && enabledConnections.some((connection: any) => (
      !connection.omniful_seller_ref && !connection.omniful_store_ref
    ))) {
      throw new HttpError(409, 'يجب تحديد معرف بائع أو متجر Omniful لكل منصة قبل استخدام الرمز المركزي')
    }

    const { from, to } = parseSyncRange(body, 30)
    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode,
      platform: 'omniful_marketplaces',
      status: 'running',
      records_synced: 0,
      details: { source: 'omniful', mode: 'shadow', canonical_write: false },
    }).select('id').single()
    if (logError) throw logError
    logId = log.id

    const result = await fetchMarketplaceOrders(tokenContext.token, from, to, enabledConnections)
    const comparisons: Record<string, { matched: number; newShadow: number; duplicates: number }> = {}
    for (const platform of TRIAL_PLATFORMS) {
      const connection = enabledConnections.find((item: any) => item.platform === platform)
      if (!connection) continue
      comparisons[platform] = await compareAndPersist(
        admin,
        merchantCode,
        platform,
        result.ordersByPlatform[platform],
      )
    }
    const now = new Date().toISOString()
    const platformDetails = Object.fromEntries(TRIAL_PLATFORMS.map(platform => {
      const comparison = comparisons[platform] || { matched: 0, newShadow: 0, duplicates: 0 }
      return [platform, {
        records: result.ordersByPlatform[platform].length,
        matched_existing: comparison.matched,
        new_shadow: comparison.newShadow,
        duplicate_provider_records: comparison.duplicates,
      }]
    }))
    const details = {
      source: 'omniful',
      mode: 'shadow',
      canonical_write: false,
      excel_preserved: true,
      trendyol_api_preserved: true,
      pages: result.pages,
      provider_records: result.providerRecords,
      platforms: platformDetails,
      filtered_other_channels: result.filteredOtherChannels,
      invalid_records: result.invalidRecords,
      matched_existing: Object.values(comparisons).reduce((sum, item) => sum + item.matched, 0),
      new_shadow: Object.values(comparisons).reduce((sum, item) => sum + item.newShadow, 0),
    }

    for (const connection of enabledConnections) {
      const platform = connection.platform as OmnifulMarketplace
      const comparison = comparisons[platform] || { matched: 0, newShadow: 0 }
      const { error: connectionError } = await admin.from('omniful_connections').update({
        status: 'active',
        is_enabled: true,
        last_sync_at: now,
        last_cursor: result.lastCursor || null,
        last_error: null,
        records_seen: result.ordersByPlatform[platform].length,
        records_matched: comparison.matched,
        records_new: comparison.newShadow,
        updated_at: now,
      }).eq('id', connection.id)
      if (connectionError) throw connectionError
    }

    await admin.from('sync_logs').update({
      status: 'success',
      records_synced: TRIAL_PLATFORMS.reduce((sum, platform) => sum + result.ordersByPlatform[platform].length, 0),
      details,
      finished_at: now,
    }).eq('id', logId)

    return json({ ok: true, ...details, last_sync_at: now }, 200, corsHeaders)
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'تعذر مزامنة Omniful'
    if (logId) await admin.from('sync_logs').update({
      status: 'error', error_message: message.slice(0, 4000), finished_at: new Date().toISOString(),
    }).eq('id', logId)
    if (merchantCode) {
      await admin.from('omniful_connections').update({
        status: 'error', last_error: message.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).neq('status', 'disabled')
    }
    return json({ error: message }, status, corsHeaders)
  }
})

async function getConnections(admin: any, merchantCode: string) {
  const { data, error } = await admin.from('omniful_connections')
    .select('id,merchant_code,platform,mode,status,scope_strategy,omniful_seller_ref,omniful_store_ref,is_enabled,last_sync_at,last_error,records_seen,records_matched,records_new,updated_at')
    .eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).order('platform')
  if (error) throw error
  if (!data?.length) throw new HttpError(404, 'تجربة Omniful غير مفعلة لهذا المتجر')
  return data
}

async function connectionStatus(admin: any, connections: any[]) {
  const merchantCode = connections[0].merchant_code
  const [uploadsResult, trendyolResult] = await Promise.all([
    admin.from('platform_file_uploads').select('platform')
      .eq('merchant_code', merchantCode).in('platform', ['amazon', 'noon']).eq('status', 'success'),
    admin.from('platform_credentials').select('is_active,last_sync_at')
      .eq('merchant_code', merchantCode).eq('platform', 'trendyol').maybeSingle(),
  ])
  if (uploadsResult.error) throw uploadsResult.error
  if (trendyolResult.error) throw trendyolResult.error
  const uploadCounts = { amazon: 0, noon: 0 }
  for (const upload of uploadsResult.data || []) {
    if (upload.platform === 'amazon' || upload.platform === 'noon') uploadCounts[upload.platform]++
  }
  return {
    available: true,
    token_configured: Boolean(resolveAccessToken(merchantCode).token),
    connections: connections.map(connection => ({
      platform: connection.platform,
      mode: connection.mode,
      status: connection.status,
      is_enabled: connection.is_enabled,
      last_sync_at: connection.last_sync_at,
      last_error: connection.last_error,
      records_seen: connection.records_seen,
      records_matched: connection.records_matched,
      records_new: connection.records_new,
      current_source: connection.platform === 'trendyol' ? 'direct_api' : 'excel',
      current_source_active: connection.platform === 'trendyol'
        ? Boolean(trendyolResult.data?.is_active)
        : uploadCounts[connection.platform as 'amazon' | 'noon'] > 0,
      current_source_items: connection.platform === 'trendyol'
        ? null
        : uploadCounts[connection.platform as 'amazon' | 'noon'],
      current_source_last_sync_at: connection.platform === 'trendyol'
        ? trendyolResult.data?.last_sync_at || null
        : null,
    })),
  }
}

async function fetchMarketplaceOrders(token: string, from: Date, to: Date, connections: any[]) {
  const baseUrl = String(Deno.env.get('OMNIFUL_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '')
  const ordersByPlatform: Record<OmnifulMarketplace, OmnifulObservation[]> = {
    amazon: [], noon: [], trendyol: [],
  }
  let searchAfter = ''
  let pages = 0
  let providerRecords = 0
  let filteredOtherChannels = 0
  let invalidRecords = 0

  while (pages < 50) {
    const query = new URLSearchParams({
      created_from: dateOnly(from),
      created_to: dateOnly(to),
      per_page: '100',
    })
    if (searchAfter) query.set('search_after', searchAfter)
    const payload = await fetchJsonWithRetry(
      `${baseUrl}/sales-channel/public/v2/seller/orders?${query}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      'Omniful Orders API',
    )
    const rows = omnifulOrderRows(payload)
    providerRecords += rows.length
    for (const row of rows) {
      const platform = omnifulOrderPlatform(row)
      if (!platform) {
        filteredOtherChannels++
        continue
      }
      const connection = connections.find((item: any) => item.platform === platform)
      if (!connection || !matchesConnectionScope(row, connection)) continue
      const normalized = normalizeOmnifulObservation(row)
      if (normalized) ordersByPlatform[platform].push(normalized)
      else invalidRecords++
    }
    pages++
    const next = omnifulNextCursor(payload)
    if (!next || next === searchAfter || rows.length === 0) {
      searchAfter = next
      break
    }
    searchAfter = next
  }
  if (pages >= 50 && searchAfter) throw new HttpError(502, 'تجاوز رد Omniful حد الصفحات الآمن')
  const supportedRecords = TRIAL_PLATFORMS.reduce((sum, platform) => sum + ordersByPlatform[platform].length, 0)
  if (providerRecords > 0 && supportedRecords === 0) {
    throw new HttpError(409, 'رمز Omniful لا يعرض Amazon أو Noon أو Trendyol الخاصة بعطارة شمول؛ راجع ربط البائع داخل Omniful')
  }
  return { ordersByPlatform, pages, providerRecords, filteredOtherChannels, invalidRecords, lastCursor: searchAfter }
}

function matchesConnectionScope(row: Record<string, unknown>, connection: any) {
  if (connection.scope_strategy === 'seller_token') return true
  const candidates = scopeCandidates(row)
  if (connection.scope_strategy === 'seller_ref') {
    return candidates.seller.includes(String(connection.omniful_seller_ref || '').trim())
  }
  return candidates.store.includes(String(connection.omniful_store_ref || '').trim())
}

function scopeCandidates(row: Record<string, unknown>) {
  const seller = objectValue(row.seller)
  const store = objectValue(row.store)
  return {
    seller: [row.seller_id, row.seller_code, seller.id, seller.code, seller.name].map(clean).filter(Boolean),
    store: [row.store_id, row.store_code, row.store_name, store.id, store.code, store.name].map(clean).filter(Boolean),
  }
}

async function compareAndPersist(
  admin: any,
  merchantCode: string,
  platform: OmnifulMarketplace,
  observations: OmnifulObservation[],
) {
  const unique = new Map(observations.map(row => [row.omnifulOrderId, row]))
  const externalIds = [...new Set([...unique.values()].map(row => row.externalOrderId))]
  const canonical = new Map<string, string>()
  for (let index = 0; index < externalIds.length; index += 200) {
    const { data, error } = await admin.from('orders').select('id,order_id')
      .eq('merchant_code', merchantCode).eq('platform', platform)
      .in('order_id', externalIds.slice(index, index + 200))
    if (error) throw error
    for (const order of data || []) canonical.set(String(order.order_id), String(order.id))
  }

  const now = new Date().toISOString()
  const rows = [...unique.values()].map(order => {
    const canonicalOrderId = canonical.get(order.externalOrderId) || null
    return {
      merchant_code: merchantCode,
      platform,
      omniful_order_id: order.omnifulOrderId,
      external_order_id: order.externalOrderId,
      canonical_order_id: canonicalOrderId,
      sales_channel_tag: order.salesChannelTag || null,
      sales_channel_name: order.salesChannelName || null,
      store_name: order.storeName || null,
      match_status: canonicalOrderId ? 'matched_existing' : 'new_shadow',
      source_created_at: order.sourceCreatedAt,
      source_updated_at: order.sourceUpdatedAt,
      last_seen_at: now,
      raw: order.raw,
    }
  })
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin.from('omniful_order_observations').upsert(rows.slice(index, index + 200), {
      onConflict: 'merchant_code,platform,omniful_order_id',
    })
    if (error) throw error
  }
  const matched = rows.filter(row => row.match_status === 'matched_existing').length
  return { matched, newShadow: rows.length - matched, duplicates: observations.length - unique.size }
}

function resolveAccessToken(merchantCode: string) {
  const suffix = merchantCode.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const merchantToken = String(Deno.env.get(`OMNIFUL_ACCESS_TOKEN_${suffix}`) || '').trim()
  if (merchantToken) return { token: merchantToken, source: 'merchant' as const }
  return {
    token: String(Deno.env.get('OMNIFUL_ACCESS_TOKEN') || '').trim(),
    source: 'central' as const,
  }
}

async function markConnectionsError(admin: any, merchantCode: string, message: string) {
  await admin.from('omniful_connections').update({
    status: 'error', last_error: message, updated_at: new Date().toISOString(),
  }).eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).neq('status', 'disabled')
}

function dateOnly(date: Date) { return date.toISOString().slice(0, 10) }
function clean(value: unknown) { return String(value ?? '').trim() }
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
