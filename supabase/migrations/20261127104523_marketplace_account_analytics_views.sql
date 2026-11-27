-- Account-aware read models. Existing view signatures remain available to
-- older clients; updated screens use these projections with explicit filters.
create function public.resolve_catalog_variant(p_merchant text,p_account uuid,p_platform text,p_identifiers text[])
returns uuid language sql stable security invoker set search_path='' as $$
  select case when count(distinct product_id)=1 then (array_agg(product_id))[1] else null end
  from public.product_channel_mappings where merchant_code=p_merchant and marketplace_account_id=p_account
    and platform=p_platform and match_status='linked'
    and (identifier_value=any(p_identifiers) or source_sku=any(p_identifiers) or source_barcode=any(p_identifiers))
$$;
revoke all on function public.resolve_catalog_variant(text,uuid,text,text[]) from public,anon;
grant execute on function public.resolve_catalog_variant(text,uuid,text,text[]) to authenticated,service_role;

CREATE OR REPLACE VIEW public.monthly_cashflow_by_account
WITH (security_invoker = true)
AS
SELECT
  marketplace_account_id,
  merchant_code,
  platform,
  date_trunc('month', coalesce(transaction_date, posted_date))::date AS month,
  round(sum(coalesce(credit, 0)), 2) AS cash_in,
  round(sum(coalesce(debit, 0)), 2) AS cash_out,
  round(sum(coalesce(credit, 0)) - sum(coalesce(debit, 0)), 2) AS net,
  count(*) AS tx_count
FROM public.account_transactions
WHERE coalesce(transaction_date, posted_date) IS NOT NULL
GROUP BY marketplace_account_id,merchant_code, platform,
  date_trunc('month', coalesce(transaction_date, posted_date))::date;


CREATE OR REPLACE VIEW public.inventory_health_by_account
WITH (security_invoker = true)
AS
WITH platform_anchor AS (
  SELECT
    merchant_code,marketplace_account_id,
    lower(btrim(platform)) AS platform,
    max(order_date) AS data_as_of
  FROM public.orders
  WHERE status NOT IN ('cancelled', 'returned')
    AND sku IS NOT NULL AND btrim(sku) <> ''
  GROUP BY merchant_code, marketplace_account_id, lower(btrim(platform))
),
velocity AS (
  SELECT
    o.merchant_code,o.marketplace_account_id,
    lower(btrim(o.platform)) AS platform,
    btrim(o.sku) AS normalized_sku,
    sum(o.quantity)::numeric
      / greatest(least(30::numeric, extract(day FROM a.data_as_of - min(o.order_date)) + 1), 1) AS daily_velocity,
    sum(o.quantity) AS sold_30d,
    max(o.order_date) AS last_sold_at,
    a.data_as_of
  FROM public.orders o
  JOIN platform_anchor a
    ON a.merchant_code = o.merchant_code AND a.marketplace_account_id=o.marketplace_account_id
   AND a.platform = lower(btrim(o.platform))
  WHERE o.order_date > a.data_as_of - interval '30 days'
    AND o.order_date <= a.data_as_of
    AND o.status NOT IN ('cancelled', 'returned')
    AND o.sku IS NOT NULL AND btrim(o.sku) <> ''
  GROUP BY o.merchant_code,o.marketplace_account_id, lower(btrim(o.platform)), btrim(o.sku), a.data_as_of
),
product_price AS (
  select i.id inventory_id,p.cost_price,coalesce(p.sale_price,p.msrp,p.target_net_price,0) selling_price
  from public.inventory i left join public.products p on p.merchant_code=i.merchant_code
    and p.id=public.resolve_catalog_variant(i.merchant_code,i.marketplace_account_id,i.platform,array[i.sku,i.partner_sku])
)
SELECT
  i.id,
  i.marketplace_account_id,
  i.merchant_code,
  i.platform,
  i.sku,
  i.product_name,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0) quantity,
  coalesce(nullif(i.cost_price, 0), p.cost_price, 0)::numeric(12,2) AS cost_price,
  i.low_stock_threshold,
  coalesce(p.selling_price, 0) AS selling_price,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric * coalesce(nullif(i.cost_price, 0), p.cost_price, 0) AS stock_value_cost,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric * coalesce(p.selling_price, 0) AS stock_value_retail,
  coalesce(v.daily_velocity, 0) AS daily_velocity,
  coalesce(v.sold_30d, 0) AS sold_30d,
  v.last_sold_at,
  CASE WHEN v.daily_velocity > 0 THEN round(greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric / v.daily_velocity, 0) END AS days_of_stock,
  CASE
    WHEN greatest(i.quantity-coalesce(i.reserved_quantity,0),0) = 0 THEN 'out_of_stock'
    WHEN greatest(i.quantity-coalesce(i.reserved_quantity,0),0) <= coalesce(i.low_stock_threshold, 10) THEN 'low_stock'
    WHEN v.daily_velocity > 0 AND greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric / v.daily_velocity < 7 THEN 'reorder_soon'
    WHEN v.last_sold_at IS NULL THEN 'no_sales_data'
    WHEN v.last_sold_at < v.data_as_of - interval '30 days' THEN 'slow_mover'
    ELSE 'healthy'
  END AS health_status,
  v.data_as_of,
  CASE WHEN v.data_as_of IS NOT NULL
    THEN greatest(0, current_date - v.data_as_of::date)
  END AS data_age_days
