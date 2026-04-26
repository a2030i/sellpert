import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const { platform, seller_id, api_key, api_secret, extra } = await req.json()
    if (!platform) return json({ error: 'platform required' }, 400)

    switch (platform) {
      case 'trendyol':  return json(await testTrendyol(seller_id, api_key, api_secret))
      case 'noon':      return json(await testNoon(seller_id, api_key))
      case 'amazon':    return json(await testAmazon(api_key, api_secret, extra?.refresh_token))
      default:          return json({ ok: false, error: 'منصة غير مدعومة' })
    }
  } catch (e: any) {
    return json({ ok: false, error: e.message })
  }
})

// ── Trendyol ─────────────────────────────────────────────────────────────────
// Test: GET /sapigw/suppliers/{supplierId}/addresses
// Auth: Basic base64(apiKey:apiSecret)

async function testTrendyol(sellerId: string, apiKey: string, apiSecret: string) {
  if (!sellerId || !apiKey || !apiSecret) {
    return { ok: false, error: 'Supplier ID و API Key و API Secret مطلوبة' }
  }

  const auth = btoa(`${apiKey}:${apiSecret}`)
  const url  = `https://api.trendyol.com/sapigw/suppliers/${sellerId}/addresses`

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      'User-Agent': `${sellerId} - SellpertApp`,
      'Content-Type': 'application/json',
    },
  })

  if (res.status === 200) {
    const data = await res.json()
    const addresses = data.supplierAddresses || []
    return {
      ok: true,
      message: `✅ تم التحقق بنجاح — ${addresses.length} عنوان مسجّل في حسابك`,
      details: { addressCount: addresses.length },
    }
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'بيانات الدخول خاطئة — تحقق من API Key و API Secret' }
  }

  if (res.status === 404) {
    return { ok: false, error: `Supplier ID (${sellerId}) غير موجود — تحقق من الرقم` }
  }

  const body = await res.text()
  return { ok: false, error: `خطأ من تراندايول (${res.status}): ${body.slice(0, 200)}` }
}

// ── Noon ─────────────────────────────────────────────────────────────────────
// Test: GET /seller/v1/packing-info
// Auth: Basic base64(sellerId:apiKey)

async function testNoon(sellerId: string, apiKey: string) {
  if (!sellerId || !apiKey) {
    return { ok: false, error: 'Seller ID و Partner Key مطلوبان' }
  }

  const auth = btoa(`${sellerId}:${apiKey}`)

  // Try the catalog endpoint as a lightweight check
  const res = await fetch('https://api.noon.com/seller/v1/packing-info', {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  })

  if (res.status === 200) {
    return { ok: true, message: '✅ تم التحقق بنجاح — الحساب متصل بنون' }
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'بيانات الدخول خاطئة — تحقق من Seller ID و Partner Key' }
  }

  // Noon sometimes returns 404 for empty accounts — still valid auth
  if (res.status === 404) {
    return { ok: true, message: '✅ تم التحقق بنجاح — الحساب متصل بنون' }
  }

  const body = await res.text()
  return { ok: false, error: `خطأ من نون (${res.status}): ${body.slice(0, 200)}` }
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
