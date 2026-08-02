-- Harden privileged RPCs for the new platform-staff role. Authorization is
-- enforced inside each SECURITY DEFINER function before privileged queries.

CREATE OR REPLACE FUNCTION public.delete_upload_cascade(p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
  v_role text;
BEGIN
  SELECT merchant_code INTO v_merchant_code
  FROM public.platform_file_uploads
  WHERE id = p_upload_id;

  IF v_merchant_code IS NULL THEN
    RETURN jsonb_build_object('error', 'upload not found');
  END IF;

  SELECT role INTO v_role FROM public.merchants WHERE id = (SELECT auth.uid());
  IF NOT security.can_access_merchant(v_merchant_code)
     OR (v_role = 'staff' AND NOT security.has_platform_permission('delete_files'))
     OR (v_role <> 'staff' AND NOT security.has_merchant_permission(v_merchant_code, 'integrations')) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN public.delete_upload_cascade_internal(p_upload_id);
END
$$;

CREATE OR REPLACE FUNCTION public.delete_upload_with_data(p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
  v_role text;
BEGIN
  SELECT merchant_code INTO v_merchant_code
  FROM public.platform_file_uploads
  WHERE id = p_upload_id;

  IF v_merchant_code IS NULL THEN
    RETURN jsonb_build_object('error', 'upload not found');
  END IF;

  SELECT role INTO v_role FROM public.merchants WHERE id = (SELECT auth.uid());
  IF NOT security.can_access_merchant(v_merchant_code)
     OR (v_role = 'staff' AND NOT security.has_platform_permission('delete_files'))
     OR (v_role <> 'staff' AND NOT security.has_merchant_permission(v_merchant_code, 'integrations')) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN public.delete_upload_with_data_internal(p_upload_id);
END
$$;

CREATE OR REPLACE FUNCTION public.merchant_payouts(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT security.has_merchant_permission(p_merchant_code, 'statement')
     AND NOT security.has_platform_permission('view_finance') THEN
    RETURN jsonb_build_object('scheduled', '[]'::jsonb, 'pending_sales', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'scheduled', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', platform, 'payout_date', payout_date,
        'amount', amount, 'status', status, 'note', note
      ) ORDER BY payout_date)
      FROM public.merchant_payout_schedule
      WHERE merchant_code = p_merchant_code AND payout_date >= CURRENT_DATE - 3
    ), '[]'::jsonb),
    'pending_sales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', platform, 'sales', s, 'last_data_date', md
      ) ORDER BY platform)
      FROM (
        SELECT pd.platform, round(sum(pd.total_sales))::numeric AS s, max(pd.data_date) AS md
        FROM public.performance_data pd
        JOIN (
          SELECT platform, max(data_date) mx
          FROM public.performance_data
          WHERE merchant_code = p_merchant_code
          GROUP BY platform
        ) latest ON latest.platform = pd.platform
        WHERE pd.merchant_code = p_merchant_code AND pd.data_date > latest.mx - 30
        GROUP BY pd.platform
      ) q
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  amz_orders int; rets_snap int; rets_amz int; prices int; perf int; alerts int;
BEGIN
  SELECT role INTO v_role FROM public.merchants WHERE id = (SELECT auth.uid());
  IF (v_role = 'staff' AND NOT security.has_platform_permission('upload_files'))
     OR (v_role <> 'staff' AND NOT public.is_staff()
         AND p_merchant_code IS DISTINCT FROM public.current_merchant_code()) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  amz_orders := public.derive_orders_from_account_tx(p_merchant_code);
  rets_snap  := public.derive_returns_from_snapshots(p_merchant_code);
  rets_amz   := public.derive_returns_from_account_tx(p_merchant_code);
  prices     := public.derive_product_platform_prices(p_merchant_code);
  perf       := public.rebuild_performance_data(p_merchant_code);
  alerts     := public.generate_proactive_alerts(p_merchant_code);
  RETURN jsonb_build_object(
    'amazon_orders_derived', amz_orders,
    'returns_derived', rets_snap + rets_amz,
    'platform_prices_derived', prices,
    'performance_rows', perf,
    'alerts_generated', alerts
  );
END
$$;

CREATE OR REPLACE FUNCTION public.team_dashboard_kpis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT security.has_any_platform_permission(ARRAY['view_merchants','tasks','crm']) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'total_merchants', (SELECT count(*) FROM public.merchants WHERE role = 'merchant'),
    'active_merchants_30d', (SELECT count(DISTINCT merchant_code) FROM public.platform_file_uploads WHERE uploaded_at >= now() - interval '30 days'),
    'pending_tasks', (SELECT count(*) FROM public.merchant_requests WHERE status = 'pending'),
    'overdue_tasks', (SELECT count(*) FROM public.merchant_requests WHERE due_date IS NOT NULL AND due_date < now() AND status NOT IN ('done','rejected')),
    'avg_health_score', (SELECT round(avg((public.merchant_health_score(merchant_code)->>'score')::numeric), 1) FROM public.merchants WHERE role = 'merchant' LIMIT 50),
    'nps_avg', (SELECT round(avg(score)::numeric, 1) FROM public.nps_responses WHERE responded_at >= now() - interval '90 days'),
    'nps_promoters', (SELECT count(*) FROM public.nps_responses WHERE score >= 9 AND responded_at >= now() - interval '90 days'),
    'nps_detractors', (SELECT count(*) FROM public.nps_responses WHERE score <= 6 AND responded_at >= now() - interval '90 days'),
    'uploads_30d', (SELECT count(*) FROM public.platform_file_uploads WHERE uploaded_at >= now() - interval '30 days'),
    'gmv_30d', (SELECT coalesce(round(sum(total_sales)), 0) FROM public.performance_data WHERE data_date >= CURRENT_DATE - 30)
  );
END
$$;

REVOKE ALL ON FUNCTION public.delete_upload_cascade(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_upload_with_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merchant_payouts(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebuild_all_derived_data(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_dashboard_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_upload_with_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merchant_payouts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_all_derived_data(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_dashboard_kpis() TO authenticated, service_role;
