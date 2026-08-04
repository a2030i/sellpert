import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'
import { PayloadTooLargeError, readBoundedText } from '../_shared/webhookSecurity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_REQUEST_BYTES = 32_000
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SALLA_FIELDS: Record<string, boolean> = {
  SALLA_CLIENT_ID: false,
  SALLA_CLIENT_SECRET: true,
  SALLA_WEBHOOK_SECRET: true,
  APP_URL: false,
  salla_app_store_url: false,
  supabase_plan: false,
}
const EVENT_KEYS = new Set(['sync_complete', 'low_stock', 'new_order', 'ai_ready', 'daily_report', 'weekly_digest', 'import_complete', 'restock_alert', 'high_returns', 'low_roas', 'shipment_loss', 'task_assigned', 'task_resolved', 'custom'])

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) return reply({ error: 'Unauthorized' }, 401)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return reply({ error: 'Unauthorized' }, 401)
    const { data: caller } = await admin.from('merchants').select('role,is_active,permissions').eq('id', user.id).maybeSingle()
    if (!caller || caller.is_active === false) return reply({ error: 'Forbidden' }, 403)

    const raw = await readBoundedText(req, MAX_REQUEST_BYTES)
    const body = raw ? JSON.parse(raw) : {}
    const action = String(body?.action || 'status')
    const manager = ['admin', 'super_admin'].includes(caller.role)
    const staffPermissions = Array.isArray(caller.permissions) ? caller.permissions : []
    const mayUseRespondly = manager || (caller.role === 'staff' && (staffPermissions.includes('whatsapp_send') || staffPermissions.includes('whatsapp_bulk')))
    const mayViewStatus = manager || mayUseRespondly || (caller.role === 'staff' && (staffPermissions.includes('view_merchants') || staffPermissions.includes('view_db_health')))
    if (action === 'status' && mayViewStatus) return reply(await status(admin))
    if (action === 'save_connection' && manager) return reply(await saveConnection(admin, body))
    if (action === 'update_respondly_config' && mayUseRespondly) return reply(await updateRespondlyConfig(admin, body))
    if (action === 'save_setting' && (manager || (body?.key === 'supabase_plan' && staffPermissions.includes('view_db_health')))) return reply(await saveSetting(admin, body, user.id))
    if (['status', 'save_connection', 'update_respondly_config', 'save_setting'].includes(action)) return reply({ error: 'لا تملك صلاحية تنفيذ هذه العملية' }, 403)
    return reply({ error: 'Unsupported action' }, 400)
  } catch (error: any) {
    if (error instanceof PayloadTooLargeError) return reply({ error: 'الطلب أكبر من الحد المسموح' }, 413)
    if (error instanceof SyntaxError) return reply({ error: 'بيانات الطلب غير صالحة' }, 400)
    console.error('admin-integration-settings:', error?.message)
    return reply({ error: 'تعذر حفظ إعدادات الربط' }, 500)
  }
})

async function status(admin: any) {
  const [{ data: connections, error: connectionError }, { data: settings, error: settingsError }] = await Promise.all([
    admin.from('platform_connections').select('id,platform,label,api_key,api_secret,is_active,extra').in('platform', ['openrouter', 'respondly']),
    admin.from('app_settings').select('key,value,is_secret').in('key', Object.keys(SALLA_FIELDS)),
  ])
  if (connectionError || settingsError) throw connectionError || settingsError
  const safeConnections: Record<string, any> = {}
  for (const row of connections || []) {
    const publicExtra = row.platform === 'respondly' ? sanitizeRespondlyExtra(row.extra) : {}
    safeConnections[row.platform] = {
      id: row.id, platform: row.platform, label: row.label || row.platform,
      configured: Boolean(row.extra?.secret_blob || row.api_key || row.api_secret),
      is_active: row.is_active !== false, extra: publicExtra,
    }
  }
  const safeSettings: Record<string, any> = {}
  for (const key of Object.keys(SALLA_FIELDS)) {
    const row = (settings || []).find((item: any) => item.key === key)
    const secret = SALLA_FIELDS[key]
    safeSettings[key] = { value: secret ? '' : String(row?.value || ''), configured: Boolean(row?.value), is_secret: secret }
  }
  return { connections: safeConnections, settings: safeSettings }
}

