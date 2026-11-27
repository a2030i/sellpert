export const AMAZON_CALLBACK_PATH = '/integrations/amazon/callback'

export type AmazonCallbackParams = {
  state: string
  selling_partner_id: string
  spapi_oauth_code: string
}

export type AmazonConnection = {
  marketplace_account_id: string
  seller_id: string
  is_active: boolean
  test_status: string | null
  last_tested_at: string | null
  last_sync_at: string | null
  connected_at: string | null
  marketplaces: { id: string; country: string; name: string }[]
}

export type AmazonConnectionStatus = { app_configured: boolean; connections?: AmazonConnection[]; connection: AmazonConnection | null }

/**
 * Reads Amazon's redirect parameters. Returns null outside the callback path,
 * 'incomplete' when Amazon returned without the three required parameters.
 */
export function readAmazonCallback(pathname: string, search: string): AmazonCallbackParams | 'incomplete' | null {
  if (pathname.replace(/\/+$/, '') !== AMAZON_CALLBACK_PATH) return null
  const params = new URLSearchParams(search)
  const state = params.get('state') || ''
  const sellingPartnerId = params.get('selling_partner_id') || ''
  const code = params.get('spapi_oauth_code') || ''
  if (!state || !sellingPartnerId || !code) return 'incomplete'
  return { state, selling_partner_id: sellingPartnerId, spapi_oauth_code: code }
}

const PENDING_CONNECT_KEY = 'sellpert.amazonConnectTarget'
const PENDING_CONNECT_TTL_MS = 15 * 60_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function sessionStore(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

/**
 * Remembers which merchant workspace started the Amazon consent flow.
 * Amazon returns with a full page load, which drops in-memory state such as
 * an administrator viewing a merchant account. Only the merchant code and a
 * timestamp are stored; the OAuth state itself stays server-side.
 */
export function rememberAmazonConnectTarget(merchantCode: string, storage = sessionStore(), now = Date.now()) {
  try { storage?.setItem(PENDING_CONNECT_KEY, JSON.stringify({ merchant_code: merchantCode, at: now })) } catch { /* best effort */ }
}

export function readAmazonConnectTarget(storage = sessionStore(), now = Date.now()): string | null {
  try {
    const value = JSON.parse(storage?.getItem(PENDING_CONNECT_KEY) || 'null')
    if (!value || typeof value.merchant_code !== 'string' || !value.merchant_code) return null
    if (typeof value.at !== 'number' || now - value.at > PENDING_CONNECT_TTL_MS || now < value.at) return null
    return value.merchant_code
  } catch {
    return null
  }
}

export function clearAmazonConnectTarget(storage = sessionStore()) {
  try { storage?.removeItem(PENDING_CONNECT_KEY) } catch { /* best effort */ }
}

export const AMAZON_MARKETPLACE_NAMES: Record<string, string> = {
  SA: 'السعودية',
  AE: 'الإمارات',
  EG: 'مصر',
}

export async function callAmazonConnect(body: Record<string, unknown>) {
  // Imported lazily so the pure callback helpers stay testable without env.
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/amazon-connect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.access_token || ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === 'string' && data.error ? data.error : `HTTP ${response.status}`)
  return data
}
