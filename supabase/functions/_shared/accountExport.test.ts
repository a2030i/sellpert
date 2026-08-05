import { assertEquals } from 'jsr:@std/assert'
import { ACCOUNT_EXPORT_RESOURCES, findAccountExportResource, parseExportPageSize, redactExportSecrets } from './accountExport.ts'

Deno.test('account export registry has unique public keys and no credential columns', () => {
  assertEquals(new Set(ACCOUNT_EXPORT_RESOURCES.map(item => item.key)).size, ACCOUNT_EXPORT_RESOURCES.length)
  assertEquals(ACCOUNT_EXPORT_RESOURCES.length >= 40, true)
  const credentials = findAccountExportResource('integration_metadata')!
  assertEquals(credentials.columns?.includes('api_key'), false)
  assertEquals(credentials.columns?.includes('api_secret'), false)
  const salla = findAccountExportResource('salla_metadata')!
  assertEquals(salla.columns?.includes('access_token'), false)
  assertEquals(salla.columns?.includes('refresh_token'), false)
  const legal = findAccountExportResource('legal_acceptances')!
  assertEquals(legal.columns, 'id,merchant_code,user_id,terms_version,privacy_version,accepted_at,source')
})

Deno.test('export pagination is bounded and unknown resources are rejected', () => {
  assertEquals(parseExportPageSize('bad'), 500)
  assertEquals(parseExportPageSize(5000), 1000)
  assertEquals(findAccountExportResource('platform_credentials'), null)
})

Deno.test('nested secrets are redacted without removing merchant data', () => {
  assertEquals(redactExportSecrets({ order: 42, request: { apiKey: 'hidden', customer: 'Ahmed' }, token_expires_at: 'also-hidden' }), {
    order: 42,
    request: { apiKey: '[REDACTED]', customer: 'Ahmed' },
    token_expires_at: '[REDACTED]',
  })
})
