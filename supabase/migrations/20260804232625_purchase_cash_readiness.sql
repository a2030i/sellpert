create index if not exists account_tx_merchant_posted_date_idx
  on public.account_transactions (merchant_code, posted_date)
  where posted_date is not null;

create or replace function public.my_purchase_cash_readiness(p_horizon_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_horizon_days integer := greatest(7, least(coalesce(p_horizon_days, 30), 60));
  v_result jsonb;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  with latest_bank as (
    select
      balance,
      transaction_date,
      currency,
      account_hint,
      greatest(0, current_date - transaction_date) as age_days
    from public.bank_transactions
    where merchant_code = v_merchant_code
      and balance is not null
    order by transaction_date desc, created_at desc
    limit 1
  ),
  api_payout_rows as (
    select
      lower(trim(platform)) as platform,
      posted_date::date as payout_date,
      round(sum(abs(coalesce(nullif(net_amount, 0), credit - debit))), 2) as amount,
      'api_confirmed'::text as source
    from public.account_transactions
    where merchant_code = v_merchant_code
      and posted_date::date between current_date and current_date + v_horizon_days
      and regexp_replace(lower(coalesce(transaction_type, '')), '[^a-z0-9]', '', 'g')
        in ('paymentorder', 'wiretransfer', 'payout', 'disbursement')
      and abs(coalesce(nullif(net_amount, 0), credit - debit)) > 0
    group by lower(trim(platform)), posted_date::date
  ),
  manual_payout_rows as (
    select
      lower(trim(schedule.platform)) as platform,
      schedule.payout_date,
      round(sum(schedule.amount), 2) as amount,
      'manual_confirmed'::text as source
    from public.merchant_payout_schedule schedule
    where schedule.merchant_code = v_merchant_code
      and schedule.status = 'expected'
      and schedule.amount > 0
      and schedule.payout_date between current_date and current_date + v_horizon_days
      and not exists (
        select 1 from api_payout_rows api
        where api.platform = lower(trim(schedule.platform))
          and api.payout_date = schedule.payout_date
      )
    group by lower(trim(schedule.platform)), schedule.payout_date
  ),
  confirmed_payout_rows as (
    select * from api_payout_rows
    union all
    select * from manual_payout_rows
  ),
  payout_summary as (
    select
      coalesce(sum(amount), 0)::numeric as total,
      count(*)::integer as row_count,
      count(*) filter (where source = 'api_confirmed')::integer as api_count,
      count(*) filter (where source = 'manual_confirmed')::integer as manual_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'platform', platform,
        'payout_date', payout_date,
        'amount', amount,
        'source', source
      ) order by payout_date, platform), '[]'::jsonb) as rows
    from confirmed_payout_rows
  ),
  reorder_rows as (
    select *
    from public.inventory_reorder_recommendations
    where merchant_code = v_merchant_code
  ),
  reorder_summary as (
    select
      count(*)::integer as item_count,
      coalesce(sum(recommended_quantity), 0)::integer as unit_count,
      coalesce(round(sum(estimated_cost), 2), 0)::numeric as estimated_cost,
      max(data_as_of)::date as data_as_of,
      max(data_age_days)::integer as age_days
    from reorder_rows
  ),
  reorder_top_rows as (
    select
      inventory_id,
      platform,
      sku,
      product_name,
      current_quantity,
      recommended_quantity,
      estimated_cost,
      days_of_stock,
      urgency
    from reorder_rows
    order by
      case urgency when 'critical' then 0 when 'high' then 1 else 2 end,
      estimated_cost desc,
      sku
    limit 8
  ),
  reorder_top as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'inventory_id', inventory_id,
      'platform', platform,
      'sku', sku,
      'product_name', product_name,
      'current_quantity', current_quantity,
      'recommended_quantity', recommended_quantity,
      'estimated_cost', estimated_cost,
      'days_of_stock', days_of_stock,
      'urgency', urgency
    ) order by case urgency when 'critical' then 0 when 'high' then 1 else 2 end, estimated_cost desc), '[]'::jsonb) as rows
    from reorder_top_rows
  ),
  inventory_summary as (
    select
      count(*)::integer as item_count,
      count(*) filter (where daily_velocity > 0)::integer as demand_covered_count,
      count(*) filter (where daily_velocity > 0 and cost_price <= 0)::integer as missing_cost_count,
      count(*) filter (where data_age_days > 2)::integer as stale_count,
      max(data_age_days)::integer as oldest_age_days
    from public.inventory_health
    where merchant_code = v_merchant_code
  ),
  latest_platform_dates as (
    select platform, max(data_date) as max_date
    from public.performance_data
    where merchant_code = v_merchant_code
    group by platform
  ),
  pending_sales_rows as (
    select
      performance.platform,
      round(sum(performance.total_sales), 2)::numeric as gross_sales,
      latest.max_date as data_as_of
    from public.performance_data performance
    join latest_platform_dates latest on latest.platform = performance.platform
    where performance.merchant_code = v_merchant_code
      and performance.data_date > latest.max_date - 30
      and performance.data_date <= latest.max_date
    group by performance.platform, latest.max_date
    having round(sum(performance.total_sales), 2) > 0
  ),
  pending_sales_summary as (
    select
      coalesce(sum(gross_sales), 0)::numeric as total,
      max(data_as_of)::date as data_as_of,
      coalesce(jsonb_agg(jsonb_build_object(
        'platform', platform,
        'gross_sales', gross_sales,
        'data_as_of', data_as_of
      ) order by platform), '[]'::jsonb) as rows
    from pending_sales_rows
  ),
  facts as (
    select
      bank.balance as bank_balance,
      bank.transaction_date as bank_balance_date,
      bank.age_days as bank_age_days,
      bank.currency,
      bank.account_hint,
      payout.total as confirmed_payouts,
      payout.row_count as payout_count,
      payout.api_count as api_payout_count,
      payout.manual_count as manual_payout_count,
      payout.rows as payouts,
      reorder.item_count as reorder_item_count,
      reorder.unit_count as reorder_unit_count,
      reorder.estimated_cost as purchase_cost,
      reorder.data_as_of as inventory_data_as_of,
      reorder.age_days as reorder_age_days,
      inventory.item_count as inventory_item_count,
      inventory.demand_covered_count,
      inventory.missing_cost_count,
      inventory.stale_count,
      inventory.oldest_age_days,
      pending.total as pending_gross_sales,
      pending.data_as_of as pending_sales_data_as_of,
      pending.rows as pending_sales,
      top_rows.rows as top_reorder_items
    from payout_summary payout
    cross join reorder_summary reorder
    cross join inventory_summary inventory
    cross join pending_sales_summary pending
    cross join reorder_top top_rows
    left join latest_bank bank on true
  ),
  decision as (
    select facts.*,
      case
        when inventory_item_count > 0 and stale_count > 0 then 'inventory_stale'
        when demand_covered_count > 0 and missing_cost_count > 0 then 'cost_data_incomplete'
        when reorder_item_count = 0 then 'no_purchase_needed'
        when bank_balance is null then 'bank_balance_missing'
        when bank_age_days > 7 then 'bank_balance_stale'
        when bank_balance + confirmed_payouts >= purchase_cost then 'ready'
        else 'shortfall'
      end as status,
      case
        when reorder_item_count = 0 and stale_count = 0 and missing_cost_count = 0 then 'high'
        when bank_balance is null or bank_age_days > 7 or stale_count > 0 or missing_cost_count > 0 then 'low'
        when bank_age_days <= 3 and manual_payout_count = 0 then 'high'
        else 'medium'
      end as confidence
    from facts
  )
  select jsonb_build_object(
    'horizon_days', v_horizon_days,
    'generated_at', now(),
    'status', status,
    'confidence', confidence,
    'bank', jsonb_build_object(
      'balance', bank_balance,
      'balance_date', bank_balance_date,
      'age_days', bank_age_days,
      'is_fresh', coalesce(bank_age_days <= 7, false),
      'currency', coalesce(currency, 'SAR'),
      'account_hint', account_hint
    ),
    'payouts', jsonb_build_object(
      'confirmed_total', confirmed_payouts,
      'count', payout_count,
      'api_count', api_payout_count,
      'manual_count', manual_payout_count,
      'rows', payouts
    ),
    'purchase_plan', jsonb_build_object(
      'item_count', reorder_item_count,
      'unit_count', reorder_unit_count,
      'estimated_cost', purchase_cost,
      'data_as_of', inventory_data_as_of,
      'age_days', reorder_age_days,
      'top_items', top_reorder_items
    ),
    'readiness', jsonb_build_object(
      'available_before_purchase', case when bank_balance is not null and bank_age_days <= 7 then bank_balance + confirmed_payouts end,
      'cash_after_purchase', case when bank_balance is not null and bank_age_days <= 7 then bank_balance + confirmed_payouts - purchase_cost end,
      'funding_gap', case when bank_balance is not null and bank_age_days <= 7 then greatest(purchase_cost - bank_balance - confirmed_payouts, 0) end,
      'coverage_pct', case when purchase_cost > 0 and bank_balance is not null and bank_age_days <= 7 then round(100 * greatest(bank_balance + confirmed_payouts, 0) / purchase_cost, 1) end
    ),
    'data_quality', jsonb_build_object(
      'inventory_item_count', inventory_item_count,
      'demand_covered_count', demand_covered_count,
      'missing_cost_count', missing_cost_count,
      'stale_inventory_count', stale_count,
      'oldest_inventory_age_days', oldest_age_days
    ),
    'unconfirmed_sales', jsonb_build_object(
      'gross_total', pending_gross_sales,
      'data_as_of', pending_sales_data_as_of,
      'included_in_available_cash', false,
      'rows', pending_sales
    )
  ) into v_result
  from decision;

  return v_result;
end;
$$;

revoke all on function public.my_purchase_cash_readiness(integer) from public, anon;
grant execute on function public.my_purchase_cash_readiness(integer) to authenticated;

comment on function public.my_purchase_cash_readiness(integer) is
  'Tenant-scoped purchase funding readiness using fresh bank balance, confirmed payouts, and evidence-backed reorder recommendations. Gross pending sales are disclosed but excluded from available cash.';

-- The legacy forecast interpreted marketplace ledger debits as cash outflows,
-- including payout orders on providers that use debit-side settlement entries.
-- It was also absent from the rebuildable migration history, so remove the
-- drifted object instead of preserving a misleading financial endpoint.
drop function if exists public.cash_flow_forecast(text);
