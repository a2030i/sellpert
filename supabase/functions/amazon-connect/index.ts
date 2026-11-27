/**
 * amazon-connect
 * ─────────────────────────────────────────────────────────────────────────────
 * Amazon SP-API website authorization workflow for a signed-in Sellpert user.
 *
 *   status      → safe connection metadata for the merchant workspace
 *   start       → single-use state + Seller Central consent URL
 *   complete    → called by the SPA redirect page with Amazon's callback
 *                 parameters; verifies the state belongs to this caller and
 *                 workspace, exchanges the code, verifies the seller, stores
 *                 the refresh token encrypted
 *   disconnect  → removes the stored credential
 *
 * The refresh token never leaves the server. Only non-PII roles are used.
 * This function does not sync orders or financial data.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'
import { loadAmazonCaller } from '../_shared/amazonActor.ts'
import { loadAmazonAppConfig } from '../_shared/amazonAppConfig.ts'
import { authorizeMarketplaceWorkspace } from '../_shared/marketplaceAccountActor.ts'
import { requireMarketplaceAccount } from '../_shared/marketplaceAccountScope.ts'
import { selectAmazonSyncMarkets } from '../_shared/amazonCurrency.ts'
import { HttpError, json } from '../_shared/sync.ts'
import {
  AMAZON_MARKETPLACES,
  AMAZON_STATE_TTL_MINUTES,
  DEFAULT_AMAZON_MARKETPLACE,
  buildConsentUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  fetchMarketplaceParticipations,
  hashOAuthState,
  isWellFormedOAuthCode,
  isWellFormedSellingPartnerId,
  isWellFormedState,
  supportedParticipations,
  verifyAmazonSellerIdentity,
} from '../_shared/amazonSpApi.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token || token === SERVICE_KEY) throw new HttpError(401, 'Unauthorized')
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) throw new HttpError(401, 'Unauthorized')
    const caller = await loadAmazonCaller(createClient, SUPABASE_URL, SERVICE_KEY, token, user.id)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'status')
    const merchantCode = await authorizeMarketplaceWorkspace(admin, caller, user.id, body?.merchant_code)

    if (action === 'status') return json(await connectionStatus(admin, merchantCode), 200, corsHeaders)
    if (action === 'start') return json(await startAuthorization(admin, merchantCode, user.id, body?.marketplace_id, body?.marketplace_account_id), 200, corsHeaders)
    if (action === 'complete') return json(await completeAuthorization(admin, merchantCode, user.id, body), 200, corsHeaders)
    if (action === 'disconnect') return json(await disconnect(admin, merchantCode, body?.marketplace_account_id), 200, corsHeaders)
    throw new HttpError(400, 'Unsupported action')
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('[amazon-connect] unexpected failure:', error?.name || 'Error')
    return json({ error: status === 500 ? 'Unexpected error' : error.message }, status, corsHeaders)
  }
})

async function connectionStatus(admin: any, merchantCode: string) {
  const config = await loadAmazonAppConfig(admin, Deno.env)
  const { data, error } = await admin.from('platform_credentials')
    .select('marketplace_account_id,seller_id,is_active,test_status,last_tested_at,last_sync_at,created_at,updated_at,extra')
    .eq('merchant_code', merchantCode).eq('platform', 'amazon').order('created_at')
  if (error) throw error
  const connections = (data || []).map((row: any) => ({
    marketplace_account_id: row.marketplace_account_id, seller_id: row.seller_id, is_active: row.is_active,
    test_status: row.test_status, last_tested_at: row.last_tested_at, last_sync_at: row.last_sync_at,
    connected_at: row.extra?.connected_at || row.created_at,
    marketplaces: Array.isArray(row.extra?.marketplaces) ? row.extra.marketplaces : [],
  }))
  return { app_configured: Boolean(config), connections, connection: connections[0] || null }
}

async function startAuthorization(admin: any, merchantCode: string, userId: string, requestedMarketplace: unknown, requestedAccount: unknown) {
  const config = await loadAmazonAppConfig(admin, Deno.env)
  if (!config) throw new HttpError(503, 'ربط أمازون غير مهيأ بعد على الخادم')
  const marketplaceId = String(requestedMarketplace || DEFAULT_AMAZON_MARKETPLACE)
  if (!AMAZON_MARKETPLACES[marketplaceId]) throw new HttpError(400, 'سوق أمازون غير مدعوم')

  // Housekeeping: expired or used states have no further purpose.
  await admin.from('amazon_oauth_states').delete().lt('expires_at', new Date().toISOString())
  await admin.from('amazon_oauth_states').delete().eq('user_id', userId).not('consumed_at', 'is', null)

  const account = await requireMarketplaceAccount(admin, merchantCode, 'amazon', requestedAccount, false)
  const state = createOAuthState()
  const now = new Date()
  const { error } = await admin.from('amazon_oauth_states').insert({
    state_hash: await hashOAuthState(state),
    marketplace_account_id: account.id,
    merchant_code: merchantCode,
    user_id: userId,
    marketplace_id: marketplaceId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + AMAZON_STATE_TTL_MINUTES * 60_000).toISOString(),
  })
  if (error) throw error
  return { ok: true, consent_url: buildConsentUrl(config, state, marketplaceId) }
}

async function completeAuthorization(admin: any, merchantCode: string, userId: string, body: any) {
  const config = await loadAmazonAppConfig(admin, Deno.env)
  if (!config) throw new HttpError(503, 'ربط أمازون غير مهيأ بعد على الخادم')
  const state = body?.state
  const sellingPartnerId = body?.selling_partner_id
  const code = body?.spapi_oauth_code
  if (!isWellFormedState(state)) throw new HttpError(400, 'رابط الربط غير صالح، ابدأ الربط من جديد')
  if (!isWellFormedSellingPartnerId(sellingPartnerId) || !isWellFormedOAuthCode(code)) {
    throw new HttpError(400, 'بيانات أمازون غير مكتملة، ابدأ الربط من جديد')
  }

  // Consume the state atomically: it must exist, belong to this caller and
  // workspace, be unexpired and unused. A second request gets no row.
  const { data: consumed, error: consumeError } = await admin.from('amazon_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_hash', await hashOAuthState(state))
    .eq('user_id', userId)
    .eq('merchant_code', merchantCode)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('marketplace_id,marketplace_account_id')
    .maybeSingle()
  if (consumeError) throw consumeError
  if (!consumed) throw new HttpError(400, 'انتهت صلاحية طلب الربط أو استُخدم من قبل، ابدأ الربط من جديد')

  const account = await requireMarketplaceAccount(admin, merchantCode, 'amazon', consumed.marketplace_account_id, false)
  const tokens = await exchangeAuthorizationCode(config, code)
  const region = AMAZON_MARKETPLACES[consumed.marketplace_id]?.region || 'eu'
  const participations = supportedParticipations(await fetchMarketplaceParticipations(tokens.accessToken, region))
  if (!participations.length) {
    throw new HttpError(409, 'الربط والمزامنة متاحان حاليًا لحساب يبيع في أمازون السعودية فقط')
  }
  // Connecting disables file imports; require a market the SAR pipeline can sync.
  selectAmazonSyncMarkets(participations.map(row => ({ id: row.marketplaceId })))
  await verifyAmazonSellerIdentity(tokens.accessToken, sellingPartnerId, participations[0].marketplaceId, region)

  const { data: duplicate, error: duplicateError } = await admin.from('platform_credentials')
    .select('merchant_code').eq('platform', 'amazon').eq('seller_id', sellingPartnerId)
    .neq('merchant_code', merchantCode).eq('is_active', true).limit(1).maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) throw new HttpError(409, 'حساب أمازون هذا مرتبط بمساحة عمل أخرى')

  const now = new Date().toISOString()
  const marketplaces = participations.map(row => ({ id: row.marketplaceId, country: row.countryCode, name: row.name }))
  const {error:saveError} = await admin.rpc('save_marketplace_credential', {
    p_account_id:account.id,p_merchant_code:merchantCode,p_platform:'amazon',p_seller_id:sellingPartnerId,
    p_extra:{secret_blob:await encryptCredentialPayload({ refresh_token: tokens.refreshToken }),region,marketplaces,connected_at:now,connected_by:userId},
  })
  if (saveError) throw new HttpError(409, 'تعذر حفظ الربط. تأكد أن حساب البائع غير مرتبط مسبقًا وأن المزامنة متوقفة.')
  return { ok: true, seller_id: sellingPartnerId, marketplaces }
}

async function disconnect(admin: any, merchantCode: string, requestedAccount: unknown) {
  const account = await requireMarketplaceAccount(admin,merchantCode,'amazon',requestedAccount,false)
  const {error} = await admin.rpc('disconnect_marketplace_account',{p_account_id:account.id,p_merchant_code:merchantCode})
  if (error) throw new HttpError(409,'تعذر إلغاء الربط أثناء المزامنة. أعد المحاولة لاحقًا.')
  return {ok:true}
}
