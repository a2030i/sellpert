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

  it('secures future objects created by the migration owner', () => {
    const migration = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(migration).toMatch(/alter default privileges\s+revoke execute on functions from public, anon, authenticated/)
    expect(migration).not.toContain('for role supabase_admin')
  })

  it('runs an effective-privilege database regression test', () => {
    const test = readFileSync('supabase/tests/data_api_grants.test.sql', 'utf8')
    expect(test).toContain("has_table_privilege('anon'")
    expect(test).toContain("has_table_privilege('service_role'")
    expect(test).toContain("has_function_privilege('authenticated'")
    expect(test).toContain("has_function_privilege('service_role'")
    expect(test).toContain('rollback;')
  })
})
