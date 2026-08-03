import { supabase } from './supabase'
import type { PlatformCredential } from './supabase'

export async function listPlatformCredentials(merchantCode?: string | null): Promise<PlatformCredential[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Unauthorized')

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-platform-credentials`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'list', ...(merchantCode ? { merchant_code: merchantCode } : {}) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return Array.isArray(payload?.credentials) ? payload.credentials : []
}
