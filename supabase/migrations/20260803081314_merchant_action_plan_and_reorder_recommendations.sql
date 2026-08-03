alter table public.merchant_requests
  add column if not exists request_kind text not null default 'support',
  add column if not exists source_key text,
  add column if not exists expected_impact text;

alter table public.merchant_requests
  drop constraint if exists merchant_requests_request_kind_check;

alter table public.merchant_requests
  add constraint merchant_requests_request_kind_check
  check (request_kind in ('support', 'action'));

create unique index if not exists merchant_requests_active_action_source_uidx
  on public.merchant_requests (merchant_code, source_key)
  where request_kind = 'action'
    and source_key is not null
    and status not in ('done', 'rejected');

create index if not exists merchant_requests_action_plan_idx
  on public.merchant_requests (merchant_code, status, due_date)
  where request_kind = 'action';

create or replace function public.create_my_action(
  p_source_key text,
  p_title text,
  p_category text default 'operations',
  p_priority text default 'medium',
  p_note text default null,
  p_expected_impact text default null,
  p_details jsonb default '{}'::jsonb,
  p_due_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_id uuid;
  v_created boolean := false;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if nullif(btrim(p_source_key), '') is null or nullif(btrim(p_title), '') is null then
    raise exception 'ACTION_FIELDS_REQUIRED';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'INVALID_PRIORITY';
  end if;

  select id into v_id
  from public.merchant_requests
  where merchant_code = v_merchant_code
    and request_kind = 'action'
    and source_key = left(btrim(p_source_key), 180)
    and status not in ('done', 'rejected')
  order by created_at desc
  limit 1;

  if v_id is null then
    begin
      insert into public.merchant_requests (
        merchant_code, type, title, category, priority, note, details,
        status, created_by, created_by_role, due_date,
        request_kind, source_key, expected_impact
      ) values (
        v_merchant_code, 'task', left(btrim(p_title), 240), nullif(btrim(p_category), ''),
        p_priority, nullif(btrim(p_note), ''), coalesce(p_details, '{}'::jsonb),
        'pending', auth.jwt() ->> 'email', 'merchant', p_due_date,
        'action', left(btrim(p_source_key), 180), nullif(btrim(p_expected_impact), '')
      ) returning id into v_id;
      v_created := true;
    exception when unique_violation then
      select id into v_id
      from public.merchant_requests
      where merchant_code = v_merchant_code
        and request_kind = 'action'
        and source_key = left(btrim(p_source_key), 180)
        and status not in ('done', 'rejected')
      order by created_at desc limit 1;
    end;
  end if;

  return jsonb_build_object('id', v_id, 'created', v_created);
end;
$$;

create or replace function public.update_my_action_status(p_action_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_updated integer;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_status not in ('pending', 'in_progress', 'done') then
    raise exception 'INVALID_ACTION_STATUS';
  end if;

  update public.merchant_requests
  set status = p_status,
      updated_at = now(),
      resolved_at = case when p_status = 'done' then now() else null end,
      resolved_by = case when p_status = 'done' then auth.jwt() ->> 'email' else null end
  where id = p_action_id
    and merchant_code = v_merchant_code
    and request_kind = 'action';
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'ACTION_NOT_FOUND';
  end if;
  return jsonb_build_object('id', p_action_id, 'status', p_status);
end;
$$;

revoke all on function public.create_my_action(text,text,text,text,text,text,jsonb,date) from public, anon;
revoke all on function public.update_my_action_status(uuid,text) from public, anon;
grant execute on function public.create_my_action(text,text,text,text,text,text,jsonb,date) to authenticated;
grant execute on function public.update_my_action_status(uuid,text) to authenticated;

comment on function public.create_my_action(text,text,text,text,text,text,jsonb,date) is
  'Creates one tenant-scoped merchant action and deduplicates active source keys.';
comment on function public.update_my_action_status(uuid,text) is
  'Changes only the status of an action owned by the authenticated merchant.';

create or replace view public.inventory_reorder_recommendations
with (security_invoker = true)
as
select
  id as inventory_id,
  merchant_code,
  platform,
  sku,
  product_name,
  quantity as current_quantity,
  cost_price,
  daily_velocity,
  days_of_stock,
  data_as_of,
  data_age_days,
  greatest(0, ceil((daily_velocity * 30) - quantity))::integer as recommended_quantity,
  round(greatest(0, ceil((daily_velocity * 30) - quantity)) * cost_price, 2) as estimated_cost,
  case
    when quantity = 0 then 'critical'
    when days_of_stock <= 7 then 'high'
    else 'medium'
  end as urgency
from public.inventory_health
where data_age_days between 0 and 2
  and daily_velocity > 0
  and cost_price > 0
  and (quantity = 0 or days_of_stock <= 14)
  and greatest(0, ceil((daily_velocity * 30) - quantity)) > 0;

revoke all on public.inventory_reorder_recommendations from public, anon;
grant select on public.inventory_reorder_recommendations to authenticated;

comment on view public.inventory_reorder_recommendations is
  'Tenant-filtered 30-day reorder suggestions, only from fresh velocity data and known product costs.';
