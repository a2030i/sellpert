import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

describe('administration integration secret boundary', () => {
  it.each([
    'src/pages/admin/AiView.tsx',
    'src/pages/admin/ConnectionsView.tsx',
    'src/pages/admin/WhatsAppManagerView.tsx',
  ])('%s never queries the secret backing table', path => {
    expect(source(path)).not.toContain("from('platform_connections')")
  })

  it.each([
    'src/pages/admin/SallaView.tsx',
    'src/pages/admin/DBHealthView.tsx',
  ])('%s never queries application settings directly', path => {
    expect(source(path)).not.toContain("from('app_settings')")
  })

  it('never selects Salla OAuth tokens in browser pages', () => {
    for (const path of ['src/pages/admin/SallaView.tsx', 'src/pages/Integrations.tsx']) {
      const browserSource = source(path)
      expect(browserSource).not.toContain('access_token')
      expect(browserSource).not.toContain('refresh_token')
      expect(browserSource).not.toMatch(/salla_connections['"]\)\.select\(['"]\*/)
    }
  })

  it('returns status metadata but never secret values from the protected function', () => {
    const handler = source('supabase/functions/admin-integration-settings/index.ts')
    expect(handler).toContain("value: secret ? ''")
    expect(handler).toContain('configured: Boolean')
    expect(handler).toContain('encryptCredentialPayload')
    expect(handler).toContain('api_key: null')
    expect(handler).toContain("const manager = ['admin', 'super_admin'].includes(caller.role)")
    expect(handler).toContain("action === 'save_connection' && manager")
  })

  it('seals legacy connection secrets and all sync readers resolve encrypted payloads', () => {
    const worker = source('supabase/functions/queue-worker/index.ts')
    expect(worker).toContain('sealLegacyCredentials')
    expect(worker).toContain('legacyCredentialMaterial')
    expect(worker).toContain('api_key: null')
    expect(worker).toContain('api_secret: null')

    for (const path of [
      'supabase/functions/sync-trendyol/index.ts',
      'supabase/functions/sync-amazon/index.ts',
    ]) {
      const syncHandler = source(path)
      expect(syncHandler).toContain('resolveSecretPayload')
      expect(syncHandler).not.toContain('apiKey: connection.api_key')
      expect(syncHandler).not.toContain('apiSecret: connection.api_secret')
    }
  })

  it('revokes browser access to global secret stores and grants only safe Salla columns', () => {
    const migration = source('supabase/migrations/20260804120000_seal_admin_integration_settings.sql')
    expect(migration).toContain('REVOKE ALL ON TABLE public.platform_connections FROM anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE public.salla_connections FROM anon, authenticated')
    const grant = migration.split('GRANT SELECT (')[1]?.split(') ON TABLE public.salla_connections')[0] || ''
    expect(grant).not.toContain('access_token')
    expect(grant).not.toContain('refresh_token')
  })
})
