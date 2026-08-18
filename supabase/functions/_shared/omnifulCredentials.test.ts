import { assertEquals } from 'jsr:@std/assert@1.0.14'
import {
  accessTokenExpiresSoon,
  buildOmnifulCredentials,
  credentialsAreComplete,
  mergeOmnifulTokenResponse,
  tokenExpiryIso,
} from './omnifulCredentials.ts'

function jwtWithExpiry(expiresAtSeconds: number) {
  const payload = btoa(JSON.stringify({ exp: expiresAtSeconds }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${payload}.signature-value-long-enough`
}

Deno.test('builds complete Omniful credentials and extracts JWT expiry', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const credentials = buildOmnifulCredentials({
    client_id: 'client-1234',
    client_secret: 'client-secret-value',
    refresh_token: 'refresh-token-value-long-enough',
    access_token: `Bearer ${jwtWithExpiry(expiresAt)}`,
  })

  assertEquals(credentialsAreComplete(credentials), true)
  assertEquals(credentials.access_token.startsWith('Bearer '), false)
  assertEquals(credentials.access_token_expires_at, new Date(expiresAt * 1000).toISOString())
  assertEquals(accessTokenExpiresSoon(credentials), false)
})

Deno.test('merges rotated access and refresh tokens with expires_in values', () => {
  const current = buildOmnifulCredentials({
    client_id: 'client-1234',
    client_secret: 'client-secret-value',
    refresh_token: 'old-refresh-token-value-long',
    access_token: 'old-access-token-value-long',
  })
  const refreshed = mergeOmnifulTokenResponse(current, {
    data: {
      access_token: 'new-access-token-value-long',
      refresh_token: 'new-refresh-token-value-long',
      expires_in: 3600,
      refresh_expires_in: 7200,
    },
  }, Date.parse('2026-08-18T12:00:00Z'))

  assertEquals(refreshed?.access_token, 'new-access-token-value-long')
  assertEquals(refreshed?.refresh_token, 'new-refresh-token-value-long')
  assertEquals(refreshed?.access_token_expires_at, '2026-08-18T13:00:00.000Z')
  assertEquals(refreshed?.refresh_token_expires_at, '2026-08-18T14:00:00.000Z')
})

Deno.test('returns null when a refresh response has no new access token', () => {
  const current = buildOmnifulCredentials({})
  assertEquals(mergeOmnifulTokenResponse(current, { data: { refresh_token: 'only-refresh' } }), null)
  assertEquals(tokenExpiryIso('opaque-token'), null)
})
