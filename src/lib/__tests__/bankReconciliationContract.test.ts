import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260804213202_add_bank_statement_reconciliation.sql', 'utf8')
const policyFix = readFileSync('supabase/migrations/20260804214008_optimize_bank_reconciliation_policies.sql', 'utf8')

describe('bank reconciliation database contract', () => {
  it('keeps bank rows tenant scoped and unavailable to anonymous clients', () => {
    expect(migration).toContain('alter table public.bank_transactions enable row level security')
    expect(migration).toContain('revoke all on table public.bank_transactions from public, anon, authenticated')
    expect(migration).toContain('security.can_access_merchant(merchant_code)')
    expect(migration).toContain("current_has_any_merchant_permission(array['statement']::text[])")
  })

  it('accepts only an archived bank statement through the finance-only commit path', () => {
    expect(migration).toContain("v_upload.file_type <> 'bank_statement' or v_upload.platform <> 'bank'")
    expect(migration).toContain("security.has_merchant_permission(v_upload.merchant_code, 'statement')")
    expect(migration).toContain("split_part(v_upload.storage_path, '/', 2) <> p_upload_id::text")
    expect(migration).toContain("value - 'id' - 'merchant_code' - 'upload_id' - 'net_amount' - 'created_at'")
  })

  it('records the authenticated confirmer and prevents direct bank-row mutation', () => {
    expect(migration).toContain('new.confirmed_by := (select auth.uid())')
    expect(migration).toContain('new.merchant_code := v_merchant_code')
    expect(policyFix).toContain('revoke insert, update, delete on table public.bank_transactions from authenticated')
    expect(policyFix).toContain('create policy settlement_bank_matches_insert')
    expect(policyFix).toContain('create policy settlement_bank_matches_delete')
  })
})
