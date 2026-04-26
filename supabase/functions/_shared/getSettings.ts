/**
 * Shared helper: reads app settings from DB (app_settings table).
 * Falls back to Deno.env if the DB value is empty — so both methods work.
 */
export async function getSettings(admin: any) {
  const KEYS = [
    'SALLA_CLIENT_ID',
    'SALLA_CLIENT_SECRET',
    'SALLA_WEBHOOK_SECRET',
    'APP_URL',
    'salla_app_store_url',
  ]

  const { data } = await admin
    .from('app_settings')
    .select('key, value')
    .in('key', KEYS)

  const db: Record<string, string> = {}
  ;(data || []).forEach((row: any) => { if (row.value) db[row.key] = row.value })

  return {
    clientId:      db['SALLA_CLIENT_ID']      || Deno.env.get('SALLA_CLIENT_ID')      || '',
    clientSecret:  db['SALLA_CLIENT_SECRET']  || Deno.env.get('SALLA_CLIENT_SECRET')  || '',
    webhookSecret: db['SALLA_WEBHOOK_SECRET'] || Deno.env.get('SALLA_WEBHOOK_SECRET') || '',
    appUrl:        db['APP_URL']              || Deno.env.get('APP_URL')              || 'https://sellpert.vercel.app',
    sallaAppStoreUrl: db['salla_app_store_url'] || 'https://salla.sa/apps/sellpert',
  }
}
