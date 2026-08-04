-- Independent bank evidence for marketplace settlement reconciliation.
-- The source file remains in the private merchant-imports bucket, while every
-- parsed row and explicit merchant confirmation stays tenant-scoped and audited.

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on update cascade on delete cascade,
  upload_id uuid not null references public.platform_file_uploads(id) on delete cascade,
  transaction_key text not null,
  transaction_date date not null,
  value_date date,
  description text,
  reference text,
  debit numeric(16,2) not null default 0,
  credit numeric(16,2) not null default 0,
  net_amount numeric(16,2) generated always as (credit - debit) stored,
  balance numeric(16,2),
  currency text not null default 'SAR',
  account_hint text,
  created_at timestamptz not null default now(),
  constraint bank_transactions_key_unique unique (merchant_code, transaction_key),
  constraint bank_transactions_amounts_nonnegative check (debit >= 0 and credit >= 0),
  constraint bank_transactions_has_amount check (debit > 0 or credit > 0),
  constraint bank_transactions_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint bank_transactions_key_valid check (length(transaction_key) between 16 and 180),
  constraint bank_transactions_reference_length check (reference is null or length(reference) <= 300),
  constraint bank_transactions_description_length check (description is null or length(description) <= 1000),
  constraint bank_transactions_account_hint_valid check (account_hint is null or account_hint ~ '^.{0,4}$')
);

create index bank_transactions_merchant_date_idx
  on public.bank_transactions (merchant_code, transaction_date desc);
create index bank_transactions_merchant_credit_idx
  on public.bank_transactions (merchant_code, credit, transaction_date desc)
  where credit > 0;

alter table public.bank_transactions enable row level security;
revoke all on table public.bank_transactions from public, anon, authenticated;
grant select, insert, update, delete on table public.bank_transactions to authenticated, service_role;

create policy bank_transactions_tenant_boundary on public.bank_transactions
  as restrictive for all to authenticated
  using ((select security.can_access_merchant(merchant_code)))
  with check ((select security.can_access_merchant(merchant_code)));

