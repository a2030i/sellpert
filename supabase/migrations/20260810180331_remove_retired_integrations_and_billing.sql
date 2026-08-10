-- Remove retired billing and provider integrations while preserving Amazon
-- and Noon file-import data. Trendyol remains the only direct marketplace API.

do $$
declare v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
    where jobname = 'daily-whatsapp-report'
       or command ilike '%notify-whatsapp%'
       or command ilike '%daily-report%'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

drop trigger if exists trg_notify_new_order on public.orders;
drop function if exists public.notify_order_whatsapp();
drop function if exists security.notify_order_whatsapp();

drop view if exists public.suspended_merchants;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'merchants'
      and column_name = 'subscription_status'
  ) then
    alter table public.merchants rename column subscription_status to workspace_status;
  end if;
end
$$;

alter table public.merchants
  alter column workspace_status set default 'active';

comment on column public.merchants.workspace_status is
  'Administrative workspace access state; independent from billing.';

-- Update existing operational routines that only used the old account-state
-- column. This keeps their authorization and SECURITY DEFINER boundaries
-- intact while removing the retired terminology.
do $$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'security')
      and p.prokind in ('f', 'p')
      and p.proname not in (
        'get_db_health_internal', 'handle_self_service_merchant_signup',
        'suspend_merchant', 'reactivate_merchant'
      )
      and pg_get_functiondef(p.oid) ilike '%subscription_status%'
  loop
    definition := replace(pg_get_functiondef(routine.oid), 'subscription_status', 'workspace_status');
    definition := replace(
      definition,
      $old$credentials.platform in ('trendyol', 'amazon', 'noon')$old$,
      $new$credentials.platform = 'trendyol'$new$
    );
    execute definition;
  end loop;
end
$$;

create or replace function security.handle_self_service_merchant_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_name text;
  v_phone text;
  v_legal_version text;
  v_accepted boolean;
  v_attempt integer := 0;
begin
  if coalesce(new.raw_user_meta_data->>'signup_source', '') <> 'self_service' then
    return new;
  end if;

  v_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'متجر جديد'), 120);
  v_phone := nullif(left(btrim(new.raw_user_meta_data->>'whatsapp_phone'), 32), '');
  v_legal_version := nullif(left(btrim(new.raw_user_meta_data->>'legal_version'), 10), '');
  v_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
    and coalesce((new.raw_user_meta_data->>'privacy_accepted')::boolean, false)
    and v_legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  loop
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.merchants (
        id, merchant_code, name, email, currency, role,
        workspace_status, signup_source, whatsapp_phone, is_active
      ) values (
        new.id, v_code, v_name, lower(new.email), 'SAR', 'merchant',
        'active', 'self_service', v_phone, new.email_confirmed_at is not null
      );
      exit;
    exception when unique_violation then
      if exists (select 1 from public.merchants where id = new.id) then return new; end if;
      if v_attempt >= 3 then raise; end if;
    end;
  end loop;

  if v_accepted then
    insert into public.merchant_legal_acceptances (merchant_code, user_id, terms_version, privacy_version)
    values (v_code, new.id, v_legal_version, v_legal_version);
  end if;
  return new;
end
$$;

drop function if exists public.reactivate_merchant(text, timestamptz);
drop function if exists security.reactivate_merchant(text, timestamptz);

