-- Regression: action effectiveness analytics are accurate and tenant-isolated.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009971', 'authenticated', 'authenticated', 'effect-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Effect A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009972', 'authenticated', 'authenticated', 'effect-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Effect B"}', now(), now(), now(), false, false);

do $$
begin
  if has_function_privilege('anon', 'public.my_action_effectiveness(integer)', 'execute') then
    raise exception 'ANON_ACTION_ANALYTICS_EXECUTE_ALLOWED';
  end if;
  if not has_function_privilege('authenticated', 'public.my_action_effectiveness(integer)', 'execute') then
    raise exception 'AUTHENTICATED_ACTION_ANALYTICS_EXECUTE_MISSING';
  end if;
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009971';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009971","email":"effect-a@test.invalid","role":"authenticated"}';

create temp table effect_a_actions(id uuid, result text) on commit drop;

insert into effect_a_actions
select (public.create_my_action('effect-a-achieved', 'Achieved action', 'profitability', 'high', null, 'Measured impact', '{}', current_date)->>'id')::uuid, 'achieved'
union all
select (public.create_my_action('effect-a-partial', 'Partial action', 'inventory', 'medium', null, 'Measured impact', '{}', current_date)->>'id')::uuid, 'partial'
union all
select (public.create_my_action('effect-a-failed', 'Failed action', 'inventory', 'medium', null, 'Measured impact', '{}', current_date)->>'id')::uuid, 'not_achieved';

select public.complete_my_action(id, result, 'تم تنفيذ الإجراء وتوثيق النتيجة الفعلية')
from effect_a_actions;

select public.create_my_action(
  'effect-a-overdue', 'Overdue action', 'operations', 'urgent',
  null, 'Pending impact', '{}', current_date - 1
);

do $$
declare
  analytics jsonb := public.my_action_effectiveness(90);
begin
  if (analytics #>> '{open,total}')::integer <> 1
     or (analytics #>> '{open,urgent}')::integer <> 1
     or (analytics #>> '{open,overdue}')::integer <> 1 then
    raise exception 'ACTION_OPEN_SUMMARY_INCORRECT: %', analytics;
  end if;
  if (analytics #>> '{completed,total}')::integer <> 3
     or (analytics #>> '{completed,achieved}')::integer <> 1
     or (analytics #>> '{completed,partial}')::integer <> 1
     or (analytics #>> '{completed,not_achieved}')::integer <> 1
     or (analytics #>> '{completed,measured}')::integer <> 3 then
    raise exception 'ACTION_COMPLETED_SUMMARY_INCORRECT: %', analytics;
  end if;
  if (analytics #>> '{completed,achieved_rate_pct}')::numeric <> 33.3
     or (analytics #>> '{completed,positive_rate_pct}')::numeric <> 66.7 then
    raise exception 'ACTION_OUTCOME_RATES_INCORRECT: %', analytics;
  end if;
  if jsonb_array_length(analytics->'weeks') <> 8 then
    raise exception 'ACTION_WEEK_SERIES_INCOMPLETE: %', analytics;
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(analytics->'categories') row
    where row->>'category' = 'inventory'
      and (row->>'completed')::integer = 2
  ) then
    raise exception 'ACTION_CATEGORY_SUMMARY_INCORRECT: %', analytics;
  end if;
end
$$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009972';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009972","email":"effect-b@test.invalid","role":"authenticated"}';

do $$
declare
  analytics jsonb := public.my_action_effectiveness(90);
begin
  if (analytics #>> '{open,total}')::integer <> 0
     or (analytics #>> '{completed,total}')::integer <> 0 then
    raise exception 'CROSS_TENANT_ACTION_ANALYTICS_VISIBLE: %', analytics;
  end if;
end
$$;

reset role;
rollback;
