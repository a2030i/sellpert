import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasAcceptedCurrentLegalDocuments, LEGAL_DOCUMENT_VERSION } from '../legal'

describe('merchant legal consent', () => {
  it('uses a stable date version for both public documents', () => {
    expect(LEGAL_DOCUMENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('requires an explicit positive choice', () => {
    expect(hasAcceptedCurrentLegalDocuments(false)).toBe(false)
    expect(hasAcceptedCurrentLegalDocuments(true)).toBe(true)
  })

  it('persists a tenant-scoped immutable acceptance without client write access', () => {
    const migration = readFileSync(
      'supabase/migrations/20260805003857_record_merchant_legal_acceptance.sql',
      'utf8',
    ).toLowerCase()
    expect(migration).toContain('alter table public.merchant_legal_acceptances force row level security')
    expect(migration).toContain('create policy tenant_boundary')
    expect(migration).toContain('as restrictive')
    expect(migration).toContain('security.can_access_merchant(merchant_code)')
    expect(migration).toContain('create policy sellpert_require_mfa_if_enrolled')
    expect(migration).toContain('security.mfa_access_allowed()')
    expect(migration).toContain('revoke all on table public.merchant_legal_acceptances from public, anon, authenticated')
    expect(migration).toContain('revoke all on table public.merchant_legal_acceptances from service_role')
    expect(migration).toContain('grant select, insert on table public.merchant_legal_acceptances to service_role')
    expect(migration).not.toContain('grant select, insert, update')
  })

  it('sends the exact document version with both signup attestations', () => {
    const login = readFileSync('src/pages/Login.tsx', 'utf8')
    expect(login).toContain('terms_accepted: true')
    expect(login).toContain('privacy_accepted: true')
    expect(login).toContain('legal_version: LEGAL_DOCUMENT_VERSION')
  })
})