create function security.reactivate_merchant(p_merchant_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.merchants set workspace_status = 'active', is_active = true
  where merchant_code = p_merchant_code;
  update public.salla_connections set sync_status = 'idle'
  where merchant_code = p_merchant_code and sync_status = 'suspended';
end
$$;

create function public.reactivate_merchant(p_merchant_code text)
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.reactivate_merchant(p_merchant_code) $$;

revoke all on function security.reactivate_merchant(text) from public, anon, authenticated;
grant execute on function security.reactivate_merchant(text) to service_role;
revoke all on function public.reactivate_merchant(text) from public, anon;
grant execute on function public.reactivate_merchant(text) to authenticated, service_role;

create or replace function security.suspend_merchant(p_merchant_code text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.merchants set workspace_status = 'suspended'
  where merchant_code = p_merchant_code;
  update public.sync_queue set status = 'skipped', error_message = coalesce(p_reason, 'workspace_suspended')
  where merchant_code = p_merchant_code and status = 'pending';
  update public.salla_connections set sync_status = 'suspended'
  where merchant_code = p_merchant_code;
end
$$;

create or replace function security.get_db_health_internal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  tomorrow_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Riyadh') + interval '1 day') at time zone 'Asia/Riyadh';
  is_service_role boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not is_service_role and not security.has_platform_permission('view_db_health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'db_size_bytes', pg_database_size(current_database()),
    'table_stats', (
      select jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup, 'size_bytes', pg_total_relation_size(relid)) order by n_live_tup desc)
      from pg_stat_user_tables where schemaname = 'public'
    ),
    'active_connections', (select count(*) from pg_stat_activity where state = 'active' and datname = current_database()),
    'total_connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'max_connections', (select setting::int from pg_settings where name = 'max_connections'),
    'queue_stats', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'running', count(*) filter (where status in ('processing','running')),
        'failed', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours'),
        'done_today', count(*) filter (where status in ('done','success') and created_at > now() - interval '24 hours'),
        'stalled', count(*) filter (where status in ('pending','processing','running') and coalesce(started_at, created_at) < now() - interval '30 minutes')
      ) from public.sync_queue
    ),
    'upload_stats', (
      select jsonb_build_object(
        'processing', count(*) filter (where status = 'processing'),
        'stalled', count(*) filter (where status = 'processing' and uploaded_at < now() - interval '30 minutes'),
        'failed_24h', count(*) filter (where status = 'failed' and uploaded_at > now() - interval '24 hours'),
        'success_24h', count(*) filter (where status = 'success' and uploaded_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) filter (where status = 'success')
      ) from public.platform_file_uploads
    ),
    'sync_stats', (
      select jsonb_build_object(
        'errors_24h', count(*) filter (where status = 'error' and started_at > now() - interval '24 hours'),
        'success_24h', count(*) filter (where status = 'success' and started_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) filter (where status = 'success'),
        'last_error_at', max(finished_at) filter (where status = 'error')
      ) from public.sync_logs
    ),
    'stale_active_connections', (
      select count(*) from public.platform_credentials
      where platform = 'trendyol' and is_active = true and (last_sync_at is null or last_sync_at < now() - interval '24 hours')
    ),
    'recent_incidents', (
      select coalesce(jsonb_agg(incident order by incident_time desc), '[]'::jsonb)
      from (
        select jsonb_build_object('source','sync','merchant_code',merchant_code,'platform',platform,'occurred_at',coalesce(finished_at,started_at),'message',left(coalesce(error_message,'Sync failed'),240)) incident,
          coalesce(finished_at,started_at) incident_time from public.sync_logs where status = 'error'
        union all
        select jsonb_build_object('source','upload','merchant_code',merchant_code,'platform',platform,'occurred_at',coalesce(finished_at,uploaded_at),'message',left(coalesce(error_message,'Import failed'),240)) incident,
          coalesce(finished_at,uploaded_at) incident_time from public.platform_file_uploads where status = 'failed'
        order by incident_time desc limit 10
      ) incidents
    ),
    'webhook_errors_24h', (select count(*) from public.webhook_events where status = 'failed' and received_at > now() - interval '24 hours'),
    'merchant_count', (select count(*) from public.merchants where role = 'merchant'),
    'inactive_merchants', (select count(*) from public.merchants where workspace_status <> 'active' or is_active is false),
    'orders_total', (select count(*) from public.orders),
    'orders_today', (select count(*) from public.orders where order_date >= today_start and order_date < tomorrow_start),
    'cache_hit_ratio', (select round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1) from pg_statio_user_tables),
    'oldest_pending_minutes', (select round(extract(epoch from (now() - min(created_at))) / 60) from public.sync_queue where status = 'pending')
  ) into result;
  return result;
end
$$;

create or replace function public.merchant_activation(p_merchant_code text)
returns jsonb
language sql
stable
set search_path = 'public'
as $$
  select jsonb_build_object(
    'has_orders', exists (select 1 from public.orders where merchant_code = p_merchant_code),
    'has_products', exists (select 1 from public.products where merchant_code = p_merchant_code),
    'has_inventory', exists (select 1 from public.inventory where merchant_code = p_merchant_code),
    'has_ad_metrics', exists (select 1 from public.ad_metrics where merchant_code = p_merchant_code),
    'has_returns', exists (select 1 from public.returns where merchant_code = p_merchant_code),
    'has_salla', exists (select 1 from public.salla_connections where merchant_code = p_merchant_code and access_token is not null),
    'has_costs', exists (select 1 from public.products where merchant_code = p_merchant_code and cost_price > 0)
  );
$$;

drop table if exists public.invoices;
drop table if exists public.subscriptions;
drop table if exists public.payment_requests;
drop table if exists public.marketplace_oauth_states;
drop table if exists public.ai_insights;
drop table if exists public.merchant_platform_mappings;
drop table if exists public.platform_connections;

alter table public.merchants
  drop constraint if exists merchants_single_free_plan_check,
  drop constraint if exists merchants_subscription_plan_check,
  drop column if exists subscription_plan,
  drop column if exists subscription_monthly_amount;

delete from public.platform_credentials where platform in ('amazon', 'noon');
delete from public.sync_queue where platform in ('amazon', 'noon');
delete from public.sync_logs where platform in ('amazon', 'noon');
delete from public.webhook_events where source = 'respondly';

alter table public.platform_credentials
  drop constraint if exists platform_credentials_platform_check;
alter table public.platform_credentials
  add constraint platform_credentials_platform_check check (platform = 'trendyol');

delete from public.app_settings
where key ilike '%respondly%'
   or key ilike '%openrouter%'
   or key ilike '%amazon_oauth%'
   or key ilike '%noon_oauth%'
   or key ilike '%plan_price%'
   or key ilike '%subscription%'
   or key = 'supabase_plan';

update public.merchants
set permissions = case
  when jsonb_typeof(permissions) = 'array' then permissions - 'whatsapp_send' - 'whatsapp_bulk' - 'manage_subscriptions'
  when jsonb_typeof(permissions) = 'object' then permissions - 'whatsapp_send' - 'whatsapp_bulk' - 'manage_subscriptions'
  else permissions
end
where permissions is not null;

notify pgrst, 'reload schema';
