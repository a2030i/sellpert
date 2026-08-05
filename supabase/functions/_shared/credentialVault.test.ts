import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { legacyCredentialMaterial } from './credentialVault.ts'

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
