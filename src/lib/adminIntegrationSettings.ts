import { supabase } from './supabase'

export type SafeConnection = {
  id: string
  platform: 'openrouter' | 'respondly'
  label: string
  configured: boolean
  is_active: boolean
  extra: Record<string, any>
}

export type AdminIntegrationStatus = {
  connections: Partial<Record<'openrouter' | 'respondly', SafeConnection>>
  settings: Record<string, { value: string; configured: boolean; is_secret: boolean }>
}

export async function adminIntegrationRequest<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('انتهت الجلسة، سجل الدخول مجددًا')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-integration-settings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `تعذر تنفيذ العملية (${response.status})`)
  return payload as T
}

export function loadAdminIntegrationStatus() {
  return adminIntegrationRequest<AdminIntegrationStatus>({ action: 'status' })
}
