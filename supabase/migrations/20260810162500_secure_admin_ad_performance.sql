CREATE OR REPLACE FUNCTION security.admin_ad_performance(
  p_merchant_code text,
  p_upload_id uuid DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_group_by text DEFAULT 'campaign',
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT security.has_platform_permission('manage_ads') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE merchant_code = p_merchant_code AND role = 'merchant') THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  IF p_group_by NOT IN ('campaign', 'sku', 'query') THEN
    RAISE EXCEPTION 'invalid advertising group' USING errcode = '22023';
  END IF;

  WITH filtered AS (
    SELECT am.* FROM public.ad_metrics am
    WHERE am.merchant_code = p_merchant_code
      AND (p_upload_id IS NULL OR am.upload_id = p_upload_id)
      AND (p_platform IS NULL OR am.platform = p_platform)
      AND (
        NULLIF(btrim(p_search), '') IS NULL
        OR coalesce(am.campaign_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.sku, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.search_query, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ), totals AS (
    SELECT count(*) rows, coalesce(sum(spend), 0) spend, coalesce(sum(revenue), 0) revenue,
      coalesce(sum(impressions), 0) impressions, coalesce(sum(clicks), 0) clicks,
      coalesce(sum(orders), 0) orders FROM filtered
  ), grouped AS (
    SELECT CASE p_group_by
        WHEN 'campaign' THEN coalesce(nullif(campaign_name, ''), nullif(ad_group_name, ''), 'بلا اسم')
        WHEN 'sku' THEN coalesce(nullif(sku, ''), '—')
        ELSE coalesce(nullif(search_query, ''), '—') END key,
      platform, sum(impressions) impressions, sum(clicks) clicks, sum(orders) orders,
      sum(spend) spend, sum(revenue) revenue, count(*) rows
    FROM filtered GROUP BY 1, platform ORDER BY sum(spend) DESC LIMIT 200
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'groups', coalesce((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(platform ORDER BY platform) FROM (SELECT DISTINCT platform FROM filtered) p), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION security.admin_ad_performance(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.admin_ad_performance(text, uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_ad_performance(
  p_merchant_code text,
  p_upload_id uuid DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_group_by text DEFAULT 'campaign',
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$ SELECT security.admin_ad_performance(p_merchant_code, p_upload_id, p_platform, p_group_by, p_search) $$;

REVOKE ALL ON FUNCTION public.admin_ad_performance(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ad_performance(text, uuid, text, text, text) TO authenticated, service_role;
