import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { verifyTrendyolCredentials } from '../_shared/trendyolConnection.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Auth check
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: authErr } = await caller.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // يجب أن يكون للمستدعي حساب في النظام (تاجر أو طاقم) — ليس مجرد توكن صالح
    const { data: callerRow } = await caller
      .from('merchants').select('role,is_active').eq('id', user.id).maybeSingle()
    if (!callerRow || callerRow.is_active === false) return json({ error: 'Forbidden' }, 403)

    const { platform, seller_id, api_key, api_secret, extra } = await req.json()
    if (!platform) return json({ error: 'platform required' }, 400)

    switch (platform) {
      case 'trendyol':  return json(await testTrendyol(seller_id, api_key, api_secret))
      case 'noon':      return json(await testNoon(extra?.service_account, extra?.token_endpoint))
      case 'amazon':    return json(await testAmazon(api_key, api_secret, extra?.refresh_token))
      default:          return json({ ok: false, error: 'منصة غير مدعومة' })
    }
  } catch (e: any) {
    return json({ ok: false, error: e.message })
  }
})

// ── Trendyol ─────────────────────────────────────────────────────────────────
// Test: GET the international orders endpoint with a one-item page.
// Auth: Basic base64(apiKey:apiSecret)

async function testTrendyol(sellerId: string, apiKey: string, apiSecret: string) {
  try {
    await verifyTrendyolCredentials(sellerId, apiKey, apiSecret)
    return { ok: true, message: '✅ تم التحقق بنجاح — حساب Trendyol متصل وجاهز للمزامنة' }
  } catch (error: any) {
    return { ok: false, error: error.message }
  }
}

// ── Noon ─────────────────────────────────────────────────────────────────────
// Noon Partner service-account flow. A successful token exchange verifies the
// private key and account identity without treating a 404 as false success.
async function testNoon(serviceAccount: any, configuredTokenEndpoint?: string) {
  if (typeof serviceAccount === 'string') {
    try { serviceAccount = JSON.parse(serviceAccount) } catch { return { ok: false, error: 'Service Account JSON غير صالح' } }
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    return { ok: false, error: 'Service Account JSON الخاص بنون مطلوب' }
  }
  const tokenEndpoint = allowNoonTokenUrl(configuredTokenEndpoint)
  const now = Math.floor(Date.now() / 1000)
  const message = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: tokenEndpoint,
    iat: now,
    exp: now + 3600,
  })}`
  const pem = String(serviceAccount.private_key).replace(/\\n/g, '\n')
  const key = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(key), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(message),
  )
  const jwt = `${message}.${base64UrlBytes(new Uint8Array(signature))}`
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok && data.access_token) {
    return { ok: true, message: '✅ تم التحقق من حساب خدمة نون بنجاح' }
  }
  return { ok: false, error: `فشل تفويض نون (${res.status}): ${data.error_description || data.error || 'بيانات غير صحيحة'}` }
}

function allowNoonTokenUrl(value?: string) {
  const url = new URL(value || 'https://idp.noon.partners/token')
  if (url.protocol !== 'https:' || !(url.hostname === 'noon.partners' || url.hostname.endsWith('.noon.partners'))) {
    throw new Error('Noon token endpoint غير مسموح')
  }
  return url.toString()
}

function base64UrlJson(value: unknown) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function base64UrlBytes(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// ── Amazon SP-API ─────────────────────────────────────────────────────────────
// Test: Exchange refresh_token for access_token via LWA
// If LWA returns access_token → credentials valid

async function testAmazon(clientId: string, clientSecret: string, refreshToken: string) {
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, error: 'LWA Client ID و Client Secret و Refresh Token مطلوبة' }
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  })

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const data = await res.json()

  if (res.status === 200 && data.access_token) {
    return {
      ok: true,
      message: '✅ تم التحقق بنجاح — حساب أمازون متصل وجاهز للمزامنة',
      details: { token_type: data.token_type },
    }
  }

  const errDesc = data.error_description || data.error || 'بيانات غير صحيحة'

  if (errDesc.includes('invalid_client') || errDesc.includes('client')) {
    return { ok: false, error: 'LWA Client ID أو Client Secret خاطئ' }
  }

  if (errDesc.includes('invalid_grant') || errDesc.includes('refresh_token')) {
    return { ok: false, error: 'Refresh Token منتهي أو خاطئ — أعد ربط التطبيق في Seller Central' }
  }

  return { ok: false, error: `خطأ أمازون: ${errDesc}` }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