create policy bank_transactions_read on public.bank_transactions
  for select to authenticated
  using (
    (select security.has_any_platform_permission(array['view_finance','view_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

create policy bank_transactions_write on public.bank_transactions
  for all to authenticated
  using (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  )
  with check (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

create table public.settlement_bank_matches (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on update cascade on delete cascade,
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  platform text not null,
  settlement_id text not null,
  expected_amount numeric(16,2) not null,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  note text,
  constraint settlement_bank_matches_settlement_unique unique (merchant_code, platform, settlement_id),
  constraint settlement_bank_matches_bank_unique unique (merchant_code, bank_transaction_id),
  constraint settlement_bank_matches_expected_positive check (expected_amount > 0),
  constraint settlement_bank_matches_platform_valid check (platform = any (array['trendyol','amazon','noon','salla','zid','shopify','other']::text[])),
  constraint settlement_bank_matches_reference_valid check (length(settlement_id) between 1 and 200),
  constraint settlement_bank_matches_note_length check (note is null or length(note) <= 1000)
);

create index settlement_bank_matches_merchant_idx
  on public.settlement_bank_matches (merchant_code, confirmed_at desc);

alter table public.settlement_bank_matches enable row level security;
revoke all on table public.settlement_bank_matches from public, anon, authenticated;
grant select, insert, delete on table public.settlement_bank_matches to authenticated, service_role;

create policy settlement_bank_matches_tenant_boundary on public.settlement_bank_matches
  as restrictive for all to authenticated
  using ((select security.can_access_merchant(merchant_code)))
  with check ((select security.can_access_merchant(merchant_code)));

create policy settlement_bank_matches_read on public.settlement_bank_matches
  for select to authenticated
  using (
    (select security.has_any_platform_permission(array['view_finance','view_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

create policy settlement_bank_matches_write on public.settlement_bank_matches
  for all to authenticated
  using (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  )
  with check (
    (select security.has_any_platform_permission(array['edit_billing','upload_files']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['statement']::text[]))
    )
  );

-- Finance employees may archive a bank statement without gaining permission
-- to import marketplace catalog/order files. The commit function below only
-- accepts the bank_statement file type and bank rows.
drop policy if exists merchant_permission_read on public.platform_file_uploads;
drop policy if exists merchant_permission_select_boundary on public.platform_file_uploads;
drop policy if exists merchant_permission_insert_boundary on public.platform_file_uploads;
drop policy if exists merchant_permission_update_boundary on public.platform_file_uploads;
drop policy if exists merchant_permission_delete_boundary on public.platform_file_uploads;

create policy merchant_permission_read on public.platform_file_uploads
  for select to authenticated using (
    (select security.has_any_platform_permission(array['view_files','view_finance']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  );
create policy merchant_permission_select_boundary on public.platform_file_uploads
  as restrictive for select to authenticated using (
    (select security.has_any_platform_permission(array['view_files','view_finance']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  );
create policy merchant_permission_insert_boundary on public.platform_file_uploads
  as restrictive for insert to authenticated with check (
    (select security.has_any_platform_permission(array['upload_files','edit_billing']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  );
create policy merchant_permission_update_boundary on public.platform_file_uploads
  as restrictive for update to authenticated using (
    (select security.has_any_platform_permission(array['upload_files','edit_billing']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  ) with check (
    (select security.has_any_platform_permission(array['upload_files','edit_billing']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  );
create policy merchant_permission_delete_boundary on public.platform_file_uploads
  as restrictive for delete to authenticated using (
    (select security.has_any_platform_permission(array['delete_files','edit_billing']::text[]))
    or (
      not (select security.is_platform_staff_account())
      and (select security.current_has_any_merchant_permission(array['integrations','statement']::text[]))
    )
  );

drop policy if exists merchant_imports_select_own on storage.objects;
drop policy if exists merchant_imports_insert_own on storage.objects;
drop policy if exists merchant_imports_delete_own on storage.objects;

create policy merchant_imports_select_own on storage.objects for select to authenticated
using (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and security.current_has_any_merchant_permission(array['integrations','statement']::text[])
);
create policy merchant_imports_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(storage.extension(name)) = any (array['csv','tsv','txt','xls','xlsx','xlsm'])
  and security.current_has_any_merchant_permission(array['integrations','statement']::text[])
);
create policy merchant_imports_delete_own on storage.objects for delete to authenticated
using (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and security.current_has_any_merchant_permission(array['integrations','statement']::text[])
);

create or replace function security.commit_merchant_bank_statement(
  p_upload_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_upload public.platform_file_uploads%rowtype;
  v_rows jsonb;
  v_processed integer;
  v_affected integer := 0;
  v_is_service_role boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_is_service_role and (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'bank rows must be an array';
  end if;
  v_processed := jsonb_array_length(p_rows);
  if v_processed <= 0 or v_processed > 25000 then
    raise exception using errcode = '54000', message = 'bank row count is outside the supported range';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) value where jsonb_typeof(value) <> 'object') then
    raise exception using errcode = '22023', message = 'every bank row must be an object';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) value
    group by value ->> 'transaction_key' having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'duplicate bank row identifier in source file';
  end if;

  select * into v_upload from public.platform_file_uploads where id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'upload record not found';
  end if;
  if v_upload.file_type <> 'bank_statement' or v_upload.platform <> 'bank' then
    raise exception using errcode = '22023', message = 'upload is not a bank statement';
  end if;
  if not v_is_service_role and not security.has_merchant_permission(v_upload.merchant_code, 'statement') then
    raise exception using errcode = '42501', message = 'finance permission is required';
  end if;
  if v_upload.status <> 'processing' then
    raise exception using errcode = '55000', message = 'upload is not ready for import';
  end if;
  if v_upload.storage_path is null
     or split_part(v_upload.storage_path, '/', 1) <> v_upload.merchant_code
     or split_part(v_upload.storage_path, '/', 2) <> p_upload_id::text then
    raise exception using errcode = '42501', message = 'source archive is outside the merchant workspace';
  end if;

  select jsonb_agg(
    (value - 'id' - 'merchant_code' - 'upload_id' - 'net_amount' - 'created_at')
      || jsonb_build_object('merchant_code', v_upload.merchant_code, 'upload_id', p_upload_id)
  ) into v_rows from jsonb_array_elements(p_rows) value;

  with source as (
    select * from jsonb_populate_recordset(null::public.bank_transactions, v_rows)
  )
  insert into public.bank_transactions (
    merchant_code, upload_id, transaction_key, transaction_date, value_date,
    description, reference, debit, credit, balance, currency, account_hint
  )
  select
    v_upload.merchant_code, p_upload_id, transaction_key, transaction_date, value_date,
    description, reference, debit, credit, balance, currency, account_hint
  from source
  on conflict (merchant_code, transaction_key) do update set
    upload_id = excluded.upload_id,
    transaction_date = excluded.transaction_date,
    value_date = excluded.value_date,
    description = excluded.description,
    reference = excluded.reference,
    debit = excluded.debit,
    credit = excluded.credit,
    balance = excluded.balance,
    currency = excluded.currency,
    account_hint = excluded.account_hint;
  get diagnostics v_affected = row_count;

  update public.platform_file_uploads
  set rows_processed = v_processed,
      rows_inserted = v_affected,
      status = 'success',
      error_message = null,
      finished_at = now()
  where id = p_upload_id;

  return jsonb_build_object('processed', v_processed, 'inserted', v_affected);
exception when others then
  update public.platform_file_uploads
  set status = 'failed', error_message = left(sqlerrm, 1000), finished_at = now()
  where id = p_upload_id;
  raise;
end
$$;

create or replace function public.commit_my_bank_statement(p_upload_id uuid, p_rows jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select security.commit_merchant_bank_statement(p_upload_id, p_rows) $$;

revoke all on function security.commit_merchant_bank_statement(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.commit_my_bank_statement(uuid, jsonb) from public, anon;
grant execute on function security.commit_merchant_bank_statement(uuid, jsonb) to service_role;
grant execute on function public.commit_my_bank_statement(uuid, jsonb) to authenticated, service_role;

create or replace function security.stamp_settlement_bank_match()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_merchant_code text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  select merchant_code into v_merchant_code
  from public.bank_transactions where id = new.bank_transaction_id;
  if v_merchant_code is null
     or not security.has_merchant_permission(v_merchant_code, 'statement') then
    raise exception using errcode = '42501', message = 'bank transaction is outside the active workspace';
  end if;
  new.merchant_code := v_merchant_code;
  new.confirmed_by := (select auth.uid());
  new.confirmed_at := now();
  return new;
end
$$;

create trigger settlement_bank_matches_stamp_identity
before insert or update on public.settlement_bank_matches
for each row execute function security.stamp_settlement_bank_match();

revoke all on function security.stamp_settlement_bank_match() from public, anon, authenticated;
grant execute on function security.stamp_settlement_bank_match() to service_role;

comment on table public.bank_transactions is
  'Tenant-scoped rows parsed from privately archived bank statements; full account numbers are never stored.';
comment on table public.settlement_bank_matches is
  'Explicit merchant confirmations linking one bank credit to one marketplace settlement.';
