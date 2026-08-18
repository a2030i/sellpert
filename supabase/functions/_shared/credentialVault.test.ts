import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { decryptCredentialPayload, encryptCredentialPayload, legacyCredentialMaterial } from './credentialVault.ts'

Deno.test('credential vault encrypts all Omniful credentials without plaintext leakage', async () => {
  const previousServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const previousEncryptionKey = Deno.env.get('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
  try {
    Deno.env.delete('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
    const credentials = {
      client_id: 'omniful-client-id',
      client_secret: 'omniful-client-secret',
      refresh_token: 'omniful-refresh-token',
      access_token: 'omniful-access-token',
    }
    const sealed = await encryptCredentialPayload(credentials)

    assertEquals(sealed.startsWith('enc:v1:'), true)
    for (const value of Object.values(credentials)) assertEquals(sealed.includes(value), false)
    assertEquals(await decryptCredentialPayload(sealed), credentials)
  } finally {
    if (previousServiceKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previousServiceKey)
    if (previousEncryptionKey === undefined) Deno.env.delete('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
    else Deno.env.set('PLATFORM_CREDENTIALS_ENCRYPTION_KEY', previousEncryptionKey)
  }
})

Deno.test('legacy credential material separates secrets from public metadata', () => {
  const material = legacyCredentialMaterial({
    api_key: 'key-value',
    api_secret: 'secret-value',
    extra: {
      endpoint: 'https://example.invalid',
      refresh_token: 'refresh-value',
      service_account: { client_email: 'service@example.invalid', private_key: 'private-value' },
      secret_blob: 'enc:v1:old',
    },
  })

  assertEquals(material, {
    secret: {
      api_key: 'key-value',
      api_secret: 'secret-value',
      refresh_token: 'refresh-value',
      service_account: { client_email: 'service@example.invalid', private_key: 'private-value' },
    },
    publicExtra: { endpoint: 'https://example.invalid' },
  })
})

Deno.test('legacy credential material ignores already sealed records', () => {
  assertEquals(legacyCredentialMaterial({
    api_key: null,
    api_secret: null,
    extra: { endpoint: 'https://example.invalid', secret_blob: 'enc:v1:sealed' },
  }), null)
})
