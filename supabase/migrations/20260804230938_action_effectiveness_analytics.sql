create or replace function public.my_action_effectiveness(p_days integer default 90)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_days integer := greatest(30, least(coalesce(p_days, 90), 365));
  v_result jsonb;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  with scoped as (
    select
      status,
      priority,
      coalesce(nullif(category, ''), 'operations') as category,
      due_date,
      created_at,
      completion_recorded_at,
      completion_result
    from public.merchant_requests
    where merchant_code = v_merchant_code
      and request_kind = 'action'
  ),
  completed as (
    select *
    from scoped
    where status = 'done'
      and completion_recorded_at >= now() - make_interval(days => v_days)
  ),
  measured as (
    select *
    from completed
    where completion_result in ('achieved', 'partial', 'not_achieved')
  ),
  open_summary as (
    select
      count(*) filter (where status <> 'done')::integer as total,
      count(*) filter (where status = 'in_progress')::integer as in_progress,
      count(*) filter (where status <> 'done' and priority = 'urgent')::integer as urgent,
      count(*) filter (where status <> 'done' and due_date < current_date)::integer as overdue,
      count(*) filter (
        where status <> 'done'
          and due_date >= current_date
          and due_date <= current_date + 7
      )::integer as due_next_7_days
    from scoped
  ),
  completed_summary as (
    select
      count(*)::integer as total,
      count(*) filter (where completion_result = 'achieved')::integer as achieved,
      count(*) filter (where completion_result = 'partial')::integer as partial,
      count(*) filter (where completion_result = 'not_achieved')::integer as not_achieved,
      count(*) filter (
        where completion_result is null or completion_result = 'unknown'
      )::integer as unmeasured,
      round(avg(extract(epoch from (completion_recorded_at - created_at)) / 86400)::numeric, 1) as average_cycle_days
    from completed
  ),
  measured_summary as (
    select
      count(*)::integer as total,
      round(100 * count(*) filter (where completion_result = 'achieved') / nullif(count(*), 0)::numeric, 1) as achieved_rate_pct,
      round(100 * count(*) filter (where completion_result in ('achieved', 'partial')) / nullif(count(*), 0)::numeric, 1) as positive_rate_pct
    from measured
  ),
  category_rows as (
    select
      category,
      count(*)::integer as completed,
      count(*) filter (where completion_result = 'achieved')::integer as achieved,
      count(*) filter (where completion_result = 'partial')::integer as partial,
      count(*) filter (where completion_result = 'not_achieved')::integer as not_achieved,
      round(
        100 * count(*) filter (where completion_result = 'achieved')
        / nullif(count(*) filter (where completion_result in ('achieved', 'partial', 'not_achieved')), 0)::numeric,
        1
      ) as achieved_rate_pct
    from completed
    group by category
    order by count(*) desc, category
    limit 6
  ),
  category_summary as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'category', category,
        'completed', completed,
        'achieved', achieved,
        'partial', partial,
        'not_achieved', not_achieved,
        'achieved_rate_pct', achieved_rate_pct
      ) order by completed desc, category),
      '[]'::jsonb
    ) as rows
    from category_rows
  ),
  week_series as (
    select generate_series(
      date_trunc('week', current_date)::date - 49,
      date_trunc('week', current_date)::date,
      interval '7 days'
    )::date as week_start
  ),
  week_rows as (
    select
      week_series.week_start,
      count(completed.completion_recorded_at)::integer as completed,
      count(completed.completion_recorded_at) filter (where completed.completion_result = 'achieved')::integer as achieved,
      count(completed.completion_recorded_at) filter (where completed.completion_result = 'partial')::integer as partial,
      count(completed.completion_recorded_at) filter (where completed.completion_result = 'not_achieved')::integer as not_achieved
    from week_series
    left join completed
      on completed.completion_recorded_at >= week_series.week_start
     and completed.completion_recorded_at < week_series.week_start + 7
    group by week_series.week_start
    order by week_series.week_start
  ),
  week_summary as (
    select jsonb_agg(jsonb_build_object(
      'week_start', week_start,
      'completed', completed,
      'achieved', achieved,
      'partial', partial,
      'not_achieved', not_achieved
    ) order by week_start) as rows
    from week_rows
  )
  select jsonb_build_object(
    'period_days', v_days,
    'generated_at', now(),
    'open', jsonb_build_object(
      'total', open_summary.total,
      'in_progress', open_summary.in_progress,
      'urgent', open_summary.urgent,
      'overdue', open_summary.overdue,
      'due_next_7_days', open_summary.due_next_7_days
    ),
    'completed', jsonb_build_object(
      'total', completed_summary.total,
      'achieved', completed_summary.achieved,
      'partial', completed_summary.partial,
      'not_achieved', completed_summary.not_achieved,
      'unmeasured', completed_summary.unmeasured,
      'measured', measured_summary.total,
      'achieved_rate_pct', measured_summary.achieved_rate_pct,
      'positive_rate_pct', measured_summary.positive_rate_pct,
      'average_cycle_days', completed_summary.average_cycle_days
    ),
    'categories', category_summary.rows,
    'weeks', week_summary.rows
  ) into v_result
  from open_summary, completed_summary, measured_summary, category_summary, week_summary;

  return v_result;
end;
$$;

revoke all on function public.my_action_effectiveness(integer) from public, anon;
grant execute on function public.my_action_effectiveness(integer) to authenticated, service_role;

comment on function public.my_action_effectiveness(integer) is
  'Returns tenant-scoped action execution and outcome analytics for the authenticated merchant.';
