import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

it('sends one account contract header through the actual Supabase SDK', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public-key')
  const fetcher = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetcher)
  const { supabase } = await import('../supabase')
  try {
    const result = await supabase.from('merchants').select('id').limit(0)
    expect(result.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [, init] = fetcher.mock.calls[0] as unknown as [RequestInfo, RequestInit]
    expect(new Headers(init.headers).get('x-client-info')).toBe('sellpert-accounts-v1')
  } finally {
    supabase.auth.stopAutoRefresh()
  }
})
