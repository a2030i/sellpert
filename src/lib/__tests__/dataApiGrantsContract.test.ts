import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260805020314_explicit_data_api_grants.sql'

describe('Data API grant contract', () => {
  it('makes service access explicit and removes anonymous table access', () => {
    const migration = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(migration).toContain('grant all privileges on all tables in schema public, security to service_role')
    expect(migration).toContain('revoke all privileges on all tables in schema public from anon')
    expect(migration).toContain('revoke all privileges on all sequences in schema public, security from anon')
  })

  it('secures future objects created by postgres and supabase_admin', () => {
    const migration = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(migration).toContain('alter default privileges for role supabase_admin in schema public')
    expect(migration).toContain('alter default privileges for role supabase_admin in schema security')
    expect(migration).toMatch(/alter default privileges\s+revoke execute on functions from public, anon, authenticated/)
    expect(migration).toMatch(/alter default privileges for role supabase_admin\s+revoke execute on functions from public, anon, authenticated/)
  })

  it('runs an effective-privilege database regression test for both owners', () => {
    const test = readFileSync('supabase/tests/data_api_grants.test.sql', 'utf8')
    expect(test).toContain('set local role supabase_admin')
    expect(test).toContain("has_table_privilege('anon'")
    expect(test).toContain("has_table_privilege('service_role'")
    expect(test).toContain("has_function_privilege('authenticated'")
    expect(test).toContain("has_function_privilege('service_role'")
    expect(test).toContain('rollback;')
  })
})
