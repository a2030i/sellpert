create or replace function public.get_db_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  tomorrow_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Riyadh') + interval '1 day') at time zone 'Asia/Riyadh';
begin
  if auth.uid() is null or not exists (
    select 1
    from public.merchants
    where email = auth.jwt() ->> 'email'
      and role in ('admin', 'employee')
      and coalesce(is_active, true)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'table_stats', (
      select jsonb_agg(
        jsonb_build_object(
          'table', t.relname,
          'rows', t.n_live_tup,
          'size_bytes', pg_catalog.pg_total_relation_size(t.relid)
        )
        order by t.n_live_tup desc
      )
      from pg_catalog.pg_stat_user_tables t
      where t.schemaname = 'public'
    ),
    'active_connections', (
      select count(*) from pg_catalog.pg_stat_activity
      where state = 'active' and datname = pg_catalog.current_database()
    ),
    'total_connections', (
      select count(*) from pg_catalog.pg_stat_activity
      where datname = pg_catalog.current_database()
    ),
    'max_connections', (
      select setting::int from pg_catalog.pg_settings where name = 'max_connections'
    ),
    'queue_stats', (
      select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'running', count(*) filter (where status = 'running'),
        'failed', count(*) filter (where status = 'failed'),
        'done_today', count(*) filter (where status = 'done' and created_at > now() - interval '24 hours')
      )
      from public.sync_queue
    ),
    'webhook_errors_24h', (
      select count(*) from public.webhook_events
      where status = 'failed' and received_at > now() - interval '24 hours'
    ),
    'merchant_count', (
      select count(*) from public.merchants where role = 'merchant'
    ),
    'active_subscriptions', (
      select count(*) from public.subscriptions where status = 'active'
    ),
    'suspended_merchants', (
      select count(*) from public.merchants where subscription_status = 'suspended'
    ),
    'orders_total', (
      select count(*) from public.orders
    ),
    'orders_today', (
      select count(*) from public.orders
      where order_date >= today_start and order_date < tomorrow_start
    ),
    'cache_hit_ratio', (
      select round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1)
      from pg_catalog.pg_statio_user_tables
    ),
    'oldest_pending_minutes', (
      select round(extract(epoch from (now() - min(created_at))) / 60)
      from public.sync_queue where status = 'pending'
    )
  ) into result;

  return result;
end;
$function$;

revoke execute on function public.get_db_health() from public, anon;
grant execute on function public.get_db_health() to authenticated;
