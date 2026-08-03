import { supabase } from './supabase'

export async function callMfaRecovery<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('انتهت جلسة الدخول. سجّل الدخول من جديد.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mfa-recovery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || 'تعذر إكمال إجراء الأمان.')
  return payload as T
}
