import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('large atomic file imports', () => {
  const migration = readFileSync(
    'supabase/migrations/20260812202758_chunk_large_atomic_file_imports.sql',
    'utf8',
  )

  it('chunks a large table inside the server-side transaction', () => {
    expect(migration).toContain("create or replace function security.upsert_merchant_import_rows")
    expect(migration).toContain("group by ((source.ordinality - 1) / 5000)")
    expect(migration).toContain("v_affected := v_affected + v_chunk_affected")
    expect(migration).toContain("jsonb_array_length(p_rows) > 100000")
  })

  it('keeps the private helper inaccessible to merchant clients', () => {
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })
})
