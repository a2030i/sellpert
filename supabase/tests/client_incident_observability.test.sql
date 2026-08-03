-- Privacy, tenancy, deduplication, and privileged triage regression.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009971', 'authenticated', 'authenticated', 'incident-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Incident Tenant A"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009972', 'authenticated', 'authenticated', 'incident-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Incident Tenant B"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009973', 'authenticated', 'authenticated', 'incident-admin@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Incident Staff"}', now(), now(), false, false);

update public.merchants
set role = 'staff', permissions = '["view_db_health"]'::jsonb
where id = '00000000-0000-4000-8000-000000009973';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009971', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009971","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  first_result jsonb;
  second_result jsonb;
begin
  first_result := public.report_client_incident(
    'render', 'fatal', '/product-detail/550e8400-e29b-41d4-a716-446655440000?token=secret',
    'ProductDetail', 'render', 'TypeError:private-message', null, '91fdeab'
  );
  second_result := public.report_client_incident(
    'render', 'fatal', '/product-detail/550e8400-e29b-41d4-a716-446655440000?different=secret',
    'ProductDetail', 'render', 'TypeError:another-message', null, '91fdeab'
  );
  if not coalesce((first_result ->> 'accepted')::boolean, false)
     or not coalesce((second_result ->> 'accepted')::boolean, false) then
    raise exception 'authenticated tenant incident was not accepted';
  end if;

  begin
    perform count(*) from security.client_incidents;
    raise exception 'merchant read the private incident table directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
declare
  tenant_code text;
  incident security.client_incidents%rowtype;
begin
  select merchant_code into tenant_code from public.merchants where id = '00000000-0000-4000-8000-000000009971';
  select * into incident from security.client_incidents where merchant_code = tenant_code;
  if incident.occurrence_count <> 2 then
    raise exception 'equivalent incidents were not deduplicated: %', incident.occurrence_count;
  end if;
  if incident.page_path <> '/product-detail/:id' then
    raise exception 'page path was not privacy-normalized: %', incident.page_path;
  end if;
  if incident.error_code like '%message%' or incident.error_code like '%private%' then
    raise exception 'arbitrary error text crossed the incident boundary: %', incident.error_code;
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009972', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009972","role":"authenticated"}', true);
set local role authenticated;
select public.report_client_incident('network', 'error', '/orders', 'orders', 'load', 'network_failure', 503, '91fdeab');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009973', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009973","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  health jsonb;
  tenant_a text;
  target_id uuid;
begin
  health := public.get_db_health();
  if (health #>> '{client_incident_stats,open}')::integer <> 2 then
    raise exception 'health payload did not aggregate open client incidents: %', health -> 'client_incident_stats';
  end if;
  if jsonb_array_length(health -> 'recent_client_incidents') <> 2 then
    raise exception 'health payload did not expose safe incident summaries';
  end if;

  select merchant_code into tenant_a from public.merchants where id = '00000000-0000-4000-8000-000000009971';
  select (item ->> 'id')::uuid into target_id
  from jsonb_array_elements(health -> 'recent_client_incidents') item
  where item ->> 'merchant_code' = tenant_a;

  if not public.update_client_incident_status(target_id, 'resolved') then
    raise exception 'privileged incident resolution failed';
  end if;

  health := public.get_db_health();
  if (health #>> '{client_incident_stats,open}')::integer <> 1 then
    raise exception 'resolved incident remained open';
  end if;
end
$$;

reset role;
rollback;

