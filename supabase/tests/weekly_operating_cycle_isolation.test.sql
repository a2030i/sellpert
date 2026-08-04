-- Regression: goals, weekly snapshots and action outcomes are tenant-scoped,
-- server-calculated, idempotent and evidence-bearing.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009990', 'authenticated', 'authenticated', 'cycle-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cycle A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009991', 'authenticated', 'authenticated', 'cycle-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cycle B"}', now(), now(), now(), false, false);

with merchant as (
  select merchant_code from public.merchants where id='00000000-0000-4000-8000-000000009990'
)
insert into public.orders (
  merchant_code, platform, order_id, status, product_name, sku, quantity,
  unit_price, total_amount, platform_fee, shipping_cost, discount_amount,
  currency, order_date, created_at
)
select merchant_code, 'trendyol', 'CYCLE-' || day_offset, 'delivered',
  'Cycle fixture', 'CYCLE-SKU', 1, 100, 100, 10, 5, 2,
  'SAR', current_date - (day_offset % extract(day from current_date)::integer), now()
from merchant cross join generate_series(0, 6) day_offset;

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000009990';
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000009990","email":"cycle-a@test.invalid","role":"authenticated"}';

select public.set_my_monthly_sales_target(
  extract(year from current_date)::integer,
  extract(month from current_date)::integer,
  1000
);
select public.capture_my_weekly_brief();
select public.capture_my_weekly_brief();

do $$
declare
  own_code text := public.current_merchant_code();
  progress jsonb := public.my_monthly_goal_progress();
  brief_id uuid;
  action_id uuid;
begin
  if (progress->>'target_amount')::numeric <> 1000 then
    raise exception 'monthly target was not stored';
  end if;
  if (progress->>'actual_sales')::numeric <> 700 then
    raise exception 'monthly actual sales are incorrect';
  end if;
  if (select count(*) from public.merchant_weekly_briefs where merchant_code=own_code) <> 1 then
    raise exception 'weekly capture is not idempotent';
  end if;

  select id into brief_id from public.merchant_weekly_briefs where merchant_code=own_code;
  update public.merchant_weekly_briefs set actual_sales=999999 where id=brief_id;
  if (select actual_sales from public.merchant_weekly_briefs where id=brief_id) <> 700 then
    raise exception 'client forged a calculated weekly value';
  end if;

  action_id := (public.create_my_action(
    'cycle-action', 'Cycle action', 'operations', 'high',
    'Verify completion evidence', 'Measured result', '{}', current_date + 3
  )->>'id')::uuid;

  begin
    perform public.complete_my_action(action_id, 'achieved', 'x');
    raise exception 'SHORT_COMPLETION_NOTE_ALLOWED';
  exception when others then
    if sqlerrm='SHORT_COMPLETION_NOTE_ALLOWED' then raise; end if;
  end;

  perform public.complete_my_action(action_id, 'achieved', 'تم تنفيذ الإجراء والتحقق من النتيجة');
  if not exists (
    select 1 from public.merchant_requests
    where id=action_id and status='done' and completion_result='achieved'
      and completion_note is not null and completion_recorded_at is not null
  ) then
    raise exception 'action completion evidence was not recorded';
  end if;

  create temporary table cycle_action_fixture(id uuid, merchant_code text) on commit drop;
  insert into cycle_action_fixture values(action_id, own_code);
end
$$;

set local request.jwt.claim.sub='00000000-0000-4000-8000-000000009991';
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000009991","email":"cycle-b@test.invalid","role":"authenticated"}';

do $$
declare
  a_action uuid := (select id from cycle_action_fixture);
  a_code text := (select merchant_code from cycle_action_fixture);
  capture jsonb;
begin
  if exists (select 1 from public.merchant_weekly_briefs where merchant_code=a_code) then
    raise exception 'foreign weekly brief became visible';
  end if;
  capture := public.capture_my_weekly_brief();
  if (capture->>'captured')::boolean then
    raise exception 'empty merchant captured a weekly brief';
  end if;
  begin
    perform public.complete_my_action(a_action, 'achieved', 'محاولة تعديل إجراء متجر آخر');
    raise exception 'CROSS_TENANT_ACTION_COMPLETION_ALLOWED';
  exception when others then
    if sqlerrm='CROSS_TENANT_ACTION_COMPLETION_ALLOWED' then raise; end if;
  end;
end
$$;

reset role;
rollback;
