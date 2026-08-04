import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

describe('Salla OAuth token at-rest boundary', () => {
  it('migrates legacy plaintext, revokes browser RPC access and rejects future plaintext', () => {
    const migration = source('supabase/migrations/20260804183053_seal_salla_oauth_tokens.sql')
    expect(migration).toContain('vault.create_secret')
    expect(migration).toContain('vault.update_secret')
    expect(migration).toContain('access_token = null')
    expect(migration).toContain('refresh_token = null')
    expect(migration).toContain('salla_connections_no_plaintext_tokens')
    expect(migration).toContain("coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'")
    expect(migration).toContain('security definer')
    expect(migration).toContain('security invoker')
    expect(migration).toContain('from public, anon, authenticated')
  })

  it('routes OAuth installation and refresh through the Vault helper', () => {
    const callback = source('supabase/functions/salla-oauth-callback/index.ts')
    const sync = source('supabase/functions/salla-sync/index.ts')
    expect(callback).toContain('storeSallaTokens')
    expect(callback).toContain('access_token: null, refresh_token: null')
    expect(sync).toContain('resolveSallaTokens')
    expect(sync).toContain('storeSallaTokens')
    expect(sync).not.toContain('let accessToken = conn.access_token')
  })

  it('keeps every browser Salla query free of token columns', () => {
    for (const path of ['src/pages/Integrations.tsx', 'src/pages/admin/SallaView.tsx']) {
      const page = source(path)
      expect(page).not.toContain('access_token')
      expect(page).not.toContain('refresh_token')
      expect(page).not.toContain('access_token_secret_id')
      expect(page).not.toContain('refresh_token_secret_id')
    }
  })
})
