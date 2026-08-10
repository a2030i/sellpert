import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
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
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) return reply({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return reply({ error: 'Unauthorized' }, 401)

    const { data: caller } = await admin
      .from('merchants')
      .select('role,is_active')
      .eq('id', user.id)
      .maybeSingle()
    if (!caller || caller.is_active === false || !['admin', 'super_admin'].includes(caller.role)) {
      return reply({ error: 'Forbidden' }, 403)
    }

    const raw = await readBoundedText(req, MAX_REQUEST_BYTES)
    const body = raw ? JSON.parse(raw) : {}
    const action = String(body?.action || 'status')
    if (action === 'status') return reply(await status(admin))
    if (action === 'save_setting') return reply(await saveSetting(admin, body, user.id))
    return reply({ error: 'Unsupported action' }, 400)
  } catch (error: any) {
    if (error instanceof PayloadTooLargeError) return reply({ error: 'الطلب أكبر من الحد المسموح' }, 413)
    if (error instanceof SyntaxError) return reply({ error: 'بيانات الطلب غير صالحة' }, 400)
    console.error('admin-integration-settings:', error?.message)
    return reply({ error: 'تعذر حفظ إعدادات سلة' }, 500)
  }
})

async function status(admin: any) {
  const { data: settings, error } = await admin
    .from('app_settings')
    .select('key,value,is_secret')
    .in('key', Object.keys(SALLA_FIELDS))
  if (error) throw error

  const safeSettings: Record<string, unknown> = {}
  for (const key of Object.keys(SALLA_FIELDS)) {
    const row = (settings || []).find((item: any) => item.key === key)
    const secret = SALLA_FIELDS[key]
    safeSettings[key] = {
      value: secret ? '' : String(row?.value || ''),
      configured: Boolean(row?.value),
      is_secret: secret,
    }
  }
  return { settings: safeSettings }
}

async function saveSetting(admin: any, body: any, userId: string) {
  const key = String(body?.key || '')
  if (!(key in SALLA_FIELDS)) throw new Error('Invalid setting')
  const value = bounded(body?.value, 1, SALLA_FIELDS[key] ? 8192 : 2048)
  const { error } = await admin.from('app_settings').upsert({
    key,
    value,
    is_secret: SALLA_FIELDS[key],
    updated_at: new Date().toISOString(),
    updated_by: userId,
  })
  if (error) throw error
  return { ok: true, setting: { key, value: SALLA_FIELDS[key] ? '' : value, configured: true, is_secret: SALLA_FIELDS[key] } }
}

function bounded(value: unknown, min: number, max: number) {
  const result = String(value || '').trim()
  if (result.length < min || result.length > max) throw new Error('Invalid value')
  return result
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
