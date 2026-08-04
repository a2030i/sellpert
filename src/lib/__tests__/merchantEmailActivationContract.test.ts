import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('self-service merchant email verification contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20260804221824_verify_merchant_email_before_activation.sql',
    'utf8',
  ).toLowerCase()

  it('provisions unverified workspaces as inactive', () => {
    expect(migration).toContain('new.email_confirmed_at is not null')
    expect(migration).toContain('security.handle_self_service_merchant_signup()')
  })

  it('activates only the matching self-service workspace after confirmation', () => {
    expect(migration).toContain('after update of email_confirmed_at on auth.users')
    expect(migration).toContain("and signup_source = 'self_service'")
    expect(migration).toContain('where id = new.id')
    expect(migration).toContain('old.email_confirmed_at is null and new.email_confirmed_at is not null')
  })

  it('keeps both Auth trigger implementations private', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('revoke all on function security.activate_verified_self_service_merchant()')
    expect(migration).toContain('from public, anon, authenticated')
  })
})
