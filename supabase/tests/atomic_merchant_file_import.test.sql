begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000008801', 'authenticated', 'authenticated', 'atomic-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Atomic A"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000008802', 'authenticated', 'authenticated', 'atomic-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Atomic B"}', now(), now(), false, false);

do $$
declare
  merchant_a text;
  merchant_b text;
begin
  select merchant_code into merchant_a from public.merchants where id = '00000000-0000-4000-8000-000000008801';
  select merchant_code into merchant_b from public.merchants where id = '00000000-0000-4000-8000-000000008802';

  insert into public.platform_file_uploads (
    id, merchant_code, platform, file_name, file_type, status, storage_path
  ) values
    ('00000000-0000-4000-a000-000000008811', merchant_a, 'noon', 'atomic-success.xlsx', 'noon_sales', 'processing',
     merchant_a || '/00000000-0000-4000-a000-000000008811/atomic-success.xlsx'),
    ('00000000-0000-4000-a000-000000008812', merchant_a, 'noon', 'atomic-rollback.xlsx', 'noon_sales', 'processing',
     merchant_a || '/00000000-0000-4000-a000-000000008812/atomic-rollback.xlsx'),
    ('00000000-0000-4000-a000-000000008813', merchant_b, 'noon', 'other-tenant.xlsx', 'noon_sales', 'processing',
     merchant_b || '/00000000-0000-4000-a000-000000008813/other-tenant.xlsx'),
    ('00000000-0000-4000-a000-000000008814', merchant_a, 'noon', 'not-archived.xlsx', 'noon_sales', 'processing', null),
    ('00000000-0000-4000-a000-000000008815', merchant_a, 'noon', 'unknown-table.xlsx', 'noon_sales', 'processing',
     merchant_a || '/00000000-0000-4000-a000-000000008815/unknown-table.xlsx');
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000008801', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000008801","email":"atomic-a@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  merchant_a text := public.current_merchant_code();
  merchant_b text;
  result jsonb;
  blocked boolean;
begin
  select merchant_code into merchant_b
  from public.merchants where id = '00000000-0000-4000-8000-000000008802';

  result := public.commit_my_file_import(
    '00000000-0000-4000-a000-000000008811',
    jsonb_build_array(
      jsonb_build_object('table', 'orders', 'rows', jsonb_build_array(
        jsonb_build_object(
          'merchant_code', merchant_b,
          'platform', 'noon',
          'order_id', 'ATOMIC-SUCCESS-ORDER',
          'status', 'delivered',
          'total_amount', 75
        )
      )),
      jsonb_build_object('table', 'inventory', 'rows', jsonb_build_array(
        jsonb_build_object(
          'merchant_code', merchant_b,
          'platform', 'noon',
          'sku', 'ATOMIC-SUCCESS-SKU',
          'quantity', 9
        )
      ))
    )
  );

  if (result ->> 'inserted')::integer <> 2 then
    raise exception 'atomic success returned the wrong affected row count: %', result;
  end if;
  if not exists (
    select 1 from public.orders
    where merchant_code = merchant_a and order_id = 'ATOMIC-SUCCESS-ORDER'
      and upload_id = '00000000-0000-4000-a000-000000008811'
  ) then
    raise exception 'atomic import did not persist the order in the caller tenant';
  end if;
  if exists (
    select 1 from public.orders
    where merchant_code = merchant_b and order_id = 'ATOMIC-SUCCESS-ORDER'
  ) then
    raise exception 'client-supplied merchant code escaped the tenant boundary';
  end if;
  if not exists (
    select 1 from public.platform_file_uploads
    where id = '00000000-0000-4000-a000-000000008811'
      and status = 'success' and rows_processed = 2 and rows_inserted = 2
  ) then
    raise exception 'successful import audit was not completed in the same transaction';
  end if;

  blocked := false;
  begin
    perform public.commit_my_file_import(
      '00000000-0000-4000-a000-000000008812',
      jsonb_build_array(
        jsonb_build_object('table', 'orders', 'rows', jsonb_build_array(
          jsonb_build_object('platform', 'noon', 'order_id', 'ATOMIC-MUST-ROLLBACK', 'total_amount', 10)
        )),
        jsonb_build_object('table', 'inventory', 'rows', jsonb_build_array(
          jsonb_build_object('platform', 'noon', 'sku', 'ATOMIC-BAD-SKU', 'quantity', 'not-an-integer')
        ))
      )
    );
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception 'invalid second payload was accepted';
  end if;
  if exists (select 1 from public.orders where order_id = 'ATOMIC-MUST-ROLLBACK') then
    raise exception 'first payload remained after the second payload failed';
  end if;
  if not exists (
    select 1 from public.platform_file_uploads
    where id = '00000000-0000-4000-a000-000000008812' and status = 'processing'
  ) then
    raise exception 'failed transaction partially changed its upload audit';
  end if;

  blocked := false;
  begin
    perform public.commit_my_file_import(
      '00000000-0000-4000-a000-000000008813',
      '[{"table":"orders","rows":[{"platform":"noon","order_id":"CROSS-TENANT"}]}]'::jsonb
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'merchant committed another tenant upload';
  end if;

  blocked := false;
  begin
    perform public.commit_my_file_import(
      '00000000-0000-4000-a000-000000008814',
      '[{"table":"orders","rows":[{"platform":"noon","order_id":"NO-ARCHIVE"}]}]'::jsonb
    );
  exception when object_not_in_prerequisite_state then
    blocked := true;
  end;
  if not blocked then
    raise exception 'unarchived source was imported';
  end if;

  blocked := false;
  begin
    perform public.commit_my_file_import(
      '00000000-0000-4000-a000-000000008815',
      '[{"table":"merchants","rows":[{"name":"unsafe"}]}]'::jsonb
    );
  exception when invalid_parameter_value then
    blocked := true;
  end;
  if not blocked then
    raise exception 'unknown import table was accepted';
  end if;
end
$$;

reset role;

do $$
begin
  if has_function_privilege('anon', 'public.commit_my_file_import(uuid,jsonb)', 'execute') then
    raise exception 'anonymous role can execute atomic import';
  end if;
  if has_function_privilege('authenticated', 'security.upsert_merchant_import_rows(text,jsonb,uuid,text)', 'execute') then
    raise exception 'authenticated client can bypass the atomic import authorizer';
  end if;
end
$$;

rollback;