FROM public.inventory i
LEFT JOIN product_price p ON p.inventory_id=i.id
LEFT JOIN velocity v
  ON v.merchant_code = i.merchant_code AND v.marketplace_account_id=i.marketplace_account_id
 AND v.platform = lower(btrim(i.platform))
 AND v.normalized_sku = btrim(i.sku);


create view public.inventory_reorder_recommendations_by_account with (security_invoker=true) as
 SELECT id AS inventory_id,
    merchant_code,marketplace_account_id,
    platform,
    sku,
    product_name,
    quantity AS current_quantity,
    cost_price,
    daily_velocity,
    days_of_stock,
    data_as_of,
    data_age_days,
    GREATEST(0::numeric, ceil(daily_velocity * 30::numeric - quantity::numeric))::integer AS recommended_quantity,
    round(GREATEST(0::numeric, ceil(daily_velocity * 30::numeric - quantity::numeric)) * cost_price, 2) AS estimated_cost,
        CASE
            WHEN quantity = 0 THEN 'critical'::text
            WHEN days_of_stock <= 7::numeric THEN 'high'::text
            ELSE 'medium'::text
        END AS urgency
   FROM public.inventory_health_by_account
  WHERE data_age_days >= 0 AND data_age_days <= 2 AND daily_velocity > 0::numeric AND cost_price > 0::numeric AND (quantity = 0 OR days_of_stock <= 14::numeric) AND GREATEST(0::numeric, ceil(daily_velocity * 30::numeric - quantity::numeric)) > 0::numeric;

-- Tenant-safe fee, return, and net advertising analytics used by merchant
-- health scoring and the dashboard.
CREATE OR REPLACE VIEW public.platform_fee_profile_by_account
WITH (security_invoker = true)
AS
WITH principal AS (
  SELECT
    merchant_code,marketplace_account_id,
    platform,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemPrice'
        AND amount_description IN ('Principal', 'Tax', 'Shipping', 'ShippingTax')
    ) AS principal_gross,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description = 'Commission'
    ) AS commission,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description LIKE 'FBA%'
    ) AS fba_fee,
    sum(net_amount) FILTER (WHERE amount_type = 'ItemWithheldTax') AS withheld_vat,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description = 'RefundCommission'
    ) AS refund_commission,
    sum(net_amount) FILTER (WHERE amount_type = 'Promotion') AS promotions
  FROM public.account_transactions
  GROUP BY merchant_code, marketplace_account_id, platform
)
SELECT
  merchant_code,marketplace_account_id,
  platform,
  coalesce(principal_gross, 0) AS principal_gross,
  coalesce(commission, 0) AS commission,
  coalesce(fba_fee, 0) AS fba_fee,
  coalesce(withheld_vat, 0) AS withheld_vat,
  coalesce(refund_commission, 0) AS refund_commission,
  coalesce(promotions, 0) AS promotions,
  CASE WHEN coalesce(principal_gross, 0) > 0 THEN round(
    abs(
      coalesce(commission, 0) + coalesce(fba_fee, 0)
        + coalesce(withheld_vat, 0) + coalesce(refund_commission, 0)
        + coalesce(promotions, 0)
    ) / principal_gross,
    4
  ) END AS fee_rate
FROM principal;

