-- Isolated schema test only. Never run these fixtures against production.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009901', 'authenticated', 'authenticated', 'amazon-import-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Amazon Import A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009902', 'authenticated', 'authenticated', 'amazon-import-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Amazon Import B"}', now(), now(), now(), false, false);

do $$
declare
  merchant_a text;
begin
  select merchant_code into merchant_a from public.merchants where id = '00000000-0000-4000-8000-000000009901';
  insert into public.platform_credentials (merchant_code, platform, seller_id, is_active, extra)
  values (merchant_a, 'amazon', 'AMAZONIMPORTTEST', true, '{}'::jsonb);
  insert into public.platform_file_uploads (id, merchant_code, platform, file_name, file_type, status, storage_path)
  values
    ('00000000-0000-4000-a000-000000009911', merchant_a, 'amazon', 'amazon.csv', 'amazon_orders', 'processing', merchant_a || '/00000000-0000-4000-a000-000000009911/amazon.csv'),
    ('00000000-0000-4000-a000-000000009912', merchant_a, 'noon', 'relabeled.csv', 'noon_sales', 'processing', merchant_a || '/00000000-0000-4000-a000-000000009912/relabeled.csv');
  if has_function_privilege('anon', 'public.amazon_file_import_allowed(text)', 'execute') then
    raise exception 'anonymous caller can inspect import policy';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009901', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009901","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  merchant_a text := public.current_merchant_code();
  blocked boolean;
  candidate jsonb;
begin
  if public.amazon_file_import_allowed(merchant_a) then
    raise exception 'active Amazon connection still permits file import';
  end if;
  blocked := false;
  begin
    perform public.amazon_file_import_allowed('UNAUTHORIZED-WORKSPACE');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'import policy permits unauthorized workspace lookup'; end if;

  -- An Amazon-labelled upload is blocked regardless of its payload label.
  blocked := false;
  begin
    perform public.commit_my_file_import('00000000-0000-4000-a000-000000009911',
      '[{"table":"orders","rows":[{"platform":"noon","order_id":"AMAZON-POLICY-TEST","total_amount":1}]}]'::jsonb);
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Amazon-labelled upload was allowed'; end if;

  -- Relabeling metadata cannot admit Amazon rows or its platformless summary table.
  for candidate in select value from jsonb_array_elements('[
    [{"table":"orders","rows":[{"platform":"amazon","order_id":"AMAZON-POLICY-TEST","total_amount":1}]}],
    [{"table":"amazon_daily_sales","rows":[{"data_date":"2026-11-26","ordered_product_sales":1}]}]
  ]'::jsonb) loop
    blocked := false;
    begin
      perform public.commit_my_file_import('00000000-0000-4000-a000-000000009912', candidate);
    exception when sqlstate '55000' then blocked := true;
    end;
    if not blocked then raise exception 'relabelled Amazon payload was allowed'; end if;
  end loop;

  if exists (select 1 from public.orders where merchant_code = merchant_a and order_id = 'AMAZON-POLICY-TEST') then
    raise exception 'rejected import wrote business data';
  end if;
  if exists (select 1 from public.platform_file_uploads where id in ('00000000-0000-4000-a000-000000009911', '00000000-0000-4000-a000-000000009912') and status <> 'processing') then
    raise exception 'rejected import changed existing audit state';
  end if;

  perform public.commit_my_file_import('00000000-0000-4000-a000-000000009912',
    '[{"table":"orders","rows":[{"platform":"noon","order_id":"NOON-POLICY-TEST","status":"delivered","total_amount":1}]}]'::jsonb);
  if not exists (select 1 from public.orders where merchant_code = merchant_a and order_id = 'NOON-POLICY-TEST') then
    raise exception 'Amazon rule prevented another platform import';
  end if;
end
$$;

reset role;
update public.platform_credentials set is_active = false
where seller_id = 'AMAZONIMPORTTEST' and platform = 'amazon';
set local role authenticated;

do $$
begin
  if not public.amazon_file_import_allowed(public.current_merchant_code()) then
    raise exception 'inactive connection prevents file import';
  end if;
  perform public.commit_my_file_import('00000000-0000-4000-a000-000000009911',
    '[{"table":"orders","rows":[{"platform":"amazon","order_id":"AMAZON-POLICY-TEST","status":"delivered","total_amount":1}]}]'::jsonb);
end
$$;
rollback;
