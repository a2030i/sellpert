-- Keep tenant/MFA/permission semantics; evaluate actor-only identity once per
-- statement instead of re-reading it for every product and supporting fact.
DO $$
DECLARE t text; policy_row record; normalized text;
  access_predicate constant text := '((SELECT security.can_access_all_merchants()) OR merchant_code = ANY ((SELECT security.current_accessible_merchant_codes())::text[]))';
BEGIN
  FOREACH t IN ARRAY ARRAY['products','product_platform_prices','product_platform_listings','inventory','platform_file_uploads','product_channel_mappings'] LOOP
    SELECT pol.*,pg_get_expr(pol.polqual,pol.polrelid) q,pg_get_expr(pol.polwithcheck,pol.polrelid) c INTO STRICT policy_row
      FROM pg_policy pol WHERE pol.polrelid=format('public.%I',t)::regclass AND pol.polname='tenant_boundary';
    IF policy_row.polpermissive OR policy_row.polcmd<>'*' OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid] THEN
      RAISE EXCEPTION 'Unreviewed tenant boundary metadata: %',t;
    END IF;
    FOREACH normalized IN ARRAY ARRAY[policy_row.q,policy_row.c] LOOP
      normalized:=regexp_replace(replace(normalized,t||'.',''),'\s','','g');
      IF normalized IS NULL OR normalized NOT IN ('security.can_access_merchant(merchant_code)','(SELECTsecurity.can_access_merchant(merchant_code)AScan_access_merchant)') THEN
        RAISE EXCEPTION 'Unreviewed tenant boundary predicate: %',t;
      END IF;
    END LOOP;
    EXECUTE format('ALTER POLICY tenant_boundary ON public.%I USING (%s) WITH CHECK (%s)',t,access_predicate,access_predicate);
    IF t IN ('products','product_platform_prices','product_platform_listings','inventory') THEN
      SELECT pol.*,pg_get_expr(pol.polqual,pol.polrelid) q INTO STRICT policy_row FROM pg_policy pol
        WHERE pol.polrelid=format('public.%I',t)::regclass AND pol.polname='identity_scoped_select';
      IF NOT policy_row.polpermissive OR policy_row.polcmd<>'r' OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid]
        OR policy_row.q<>'security.can_access_merchant(merchant_code)' THEN RAISE EXCEPTION 'Unreviewed identity select: %',t; END IF;
      EXECUTE format('ALTER POLICY identity_scoped_select ON public.%I USING (%s)',t,access_predicate);
    END IF;
  END LOOP;
  SELECT pol.*,pg_get_expr(pol.polqual,pol.polrelid) q INTO STRICT policy_row FROM pg_policy pol
    WHERE pol.polrelid='public.product_channel_mappings'::regclass AND pol.polname='product_channel_mappings_tenant_select';
  normalized:=regexp_replace(replace(policy_row.q,'product_channel_mappings.',''),'\s','','g');
  IF NOT policy_row.polpermissive OR policy_row.polcmd<>'r' OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid]
    OR normalized<>'((SELECTsecurity.can_access_merchant(merchant_code)AScan_access_merchant)AND(SELECTsecurity.has_merchant_permission(merchant_code,''products''::text)AShas_merchant_permission))' THEN
    RAISE EXCEPTION 'Unreviewed product mapping permission predicate';
  END IF;
  -- has_merchant_permission(code,'products') = can_access_merchant(code) AND
  -- (has_platform_permission('products') OR current_has_merchant_permission('products')).
  EXECUTE format('ALTER POLICY product_channel_mappings_tenant_select ON public.product_channel_mappings USING (%s AND ((SELECT security.has_platform_permission(''products'')) OR (SELECT security.current_has_merchant_permission(''products''))))',access_predicate);
END $$;

-- Safe fields only; no provider payload or credential-bearing columns.
CREATE FUNCTION public.product_rows_by_account(
  p_merchant_code text, p_account_ids uuid[], p_include_unassigned boolean,
  p_limit integer, p_offset integer
)
RETURNS TABLE(
  id uuid,
  merchant_code text,
  name text,
  sku text,
  barcode text,
  category text,
  description text,
  image_url text,
  cost_price numeric,
  target_net_price numeric,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  psku_code text,
  noon_sku_child text,
  asin text,
  external_id text,
  model_code text,
  brand text,
  msrp numeric,
  sale_price numeric,
  sale_start_date date,
  sale_end_date date,
  external_url text,
  color text,
  size text,
  images jsonb,
  noon_price_min numeric,
  noon_price_max numeric,
  seller_price_min numeric,
  seller_price_max numeric,
  warranty text,
  commission_rate numeric,
  buybox_price numeric,
  vat_rate numeric,
  gender text,
  supplier_sku text,
  upload_id uuid,
  platform_source text,
  last_synced_at timestamp with time zone
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
  WITH memberships AS MATERIALIZED (
    SELECT m.product_id,bool_or(m.marketplace_account_id=ANY(p_account_ids)) selected
    FROM public.product_channel_mappings m
    WHERE m.merchant_code=p_merchant_code AND m.product_id IS NOT NULL
    GROUP BY m.product_id
  )
  SELECT p.id,p.merchant_code,p.name,p.sku,p.barcode,p.category,p.description,p.image_url,p.cost_price,p.target_net_price,p.status,p.created_at,p.updated_at,p.psku_code,p.noon_sku_child,p.asin,p.external_id,p.model_code,p.brand,p.msrp,p.sale_price,p.sale_start_date,p.sale_end_date,p.external_url,p.color,p.size,p.images,p.noon_price_min,p.noon_price_max,p.seller_price_min,p.seller_price_max,p.warranty,p.commission_rate,p.buybox_price,p.vat_rate,p.gender,p.supplier_sku,p.upload_id,p.platform_source,p.last_synced_at
  FROM public.products p LEFT JOIN memberships m ON m.product_id=p.id
  WHERE p.merchant_code=p_merchant_code
    AND (m.selected OR (p_include_unassigned AND m.product_id IS NULL))
    AND (SELECT security.mfa_access_allowed())
    AND (SELECT security.has_merchant_permission(p_merchant_code,'products'))
  ORDER BY p.created_at DESC,p.id
  LIMIT least(greatest(p_limit,1),1000) OFFSET greatest(p_offset,0)
$$;
REVOKE ALL ON FUNCTION public.product_rows_by_account(text,uuid[],boolean,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_rows_by_account(text,uuid[],boolean,integer,integer) TO authenticated,service_role;
