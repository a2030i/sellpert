import { decryptCredentialPayload, encryptCredentialPayload } from './credentialVault.ts'
import { readAmazonSpConfig, type AmazonSpConfig } from './amazonSpApi.ts'
import { HttpError } from './sync.ts'

export const AMAZON_APP_CONFIG_KEY = 'AMAZON_SP_APP_CONFIG'
export const AMAZON_APP_REDIRECT_URI = 'https://app.sellpert.com/integrations/amazon/callback'
type Env = { get(name: string): string | undefined }
class InvalidStoredAmazonConfig extends HttpError {
  constructor() { super(503, 'تعذر قراءة إعدادات تطبيق أمازون المحفوظة') }
}

/** One encrypted record keeps the three app credentials from different saves apart. */
export function validateAmazonAppInput(input: Record<string, unknown>) {
  const result: Record<string, string> = {}
  for (const key of ['appId', 'clientId', 'clientSecret']) {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new HttpError(400, 'أدخل مفاتيح تطبيق أمازون الثلاثة كاملة وبصيغة صحيحة')
    }
    result[key] = value.trim()
  }
  return result as { appId: string; clientId: string; clientSecret: string }
}

export async function loadAmazonAppConfig(admin: any, env: Env): Promise<AmazonSpConfig | null> {
  const { data, error } = await admin.from('app_settings').select('value')
    .eq('key', AMAZON_APP_CONFIG_KEY).maybeSingle()
  if (error) throw new HttpError(503, 'تعذر قراءة إعدادات تطبيق أمازون')
  if (!data) return readAmazonSpConfig(env)
  // A damaged stored record must not silently revert to a different app identity.
  try {
    const stored = validateAmazonAppInput(await decryptCredentialPayload(data.value))
    return { ...stored, redirectUri: AMAZON_APP_REDIRECT_URI, draft: true }
  } catch {
    throw new InvalidStoredAmazonConfig()
  }
}

export function safeAmazonAppStatus(config: AmazonSpConfig | null) {
  return {
    configured: Boolean(config),
    fields: { appId: Boolean(config?.appId), clientId: Boolean(config?.clientId), clientSecret: Boolean(config?.clientSecret) },
    redirectUri: config?.redirectUri || AMAZON_APP_REDIRECT_URI,
    draft: config?.draft ?? true,
  }
}

/** Administrators may repair corrupt stored configuration; merchants still fail closed. */
export async function inspectAmazonAppConfig(admin: any, env: Env) {
  try {
    return { ...safeAmazonAppStatus(await loadAmazonAppConfig(admin, env)), needsReplacement: false }
  } catch (error) {
    if (error instanceof InvalidStoredAmazonConfig) {
      return { ...safeAmazonAppStatus(null), needsReplacement: true }
    }
    throw error
  }
}

export async function saveAmazonAppConfig(admin: any, input: Record<string, unknown>, userId: string) {
  const credentials = validateAmazonAppInput(input)
  const value = await encryptCredentialPayload(credentials)
  const { error } = await admin.from('app_settings').upsert({
    key: AMAZON_APP_CONFIG_KEY,
    value,
    is_secret: true,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }, { onConflict: 'key' })
  if (error) throw new HttpError(503, 'تعذر حفظ إعدادات تطبيق أمازون')
  return { ok: true, ...safeAmazonAppStatus({ ...credentials, redirectUri: AMAZON_APP_REDIRECT_URI, draft: true }) }
}
