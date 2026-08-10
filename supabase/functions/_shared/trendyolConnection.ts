import { HttpError } from './sync.ts'

const TRENDYOL_API = 'https://apigw.trendyol.com'

export function trendyolHeaders(sellerId: string, apiKey: string, apiSecret: string) {
  return {
    Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
    'User-Agent': `${sellerId} - Sellpert`,
    storeFrontCode: 'SA',
    Accept: 'application/json',
  }
}

export async function verifyTrendyolCredentials(sellerId: string, apiKey: string, apiSecret: string) {
  const cleanSellerId = String(sellerId || '').trim()
  const cleanApiKey = String(apiKey || '').trim()
  const cleanApiSecret = String(apiSecret || '').trim()
  if (!cleanSellerId || !cleanApiKey || !cleanApiSecret) {
    throw new HttpError(400, 'معرّف البائع ومفتاح API وسر API مطلوبة')
  }

  const response = await fetch(
    `${TRENDYOL_API}/integration/order/sellers/${encodeURIComponent(cleanSellerId)}/orders?page=0&size=1`,
    { headers: trendyolHeaders(cleanSellerId, cleanApiKey, cleanApiSecret) },
  )
  if (response.ok) return { sellerId: cleanSellerId, apiKey: cleanApiKey, apiSecret: cleanApiSecret }

  const detail = await providerError(response)
  if (response.status === 401) throw new HttpError(401, `رفض Trendyol بيانات الربط. تحقق من Seller ID وAPI Key وAPI Secret${detail}`)
  if (response.status === 403) throw new HttpError(403, `رفض Trendyol صلاحية التكامل أو User-Agent${detail}`)
  if (response.status === 404) throw new HttpError(404, `خدمة الطلبات غير مفعلة لهذا الحساب في بيئة الإنتاج${detail}`)
  throw new HttpError(response.status, `تعذر التحقق من Trendyol (${response.status})${detail}`)
}

export async function ensureTrendyolWebhook(
  sellerId: string,
  apiKey: string,
  apiSecret: string,
  webhookSecret: string,
  webhookUrl: string,
) {
  if (!webhookSecret) throw new Error('TRENDYOL_WEBHOOK_SECRET غير مضبوط')
  const headers = { ...trendyolHeaders(sellerId, apiKey, apiSecret), 'Content-Type': 'application/json' }
  const endpoint = `${TRENDYOL_API}/integration/webhook/sellers/${encodeURIComponent(sellerId)}/webhooks`
  const listResponse = await fetch(endpoint, { headers })
  if (!listResponse.ok) throw new Error(`تعذر قراءة Webhooks من Trendyol (${listResponse.status})`)
  const existing = await listResponse.json().catch(() => [])
  const rows = Array.isArray(existing) ? existing : (existing?.content || [])
  const match = rows.find((row: any) => String(row?.url || '').replace(/\/$/, '') === webhookUrl.replace(/\/$/, ''))
  if (match?.status === 'ACTIVE') return { created: false, id: match.id, status: match.status }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: webhookUrl,
      authenticationType: 'API_KEY',
      apiKey: webhookSecret,
      subscribedStatuses: [],
    }),
  })
  if (!response.ok) throw new Error(`تعذر إنشاء Webhook في Trendyol (${response.status})`)
  const data = await response.json().catch(() => ({}))
  return { created: true, id: data?.id || null, status: data?.status || 'PENDING' }
}

async function providerError(response: Response) {
  const body = await response.text()
  if (!body) return ''
  try {
    const data = JSON.parse(body)
    const value = data?.message || data?.exception || data?.error?.detail || data?.error?.title
    return value ? ` — ${String(value).slice(0, 200)}` : ''
  } catch {
    return ` — ${body.replace(/\s+/g, ' ').slice(0, 200)}`
  }
}
