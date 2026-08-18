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
import { decryptCredentialPayload, encryptCredentialPayload } from '../_shared/credentialVault.ts'
import {
  accessTokenExpiresSoon,
  buildOmnifulCredentials,
  credentialsAreComplete,
  mergeOmnifulTokenResponse,
  type OmnifulCredentials,
} from '../_shared/omnifulCredentials.ts'

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

    const action = String(body?.action || 'status')
    if (action === 'save_account_credentials' || action === 'save_account_token') {
      return json(await saveMerchantAccountCredentials(admin, merchantCode, body), 200, corsHeaders)
    }
    if (action === 'remove_account_token') {
      return json(await removeMerchantAccountToken(admin, merchantCode), 200, corsHeaders)
    }
    if (action === 'use_central_account') {
      await requirePortalAdmin(req, admin)
      return json(await useCentralAccount(admin, merchantCode), 200, corsHeaders)
    }
    if (action === 'configure_mapping') {
      await requirePortalAdmin(req, admin)
      return json(await configureMapping(admin, merchantCode, body), 200, corsHeaders)
    }
    if (action === 'configure_portal') {
      await requirePortalAdmin(req, admin)
      return json(await configurePortal(admin, merchantCode, body), 200, corsHeaders)
    }
    const connections = await getConnections(admin, merchantCode)
    if (action === 'status') return json(await connectionStatus(admin, merchantCode, connections), 200, corsHeaders)
    if (action !== 'sync') throw new HttpError(400, 'Unsupported action')
    if (connections.length === 0) throw new HttpError(409, 'لم تُضبط خرائط Omniful لهذا المتجر بعد')
    const enabledConnections = connections.filter((connection: any) => connection.is_enabled && connection.status !== 'disabled')
    if (enabledConnections.length === 0) throw new HttpError(409, 'تجربة Omniful موقوفة لهذا المتجر')

    let tokenContext = await resolveAccessToken(admin, merchantCode, true)
    if (!tokenContext.token) {
      await markConnectionsError(admin, merchantCode, 'لم يُضبط رمز وصول Omniful الآمن بعد')
      throw new HttpError(409, 'اربط حساب Omniful لهذا التاجر قبل أول مزامنة')
    }
    if (tokenContext.source === 'central') {
      const invalidScope = enabledConnections.find((connection: any) => (
        connection.scope_strategy === 'seller_token'
        || (connection.scope_strategy === 'seller_ref' && !connection.omniful_seller_ref)
        || (connection.scope_strategy === 'store_ref' && !connection.omniful_store_ref)
      ))
      if (invalidScope) {
        throw new HttpError(409, `يلزم تحديد عزل آمن لقناة ${invalidScope.platform} قبل استخدام توكن Omniful المركزي`)
      }
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

    let result: Awaited<ReturnType<typeof fetchMarketplaceOrders>>
    try {
      result = await fetchMarketplaceOrders(tokenContext.token, from, to, enabledConnections)
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401 || tokenContext.source !== 'merchant' || !tokenContext.credentials) throw error
      tokenContext = await refreshAndPersistMerchantCredentials(admin, merchantCode, tokenContext.credentials)
      result = await fetchMarketplaceOrders(tokenContext.token, from, to, enabledConnections)
    }
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
      }).eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).eq('is_enabled', true).neq('status', 'disabled')
    }
    return json({ error: message }, status, corsHeaders)
  }
})

async function requirePortalAdmin(req: Request, admin: any) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (token === SERVICE_KEY) return
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw new HttpError(401, 'Unauthorized')
  const { data: caller, error: callerError } = await admin.from('merchants')
    .select('role,is_active').eq('id', user.id).maybeSingle()
  if (callerError) throw callerError
  if (!caller || caller.is_active === false || !['admin', 'super_admin'].includes(caller.role)) {
    throw new HttpError(403, 'إعداد رابط Omniful متاح للإدارة فقط')
  }
}

async function getConnections(admin: any, merchantCode: string) {
  const { data, error } = await admin.from('omniful_connections')
    .select('id,merchant_code,platform,mode,status,scope_strategy,omniful_seller_ref,omniful_store_ref,is_enabled,last_sync_at,last_error,records_seen,records_matched,records_new,updated_at')
    .eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).order('platform')
  if (error) throw error
  return data || []
}