CREATE OR REPLACE VIEW public.platform_return_profile_by_account
WITH (security_invoker = true)
AS
WITH gross AS (
  SELECT merchant_code, marketplace_account_id, platform, sum(total_amount) AS total_sold
  FROM public.orders
  GROUP BY merchant_code, marketplace_account_id, platform
),
ret AS (
  SELECT merchant_code, marketplace_account_id, platform, sum(return_amount) AS total_returned
  FROM public.returns
  GROUP BY merchant_code, marketplace_account_id, platform
)
SELECT
  coalesce(g.merchant_code, r.merchant_code) AS merchant_code,
  coalesce(g.marketplace_account_id,r.marketplace_account_id) marketplace_account_id,
  coalesce(g.platform, r.platform) AS platform,
  coalesce(g.total_sold, 0) AS total_sold,
  coalesce(r.total_returned, 0) AS total_returned,
  CASE WHEN coalesce(g.total_sold, 0) > 0
    THEN round(least(coalesce(r.total_returned, 0) / g.total_sold, 1), 4)
  END AS return_rate
FROM gross g
FULL JOIN ret r ON r.merchant_code = g.merchant_code AND r.marketplace_account_id=g.marketplace_account_id AND r.platform = g.platform;

CREATE OR REPLACE VIEW public.ad_net_summary_by_account
WITH (security_invoker = true)
AS
SELECT
  am.merchant_code,am.marketplace_account_id,
  am.platform,
  sum(am.spend) AS total_spend,
  sum(am.revenue) AS total_gross,
  round(sum(am.revenue) * (1 - coalesce(max(fp.fee_rate), 0) - coalesce(max(rp.return_rate), 0)), 2) AS total_net,
  round(sum(am.revenue) * coalesce(max(fp.fee_rate), 0), 2) AS total_fees,
  round(sum(am.revenue) * coalesce(max(rp.return_rate), 0), 2) AS total_returns,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.commission))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_commission,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.fba_fee))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_fba,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.withheld_vat))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_vat,
  CASE WHEN sum(am.spend) > 0 THEN round(sum(am.revenue) / sum(am.spend), 2) END AS gross_roas,
  CASE WHEN sum(am.spend) > 0 THEN round(
    sum(am.revenue) * (1 - coalesce(max(fp.fee_rate), 0) - coalesce(max(rp.return_rate), 0))
      / sum(am.spend),
    2
  ) END AS net_roas,
  max(fp.fee_rate) AS fee_rate,
  max(rp.return_rate) AS return_rate
FROM public.ad_metrics am
LEFT JOIN public.platform_fee_profile_by_account fp
  ON fp.merchant_code = am.merchant_code AND fp.marketplace_account_id=am.marketplace_account_id AND fp.platform = am.platform
LEFT JOIN public.platform_return_profile_by_account rp
  ON rp.merchant_code = am.merchant_code AND rp.marketplace_account_id=am.marketplace_account_id AND rp.platform = am.platform
WHERE am.spend > 0
GROUP BY am.merchant_code, am.marketplace_account_id, am.platform;


