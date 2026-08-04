-- Keep one permissive policy per action. Bank rows are only mutated through
-- the audited commit RPC; explicit settlement matches need insert/delete only.

drop policy if exists bank_transactions_write on public.bank_transactions;
revoke insert, update, delete on table public.bank_transactions from authenticated;

drop policy if exists settlement_bank_matches_write on public.settlement_bank_matches;

create policy settlement_bank_matches_insert on public.settlement_bank_matches
  for insert to authenticated
  with check (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

create policy settlement_bank_matches_delete on public.settlement_bank_matches
  for delete to authenticated
  using (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

-- The permission-aware read policy supersedes the older identity-only policy;
-- the restrictive tenant policy continues to enforce workspace isolation.
drop policy if exists identity_scoped_select on public.platform_file_uploads;
