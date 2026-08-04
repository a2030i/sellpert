import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19'
import { resolveSallaTokens, storeSallaTokens } from './sallaTokenVault.ts'

Deno.test('Salla token resolver prefers Vault and never needs plaintext columns', async () => {
  const admin = { rpc: () => Promise.resolve({ data: [{ access_token: 'vault-access', refresh_token: 'vault-refresh' }], error: null }) }
  assertEquals(await resolveSallaTokens(admin, { id: 'connection-1', access_token: 'legacy-access' }), {
    accessToken: 'vault-access', refreshToken: 'vault-refresh', source: 'vault',
  })
})

Deno.test('Salla token resolver preserves compatibility before the migration', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }) }
  assertEquals(await resolveSallaTokens(admin, { id: 'connection-1', access_token: 'legacy-access', refresh_token: 'legacy-refresh' }), {
    accessToken: 'legacy-access', refreshToken: 'legacy-refresh', source: 'legacy',
  })
})

Deno.test('Salla token resolver fails closed when neither Vault nor legacy storage has a token', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }) }
  await assertRejects(() => resolveSallaTokens(admin, { id: 'connection-1' }), Error, 'Unable to resolve encrypted Salla credentials')
})

Deno.test('Salla token writer sends secrets only to the server-side Vault RPC', async () => {
  let call: any = null
  const admin = { rpc: (name: string, args: any) => { call = { name, args }; return Promise.resolve({ error: null }) } }
  assertEquals(await storeSallaTokens(admin, 'connection-1', 'access', 'refresh', '2026-08-04T19:00:00.000Z'), true)
  assertEquals(call, {
    name: 'store_salla_connection_tokens',
    args: {
      p_connection_id: 'connection-1', p_access_token: 'access', p_refresh_token: 'refresh', p_expires_at: '2026-08-04T19:00:00.000Z',
    },
  })
})

Deno.test('Salla token writer signals pre-migration compatibility without swallowing other failures', async () => {
  const beforeMigration = { rpc: () => Promise.resolve({ error: { code: 'PGRST202' } }) }
  assertEquals(await storeSallaTokens(beforeMigration, 'connection-1', 'access', null, '2026-08-04T19:00:00.000Z'), false)
  const brokenVault = { rpc: () => Promise.resolve({ error: { code: 'XX000' } }) }
  await assertRejects(() => storeSallaTokens(brokenVault, 'connection-1', 'access', null, '2026-08-04T19:00:00.000Z'), Error, 'Unable to store encrypted Salla credentials')
})
