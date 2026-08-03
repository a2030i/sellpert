-- Ad-only performance rows must not appear to merchants as zero-value sales
-- awaiting payout. Preserve halala precision for legitimate pending sales.
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
        SELECT pd.platform, round(sum(pd.total_sales), 2)::numeric AS s, max(pd.data_date) AS md
        FROM public.performance_data pd
        JOIN (
          SELECT platform, max(data_date) mx
          FROM public.performance_data
          WHERE merchant_code = p_merchant_code
          GROUP BY platform
        ) latest ON latest.platform = pd.platform
        WHERE pd.merchant_code = p_merchant_code AND pd.data_date > latest.mx - 30
        GROUP BY pd.platform
        HAVING round(sum(pd.total_sales), 2) > 0
      ) q
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.merchant_payouts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_payouts(text) TO authenticated, service_role;