async function saveConnection(admin: any, body: any) {
  const platform = String(body?.platform || '')
  if (!['openrouter', 'respondly'].includes(platform)) throw new Error('Invalid platform')
  const apiKey = bounded(body?.api_key, 8, 8192)
  const label = bounded(body?.label || (platform === 'openrouter' ? 'OpenRouter AI' : 'Respondly'), 1, 100)
  const { data: existing, error: lookupError } = await admin.from('platform_connections').select('id,extra').eq('platform', platform).limit(1).maybeSingle()
  if (lookupError) throw lookupError
  const oldExtra = existing?.extra && typeof existing.extra === 'object' ? existing.extra : {}
  const extra = platform === 'respondly'
    ? { ...sanitizeRespondlyExtra(oldExtra), ...sanitizeRespondlyExtra(body?.extra), secret_blob: await encryptCredentialPayload({ api_key: apiKey }) }
    : { secret_blob: await encryptCredentialPayload({ api_key: apiKey }) }
  const values = { platform, label, api_key: null, api_secret: null, extra, is_active: true, updated_at: new Date().toISOString() }
  const query = existing
    ? admin.from('platform_connections').update(values).eq('id', existing.id)
    : admin.from('platform_connections').insert(values)
  const { data, error } = await query.select('id,platform,label,is_active').single()
  if (error) throw error
  return { ok: true, connection: { ...data, configured: true, extra: sanitizeRespondlyExtra(extra) } }
}

async function updateRespondlyConfig(admin: any, body: any) {
  const { data: existing, error } = await admin.from('platform_connections').select('id,extra').eq('platform', 'respondly').limit(1).maybeSingle()
  if (error) throw error
  if (!existing) throw new Error('Respondly connection not found')
  const extra = { ...(existing.extra || {}), ...sanitizeRespondlyExtra(body?.extra) }
  const { error: updateError } = await admin.from('platform_connections').update({ extra, updated_at: new Date().toISOString() }).eq('id', existing.id)
  if (updateError) throw updateError
  return { ok: true, extra: sanitizeRespondlyExtra(extra) }
}

async function saveSetting(admin: any, body: any, userId: string) {
  const key = String(body?.key || '')
  if (!(key in SALLA_FIELDS)) throw new Error('Invalid setting')
  const value = bounded(body?.value, 1, SALLA_FIELDS[key] ? 8192 : 2048)
  const { error } = await admin.from('app_settings').upsert({
    key, value, is_secret: SALLA_FIELDS[key], updated_at: new Date().toISOString(), updated_by: userId,
  })
  if (error) throw error
  return { ok: true, setting: { key, value: SALLA_FIELDS[key] ? '' : value, configured: true, is_secret: SALLA_FIELDS[key] } }
}

function sanitizeRespondlyExtra(value: any) {
  const safe: Record<string, any> = {}
  if (!value || typeof value !== 'object') return safe
  const baseUrl = String(value.base_url || '').trim()
  if (baseUrl && /^https:\/\//i.test(baseUrl) && baseUrl.length <= 500) safe.base_url = baseUrl.replace(/\/$/, '')
  const channelId = String(value.channel_id || '').trim()
  if (channelId && channelId.length <= 200) safe.channel_id = channelId
  if (value.events && typeof value.events === 'object') {
    safe.events = Object.fromEntries(Object.entries(value.events).filter(([key]) => EVENT_KEYS.has(key)).map(([key, cfg]: [string, any]) => [key, {
      enabled: cfg?.enabled !== false,
      template: typeof cfg?.template === 'string' && cfg.template.length <= 200 ? cfg.template : null,
    }]))
  }
  return safe
}

function bounded(value: unknown, min: number, max: number) {
  const result = String(value || '').trim()
  if (result.length < min || result.length > max) throw new Error('Invalid value')
  return result
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
