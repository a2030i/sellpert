-- Keep the shared structural guardrail effective for every merchant-owned
-- table. These policies already enforce the correct predicate; normalize only
-- their names so future audits can prove coverage uniformly.
alter policy bank_transactions_tenant_boundary
  on public.bank_transactions rename to tenant_boundary;

alter policy settlement_bank_matches_tenant_boundary
  on public.settlement_bank_matches rename to tenant_boundary;
