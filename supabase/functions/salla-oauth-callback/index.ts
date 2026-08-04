/**
 * salla-oauth-callback
 * ─────────────────────────────────────────────────────────────────────────────
 * Called by Salla after merchant authorises the app.
 * URL pattern:  GET /functions/v1/salla-oauth-callback?code=XXX&store_id=YYY
 *
 * Flow:
 *  1. Exchange code → Salla access_token + refresh_token (the code exchange
 *     against Salla's token endpoint is the trust anchor for this callback)
 *  3. Fetch store info from Salla API
 *  4. Find or create Sellpert merchant account
 *  5. Upsert salla_connections
 *  6. Redirect merchant to dashboard with magic-link / temp token
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.104.0'
import { getSettings } from '../_shared/getSettings.ts'
import { generateAccountCode, normalizeEmail } from '../_shared/accountSecurity.ts'

const SALLA_TOKEN_URL = 'https://accounts.salla.sa/oauth2/token'
const SALLA_STORE_API = 'https://api.salla.dev/admin/v2/store/info'
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Load settings from DB (admin panel) ──────────────────────────────────
  const cfg = await getSettings(admin)
  const { clientId: SALLA_CLIENT_ID, clientSecret: SALLA_CLIENT_SECRET, appUrl: APP_URL } = cfg

  try {
    const url     = new URL(req.url)
    const code    = url.searchParams.get('code')
    const storeId = url.searchParams.get('store_id')

    if (!code) {
      return redirect(`${APP_URL}?error=missing_code`)
    }

    if (!SALLA_CLIENT_ID || !SALLA_CLIENT_SECRET) {
      console.error('SALLA_CLIENT_ID or SALLA_CLIENT_SECRET not configured in app_settings')
      return redirect(`${APP_URL}?error=app_not_configured`)
    }

    // ── Step 1: Exchange code for tokens ──────────────────────────────────────
    const tokenRes = await fetch(SALLA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     SALLA_CLIENT_ID,
        client_secret: SALLA_CLIENT_SECRET,
        code,
        redirect_uri: `${SUPABASE_URL}/functions/v1/salla-oauth-callback`,
      }).toString(),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Salla token exchange failed:', err)
      return redirect(`${APP_URL}?error=token_exchange_failed`)
    }

    const tokens = await tokenRes.json()
    const accessToken  = tokens.access_token
    const refreshToken = tokens.refresh_token
    const expiresIn    = tokens.expires_in || 3600

    // ── Step 2: Fetch store info ──────────────────────────────────────────────
    const storeRes = await fetch(SALLA_STORE_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!storeRes.ok) {
      console.error('Salla store verification failed:', storeRes.status)
      return redirect(`${APP_URL}?error=store_verification_failed`)
    }
    const storeBody = await storeRes.json().catch(() => ({}))
    const storeInfo: any = storeBody.data || {}
    const verifiedStoreId = String(storeInfo.id || '').trim()
    if (!verifiedStoreId) {
      console.error('Salla store verification returned no store id')
      return redirect(`${APP_URL}?error=store_verification_failed`)
    }
    if (storeId && String(storeId) !== verifiedStoreId) {
      console.error('Salla callback store id did not match the verified token store')
      return redirect(`${APP_URL}?error=store_mismatch`)
    }

    const sallaStoreId  = verifiedStoreId
    const storeName     = storeInfo.name  || 'متجر سلة'
    const storeDomain   = storeInfo.domain || ''
    const storeCurrency = storeInfo.currency?.currency_iso || 'SAR'
    const storeLogo     = storeInfo.logo?.url || ''
    const merchantEmail = normalizeEmail(storeInfo.email) || `${sallaStoreId}@salla.store`

    // ── Step 3: Find or create merchant ──────────────────────────────────────
    let merchantCode: string
    let isNew = false
    let tempPassword: string | null = null

    // Check if salla_connections already exists
    const { data: existingConn } = await admin
      .from('salla_connections')
      .select('merchant_code')
      .eq('salla_store_id', sallaStoreId)
      .maybeSingle()

    if (existingConn) {
      // Existing connection → just refresh tokens
      merchantCode = existingConn.merchant_code
      await admin.from('salla_connections').update({
        access_token:    accessToken,
        refresh_token:   refreshToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        uninstalled_at:  null,
        sync_status:     'idle',
        updated_at:      new Date().toISOString(),
      }).eq('salla_store_id', sallaStoreId)

      // Reactivate if suspended
      await admin.rpc('reactivate_merchant', { p_merchant_code: merchantCode })

    } else {
      // Existing Sellpert identities are linked without changing credentials.
      const { data: existingMerchant } = await admin
        .from('merchants')
        .select('id')
        .eq('email', merchantEmail)
        .maybeSingle()

      if (existingMerchant) {
        // Store email alone is not proof that the OAuth browser owns an
        // existing Sellpert account. Never issue a magic link for it.
        return redirect(`${APP_URL}?error=account_exists`)
      } else {
        isNew = true
        tempPassword = generatePassword()
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: merchantEmail,
          password: tempPassword,
          email_confirm: true,
        })
        if (createErr || !newUser.user) {
          console.error('Auth user create error:', createErr)
          const reason = /already registered|already been registered/i.test(createErr?.message || '')
            ? 'account_exists'
            : 'account_creation_failed'
          return redirect(`${APP_URL}?error=${reason}`)
        }

        let insertErr: { code?: string; message: string } | null = null
        merchantCode = ''
        for (let attempt = 0; attempt < 3; attempt += 1) {
          merchantCode = generateAccountCode('M')
          const result = await admin.from('merchants').insert({
            id: newUser.user.id,
            merchant_code: merchantCode,
            name: String(storeName).trim().slice(0, 120) || 'متجر سلة',
            email: merchantEmail,
            currency: 'SAR',
            logo_url: storeLogo,
            role: 'merchant',
            subscription_plan: 'free',
            subscription_status: 'active',
            salla_store_id: sallaStoreId,
            signup_source: 'salla_app',
            onboarding_done: false,
            is_active: true,
          })
          insertErr = result.error
          if (!insertErr) break
          const codeCollision = insertErr.code === '23505' && /merchant_code/i.test(insertErr.message)
          if (!codeCollision) break
        }
        if (insertErr) {
          await admin.auth.admin.deleteUser(newUser.user.id)
          console.error('Merchant insert error:', insertErr)
          return redirect(`${APP_URL}?error=merchant_creation_failed`)
        }
      }

      // Create salla_connections record
      await admin.from('salla_connections').insert({
        merchant_code:    merchantCode,
        salla_store_id:   sallaStoreId,
        salla_merchant_id: String(storeInfo.merchant_id || ''),
        store_name:       storeName,
        store_domain:     storeDomain,
        store_currency:   storeCurrency,
        store_logo:       storeLogo,
        access_token:     accessToken,
        refresh_token:    refreshToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        installed_at:     new Date().toISOString(),
        sync_status:      'idle',
      })

      // Welcome notification
      const { error: welcomeError } = await admin.from('notifications').insert({
        merchant_code: merchantCode,
        title:         'مرحباً بك في Sellpert',
        body:          `تم ربط متجر "${storeName}" بنجاح. يمكنك الآن مزامنة طلباتك ومنتجاتك تلقائياً.`,
        type:          'welcome',
      })
      if (welcomeError) console.warn('Unable to create Salla welcome notification:', welcomeError.message)
    }

    // ── Step 4: Create magic link / sign-in token for auto-login ─────────────
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: merchantEmail,
    })

    const redirectUrl = linkData?.properties?.hashed_token
      ? `${APP_URL}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/`
      : `${APP_URL}?new=${isNew ? '1' : '0'}&store=${sallaStoreId}`

    // Log the install event
    const { error: installLogError } = await admin.from('webhook_events').insert({
      source:       'salla',
      event_type:   'app.installed',
      store_id:     sallaStoreId,
      merchant_code: merchantCode,
      payload:      { store_name: storeName, is_new: isNew },
      status:       'processed',
      processed_at: new Date().toISOString(),
    })
    if (installLogError) console.warn('Unable to record Salla install event:', installLogError.message)

    return redirect(redirectUrl)

  } catch (e: any) {
    console.error('OAuth callback error:', e)
    // لا نعكس نص الاستثناء الداخلي في الرابط — رمز عام فقط والتفاصيل في السجلات
    return redirect(`${APP_URL}?error=unexpected`)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } })
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => chars[b % chars.length])
    .join('')
}