async function connectionStatus(admin: any, merchantCode: string, connections: any[]) {
  const [uploadsResult, trendyolResult, portalResult] = await Promise.all([
    admin.from('platform_file_uploads').select('platform')
      .eq('merchant_code', merchantCode).in('platform', ['amazon', 'noon']).eq('status', 'success'),
    admin.from('platform_credentials').select('is_active,last_sync_at')
      .eq('merchant_code', merchantCode).eq('platform', 'trendyol').maybeSingle(),
    admin.from('omniful_merchant_portals').select('portal_url,seller_scope_label,updated_at')
      .eq('merchant_code', merchantCode).maybeSingle(),
  ])
  if (uploadsResult.error) throw uploadsResult.error
  if (trendyolResult.error) throw trendyolResult.error
  if (portalResult.error) throw portalResult.error
  const uploadCounts = { amazon: 0, noon: 0 }
  for (const upload of uploadsResult.data || []) {
    const platform = String(upload.platform)
    if (platform === 'amazon' || platform === 'noon') uploadCounts[platform]++
  }
  return {
    available: connections.length > 0,
    account: await accountStatus(admin, merchantCode),
    portal: {
      configured: Boolean(portalResult.data?.portal_url),
      url: portalResult.data?.portal_url || null,
      seller_scope_label: portalResult.data?.seller_scope_label || null,
      updated_at: portalResult.data?.updated_at || null,
    },
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
      scope_strategy: connection.scope_strategy,
      omniful_seller_ref: connection.omniful_seller_ref,
      omniful_store_ref: connection.omniful_store_ref,
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

async function configureMapping(admin: any, merchantCode: string, body: any) {
  const platform = clean(body?.platform).toLowerCase() as OmnifulMarketplace
  if (!TRIAL_PLATFORMS.includes(platform)) throw new HttpError(400, 'منصة Omniful غير مدعومة')

  const scopeStrategy = clean(body?.scope_strategy) || 'store_ref'
  if (!['seller_ref', 'store_ref'].includes(scopeStrategy)) {
    throw new HttpError(400, 'اختر العزل بمعرّف البائع أو المتجر')
  }
  const sellerRef = clean(body?.omniful_seller_ref).slice(0, 240) || null
  const storeRef = clean(body?.omniful_store_ref).slice(0, 240) || null
  if (scopeStrategy === 'seller_ref' && !sellerRef) throw new HttpError(400, 'Seller ID مطلوب لطريقة العزل المختارة')
  if (scopeStrategy === 'store_ref' && !storeRef) throw new HttpError(400, 'Store ID مطلوب لطريقة العزل المختارة')

  const now = new Date().toISOString()
  const { data, error } = await admin.from('omniful_connections').upsert({
    merchant_code: merchantCode,
    platform,
    mode: 'shadow',
    status: 'pending',
    scope_strategy: scopeStrategy,
    omniful_seller_ref: sellerRef,
    omniful_store_ref: storeRef,
    is_enabled: true,
    last_error: null,
    updated_at: now,
  }, { onConflict: 'merchant_code,platform' })
    .select('platform,mode,status,scope_strategy,omniful_seller_ref,omniful_store_ref,is_enabled,updated_at')
    .single()
  if (error) throw error
  return { ok: true, connection: data }
}

async function saveMerchantAccountCredentials(admin: any, merchantCode: string, body: any) {
  let credentials = buildOmnifulCredentials({
    client_id: body?.client_id,
    client_secret: body?.client_secret,
    refresh_token: body?.refresh_token,
    access_token: body?.access_token,
  })
  if (!credentialsAreComplete(credentials)) {
    throw new HttpError(400, 'أدخل Client ID وClient Secret وRefresh Token وAccess Token من Omniful')
  }
  if ([credentials.client_id, credentials.client_secret, credentials.refresh_token, credentials.access_token]
    .some(value => value.length > 4096)) {
    throw new HttpError(400, 'إحدى بيانات اعتماد Omniful أطول من الحد المسموح')
  }

  try {
    await testOmnifulToken(credentials.access_token)
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error
    credentials = await refreshOmnifulCredentials(credentials)
    await testOmnifulToken(credentials.access_token)
  }
  const now = new Date().toISOString()
  const secretBlob = await encryptCredentialPayload(credentials)
  const { error } = await admin.from('omniful_account_credentials').upsert({
    merchant_code: merchantCode,
    connection_mode: 'merchant_account',
    secret_blob: secretBlob,
    token_hint: credentials.access_token.slice(-4),
    last_tested_at: now,
    last_error: null,
    updated_at: now,
  }, { onConflict: 'merchant_code' })
  if (error) throw error

  const rows = TRIAL_PLATFORMS.map(platform => ({
    merchant_code: merchantCode,
    platform,
    mode: 'shadow',
    status: 'pending',
    scope_strategy: 'seller_token',
    omniful_seller_ref: null,
    omniful_store_ref: null,
    is_enabled: true,
    last_error: null,
    updated_at: now,
  }))
  const { error: connectionError } = await admin.from('omniful_connections')
    .upsert(rows, { onConflict: 'merchant_code,platform' })
  if (connectionError) throw connectionError

  return {
    ok: true,
    account: {
      mode: 'merchant_account',
      token_configured: true,
      credentials_configured: true,
      token_hint: credentials.access_token.slice(-4),
      last_tested_at: now,
      access_token_expires_at: credentials.access_token_expires_at,
      refresh_token_expires_at: credentials.refresh_token_expires_at,
    },
  }
}

async function removeMerchantAccountToken(admin: any, merchantCode: string) {
  const { error } = await admin.from('omniful_account_credentials')
    .delete().eq('merchant_code', merchantCode).eq('connection_mode', 'merchant_account')
  if (error) throw error
  const { error: connectionError } = await admin.from('omniful_connections').update({
    is_enabled: false,
    status: 'pending',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS)
  if (connectionError) throw connectionError
  return { ok: true, account: { mode: 'merchant_account', token_configured: false } }
}

async function useCentralAccount(admin: any, merchantCode: string) {
  const now = new Date().toISOString()
  const { error } = await admin.from('omniful_account_credentials').upsert({
    merchant_code: merchantCode,
    connection_mode: 'central_account',
    secret_blob: null,
    token_hint: null,
    last_tested_at: null,
    last_error: null,
    updated_at: now,
  }, { onConflict: 'merchant_code' })
  if (error) throw error
  return {
    ok: true,
    account: {
      mode: 'central_account',
      token_configured: Boolean(String(Deno.env.get('OMNIFUL_ACCESS_TOKEN') || '').trim()),
      token_hint: null,
      last_tested_at: null,
    },
  }
}

async function accountStatus(admin: any, merchantCode: string) {
  const tokenContext = await resolveAccessToken(admin, merchantCode, false)
  return {
    mode: tokenContext.mode,
    token_configured: Boolean(tokenContext.token),
    credentials_configured: tokenContext.source === 'central'
      ? Boolean(tokenContext.token)
      : Boolean(tokenContext.credentials && credentialsAreComplete(tokenContext.credentials)),
    token_hint: tokenContext.tokenHint,
    last_tested_at: tokenContext.lastTestedAt,
    access_token_expires_at: tokenContext.credentials?.access_token_expires_at || null,
    refresh_token_expires_at: tokenContext.credentials?.refresh_token_expires_at || null,
  }
}

async function testOmnifulToken(token: string) {
  const baseUrl = String(Deno.env.get('OMNIFUL_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '')
  await fetchJsonWithRetry(
    `${baseUrl}/sales-channel/public/v1/channels/integrations?page=1&per_page=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    'Omniful',
    2,
  )
}

async function configurePortal(admin: any, merchantCode: string, body: any) {
  const portalUrl = normalizePortalUrl(body?.portal_url)
  const sellerScopeLabel = clean(body?.seller_scope_label).slice(0, 160) || null
  const now = new Date().toISOString()
  const { data, error } = await admin.from('omniful_merchant_portals').upsert({
    merchant_code: merchantCode,
    portal_url: portalUrl,
    seller_scope_label: sellerScopeLabel,
    updated_at: now,
  }, { onConflict: 'merchant_code' }).select('portal_url,seller_scope_label,updated_at').single()
  if (error) throw error
  return {
    ok: true,
    portal: {
      configured: Boolean(data.portal_url),
      url: data.portal_url,
      seller_scope_label: data.seller_scope_label,
      updated_at: data.updated_at,
    },
  }
}

function normalizePortalUrl(value: unknown): string | null {
  const raw = clean(value)
  if (!raw) return null
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new HttpError(400, 'رابط مساحة Omniful غير صالح') }
  const hostname = parsed.hostname.toLowerCase()
  const officialHost = hostname === 'omniful.com' || hostname.endsWith('.omniful.com')
    || hostname === 'omniful.ai' || hostname.endsWith('.omniful.ai')
  if (parsed.protocol !== 'https:' || !officialHost || parsed.username || parsed.password) {
    throw new HttpError(400, 'استخدم رابط HTTPS رسميًا من نطاق Omniful فقط')
  }
  parsed.hash = ''
  return parsed.toString()
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
    throw new HttpError(409, 'حساب Omniful لا يعرض Amazon أو Noon أو Trendyol لهذا التاجر؛ راجع القنوات المربوطة داخل Omniful')
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

async function refreshOmnifulCredentials(credentials: OmnifulCredentials): Promise<OmnifulCredentials> {
  const baseUrl = String(Deno.env.get('OMNIFUL_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '')
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${baseUrl}/sales-channel/public/v1/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: credentials.refresh_token,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        grant_type: 'refresh_token',
      }),
    })
    lastStatus = response.status
    if (response.ok) {
      const payload = await response.json().catch(() => null)
      const refreshed = mergeOmnifulTokenResponse(credentials, payload)
      if (!refreshed) throw new HttpError(502, 'لم يُرجع Omniful رمز وصول جديدًا')
      return refreshed
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break
    const retryAfter = Number(response.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * (2 ** attempt) + Math.floor(Math.random() * 250)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  if (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) {
    throw new HttpError(409, 'انتهت صلاحية بيانات Omniful؛ انسخ بيانات اعتماد جديدة من صفحة التكامل')
  }
  throw new HttpError(502, `تعذر تجديد اتصال Omniful (${lastStatus || 'network'})`)
}

async function refreshAndPersistMerchantCredentials(admin: any, merchantCode: string, current: OmnifulCredentials) {
  if (!credentialsAreComplete(current)) {
    throw new HttpError(409, 'أعد حفظ Client ID وClient Secret وRefresh Token لتفعيل التجديد التلقائي')
  }
  const credentials = await refreshOmnifulCredentials(current)
  const now = new Date().toISOString()
  const secretBlob = await encryptCredentialPayload(credentials)
  const { error } = await admin.from('omniful_account_credentials').update({
    secret_blob: secretBlob,
    token_hint: credentials.access_token.slice(-4),
    last_tested_at: now,
    last_error: null,
    updated_at: now,
  }).eq('merchant_code', merchantCode).eq('connection_mode', 'merchant_account')
  if (error) throw error
  return {
    token: credentials.access_token,
    source: 'merchant' as const,
    mode: 'merchant_account' as const,
    tokenHint: credentials.access_token.slice(-4),
    lastTestedAt: now,
    credentials,
  }
}

async function resolveAccessToken(admin: any, merchantCode: string, refreshIfExpiring = false) {
  const { data, error } = await admin.from('omniful_account_credentials')
    .select('connection_mode,secret_blob,token_hint,last_tested_at')
    .eq('merchant_code', merchantCode).maybeSingle()
  if (error) throw error

  if (data?.connection_mode === 'central_account') {
    return {
      token: String(Deno.env.get('OMNIFUL_ACCESS_TOKEN') || '').trim(),
      source: 'central' as const,
      mode: 'central_account' as const,
      tokenHint: null,
      lastTestedAt: data.last_tested_at || null,
      credentials: null,
    }
  }

  if (data?.connection_mode === 'merchant_account' && data.secret_blob) {
    const secret = await decryptCredentialPayload(data.secret_blob)
    const credentials = buildOmnifulCredentials(secret)
    if (refreshIfExpiring && credentialsAreComplete(credentials) && accessTokenExpiresSoon(credentials)) {
      return await refreshAndPersistMerchantCredentials(admin, merchantCode, credentials)
    }
    return {
      token: credentials.access_token,
      source: 'merchant' as const,
      mode: 'merchant_account' as const,
      tokenHint: data.token_hint || null,
      lastTestedAt: data.last_tested_at || null,
      credentials,
    }
  }

  return {
    token: '',
    source: 'merchant' as const,
    mode: 'merchant_account' as const,
    tokenHint: null,
    lastTestedAt: null,
    credentials: null,
  }
}

async function markConnectionsError(admin: any, merchantCode: string, message: string) {
  await admin.from('omniful_connections').update({
    status: 'error', last_error: message, updated_at: new Date().toISOString(),
  }).eq('merchant_code', merchantCode).in('platform', TRIAL_PLATFORMS).eq('is_enabled', true).neq('status', 'disabled')
}

function dateOnly(date: Date) { return date.toISOString().slice(0, 10) }
function clean(value: unknown) { return String(value ?? '').trim() }
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
