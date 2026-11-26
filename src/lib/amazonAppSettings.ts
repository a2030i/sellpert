import { supabase } from './supabase'

export const AMAZON_APP_REDIRECT_URI = 'https://app.sellpert.com/integrations/amazon/callback'

export type AmazonAppCredentials = { appId: string; clientId: string; clientSecret: string }
export type AmazonAppSettingsStatus = {
  configured: boolean
  fields: Record<keyof AmazonAppCredentials, boolean>
  redirectUri: typeof AMAZON_APP_REDIRECT_URI
  draft: true
  needsReplacement?: boolean
}

export class AmazonAppSettingsError extends Error {
  constructor(message: string, public readonly status?: number) { super(message) }
}

const STATUS_ERROR = 'تعذر التحقق من إعدادات أمازون. أعد المحاولة.'

function safeStatus(payload: unknown): AmazonAppSettingsStatus {
  if (!payload || typeof payload !== 'object') throw new AmazonAppSettingsError(STATUS_ERROR)
  const value = payload as Record<string, unknown>
  const fields = value.fields as Record<string, unknown> | undefined
  if (typeof value.configured !== 'boolean' || !fields
    || typeof fields.appId !== 'boolean' || typeof fields.clientId !== 'boolean' || typeof fields.clientSecret !== 'boolean'
    || value.redirectUri !== AMAZON_APP_REDIRECT_URI || value.draft !== true
    || (value.needsReplacement !== undefined && typeof value.needsReplacement !== 'boolean')) {
    throw new AmazonAppSettingsError(STATUS_ERROR)
  }
  // Return only presence flags. Never propagate extra response properties.
  return {
    configured: value.configured && fields.appId && fields.clientId && fields.clientSecret,
    fields: { appId: fields.appId, clientId: fields.clientId, clientSecret: fields.clientSecret },
    redirectUri: AMAZON_APP_REDIRECT_URI,
    draft: true,
    ...(value.needsReplacement === true ? { needsReplacement: true } : {}),
  }
}

async function request(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new AmazonAppSettingsError('انتهت الجلسة، سجل الدخول مجددًا.', 401)
  let response: Response
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-integration-settings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AmazonAppSettingsError('تعذر الاتصال بالخادم. تحقق من الاتصال وأعد المحاولة.')
  }
  // Do not echo server bodies: an unexpected error must not expose submitted values.
  if (!response.ok) {
    const message = response.status === 403 ? 'هذه الصفحة متاحة لمديري المنصة فقط.'
      : response.status === 401 ? 'انتهت الجلسة، سجل الدخول مجددًا.'
      : response.status === 400 ? 'تعذر حفظ الإعدادات. تحقق من القيم الثلاث وأعد المحاولة.'
      : 'تعذر تنفيذ العملية. أعد المحاولة.'
    throw new AmazonAppSettingsError(message, response.status)
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object') throw new AmazonAppSettingsError(STATUS_ERROR)
  return payload as Record<string, unknown>
}

export async function loadAmazonAppSettings(): Promise<AmazonAppSettingsStatus> {
  return safeStatus(await request({ action: 'amazon_status' }))
}

export async function saveAmazonAppSettings(values: AmazonAppCredentials): Promise<AmazonAppSettingsStatus> {
  const appId = values.appId.trim()
  const clientId = values.clientId.trim()
  const clientSecret = values.clientSecret.trim()
  if (!appId || !clientId || !clientSecret) throw new AmazonAppSettingsError('أدخل القيم الثلاث لحفظ إعدادات التطبيق.', 400)
  const payload = await request({ action: 'save_amazon_config', appId, clientId, clientSecret })
  const status = safeStatus(payload)
  if (payload.ok !== true || !status.configured) throw new AmazonAppSettingsError(STATUS_ERROR)
  return status
}