revoke all on public.monthly_cashflow_by_account from public,anon;
grant select on public.monthly_cashflow_by_account to authenticated,service_role;
revoke all on public.inventory_health_by_account from public,anon;
grant select on public.inventory_health_by_account to authenticated,service_role;
revoke all on public.inventory_reorder_recommendations_by_account from public,anon;
grant select on public.inventory_reorder_recommendations_by_account to authenticated,service_role;
revoke all on public.platform_fee_profile_by_account from public,anon;
grant select on public.platform_fee_profile_by_account to authenticated,service_role;
revoke all on public.platform_return_profile_by_account from public,anon;
grant select on public.platform_return_profile_by_account to authenticated,service_role;
revoke all on public.ad_net_summary_by_account from public,anon;
grant select on public.ad_net_summary_by_account to authenticated,service_role;
create or replace function public.revenue_forecast_by_account(p_merchant_code text,p_account_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_first_date date;
  v_observed_days integer := 0;
  v_active_days integer := 0;
  v_data_age_days integer;
  v_last_30_sales numeric := 0;
  v_prev_30_sales numeric := 0;
  v_avg_daily numeric := 0;
  v_stddev numeric := 0;
  v_cv numeric := 0;
  v_growth_pct numeric;
  v_bounded_growth numeric := 0;
  v_forecast_30 numeric := 0;
  v_uncertainty_pct numeric := 0.45;
  v_lower_30 numeric := 0;
  v_upper_30 numeric := 0;
  v_confidence text := 'low';
  v_caveat text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null
     and (not security.can_access_merchant(p_merchant_code) or not security.mfa_access_allowed()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date, min(order_date)::date
    into v_anchor_date, v_first_date
  from public.orders
  where merchant_code = p_merchant_code and marketplace_account_id=any(p_account_ids)
    and status not in ('cancelled', 'returned');

  if v_anchor_date is null then
    return jsonb_build_object(
      'last_30_sales', 0, 'prev_30_sales', 0, 'avg_daily', 0,
      'forecast_30', 0, 'forecast_60', 0, 'forecast_90', 0,
      'lower_30', 0, 'upper_30', 0, 'growth_rate_pct', null,
      'confidence', 'low', 'is_actionable', false, 'observed_days', 0,
      'active_days', 0, 'data_as_of', null, 'data_age_days', null,
      'method', 'bounded_recent_run_rate',
      'caveat', 'لا توجد طلبات كافية لبناء توقع.'
    );
  end if;

  v_data_age_days := greatest(0, current_date - v_anchor_date);
  v_observed_days := least(30, greatest(1, v_anchor_date - v_first_date + 1));

  with calendar as (
    select day::date
    from generate_series(v_anchor_date - (v_observed_days - 1), v_anchor_date, interval '1 day') day
  ), daily as (
    select c.day, coalesce(sum(o.total_amount), 0)::numeric as sales
    from calendar c
    left join public.orders o
      on o.merchant_code = p_merchant_code and o.marketplace_account_id=any(p_account_ids)
     and o.order_date::date = c.day
     and o.status not in ('cancelled', 'returned')
    group by c.day
  )
  select coalesce(sum(sales), 0), count(*) filter (where sales > 0)::integer,
         coalesce(avg(sales), 0), coalesce(stddev_pop(sales), 0)
    into v_last_30_sales, v_active_days, v_avg_daily, v_stddev
  from daily;

  select coalesce(sum(total_amount), 0)
    into v_prev_30_sales
  from public.orders
  where merchant_code = p_merchant_code and marketplace_account_id=any(p_account_ids)
    and status not in ('cancelled', 'returned')
    and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

  v_growth_pct := case when v_prev_30_sales > 0
    then round(((v_last_30_sales - v_prev_30_sales) / v_prev_30_sales) * 100, 1)
    else null end;
  v_bounded_growth := least(50, greatest(-30, coalesce(v_growth_pct, 0)));
  v_cv := case when v_avg_daily > 0 then v_stddev / v_avg_daily else 0 end;

  v_confidence := case
    when (v_anchor_date - v_first_date + 1) >= 60 and v_active_days >= 20 and v_data_age_days <= 2 then 'high'
    when (v_anchor_date - v_first_date + 1) >= 30 and v_active_days >= 10 and v_data_age_days <= 7 then 'medium'
    else 'low' end;

  v_uncertainty_pct := case v_confidence
    when 'high' then greatest(0.15, least(0.30, v_cv * 0.35))
    when 'medium' then greatest(0.25, least(0.40, v_cv * 0.45))
    else 0.45 end;
  v_forecast_30 := round(greatest(0, v_avg_daily * 30 * (1 + v_bounded_growth / 200)), 2);
  v_lower_30 := round(greatest(0, v_forecast_30 * (1 - v_uncertainty_pct)), 2);
  v_upper_30 := round(v_forecast_30 * (1 + v_uncertainty_pct), 2);
  v_caveat := case
    when v_data_age_days > 7 then 'البيانات متأخرة؛ حدّث مصدر الطلبات قبل الاعتماد على التوقع.'
    when v_observed_days < 30 then 'السجل أقصر من 30 يومًا؛ سيضيق النطاق مع تراكم البيانات.'
    when v_active_days < 10 then 'أيام البيع الفعلية قليلة؛ التوقع استرشادي فقط.'
    else 'النطاق يعكس تذبذب المبيعات وحداثة البيانات، ولا يمثل ضمانًا.' end;

  return jsonb_build_object(
    'last_30_sales', round(v_last_30_sales, 2),
    'prev_30_sales', round(v_prev_30_sales, 2),
    'avg_daily', round(v_avg_daily, 2),
    'forecast_30', v_forecast_30,
    'forecast_60', round(v_forecast_30 * 2, 2),
    'forecast_90', round(v_forecast_30 * 3, 2),
    'lower_30', v_lower_30,
    'upper_30', v_upper_30,
    'growth_rate_pct', v_growth_pct,
    'confidence', v_confidence,
    'is_actionable', v_confidence in ('high', 'medium') and v_forecast_30 > 0,
    'observed_days', v_observed_days,
    'active_days', v_active_days,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'method', 'bounded_recent_run_rate',
    'caveat', v_caveat
  );
end;
$$;

revoke all on function public.revenue_forecast_by_account(text,uuid[]) from public,anon;
grant execute on function public.revenue_forecast_by_account(text,uuid[]) to authenticated,service_role;
