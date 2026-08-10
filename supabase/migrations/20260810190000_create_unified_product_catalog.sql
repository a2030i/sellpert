-- A tenant-isolated canonical product layer. Marketplace payloads remain unchanged.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'active'
    CHECK (catalog_status IN ('active', 'inactive'));

CREATE UNIQUE INDEX IF NOT EXISTS products_merchant_id_unique
  ON public.products (merchant_code, id);

CREATE TABLE IF NOT EXISTS public.product_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL REFERENCES public.merchants(merchant_code) ON DELETE CASCADE,
  product_id uuid,
  platform text NOT NULL CHECK (platform IN ('noon','amazon','trendyol','salla','zid','shopify','other')),
  identifier_type text NOT NULL CHECK (identifier_type IN ('partner_sku','seller_sku','sku','asin','barcode','product_id','variant_id','stock_code','other')),
  identifier_value text NOT NULL CHECK (btrim(identifier_value) <> ''),
  source_name text,
  source_sku text,
  source_barcode text,
  match_status text NOT NULL DEFAULT 'unknown' CHECK (match_status IN ('linked','review','unknown')),
  match_method text CHECK (match_method IS NULL OR match_method IN ('platform_id','internal_sku','barcode','seller_sku','name_suggestion','manual')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_by uuid DEFAULT auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_channel_mappings_product_tenant_fkey
    FOREIGN KEY (merchant_code, product_id) REFERENCES public.products(merchant_code, id) ON DELETE CASCADE,
  CONSTRAINT product_channel_mappings_link_state CHECK (
    (match_status = 'linked' AND product_id IS NOT NULL) OR match_status <> 'linked'
  ),
  UNIQUE (merchant_code, platform, identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS product_channel_mappings_merchant_status_idx
  ON public.product_channel_mappings (merchant_code, match_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS product_channel_mappings_product_idx
  ON public.product_channel_mappings (merchant_code, product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_channel_mappings_lookup_idx
  ON public.product_channel_mappings (merchant_code, platform, identifier_value);

ALTER TABLE public.product_channel_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_channel_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_channel_mappings_tenant_select ON public.product_channel_mappings;
CREATE POLICY product_channel_mappings_tenant_select ON public.product_channel_mappings
  FOR SELECT TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)) AND (SELECT security.has_merchant_permission(merchant_code, 'products')));

DROP POLICY IF EXISTS product_channel_mappings_tenant_insert ON public.product_channel_mappings;
CREATE POLICY product_channel_mappings_tenant_insert ON public.product_channel_mappings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)) AND (SELECT security.has_merchant_permission(merchant_code, 'products')));

DROP POLICY IF EXISTS product_channel_mappings_tenant_update ON public.product_channel_mappings;
CREATE POLICY product_channel_mappings_tenant_update ON public.product_channel_mappings
  FOR UPDATE TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)) AND (SELECT security.has_merchant_permission(merchant_code, 'products')))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)) AND (SELECT security.has_merchant_permission(merchant_code, 'products')));

DROP POLICY IF EXISTS product_channel_mappings_tenant_delete ON public.product_channel_mappings;
CREATE POLICY product_channel_mappings_tenant_delete ON public.product_channel_mappings
  FOR DELETE TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)) AND (SELECT security.has_merchant_permission(merchant_code, 'products')));

REVOKE ALL ON public.product_channel_mappings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_channel_mappings TO authenticated, service_role;

DROP TRIGGER IF EXISTS security_audit_mutation ON public.product_channel_mappings;
CREATE TRIGGER security_audit_mutation
  AFTER INSERT OR UPDATE OR DELETE ON public.product_channel_mappings
  FOR EACH ROW EXECUTE FUNCTION security.write_audit_log();

-- Existing normalized products become the initial catalog. This only adds links.
INSERT INTO public.product_channel_mappings (
  merchant_code, product_id, platform, identifier_type, identifier_value,
  source_name, source_sku, source_barcode, match_status, match_method, confidence
)
SELECT p.merchant_code, p.id,
  CASE WHEN p.platform_source IN ('noon','amazon','trendyol','salla','zid','shopify') THEN p.platform_source ELSE 'other' END,
  CASE
    WHEN p.platform_source = 'amazon' AND nullif(btrim(p.asin), '') IS NOT NULL THEN 'asin'
    WHEN nullif(btrim(p.barcode), '') IS NOT NULL THEN 'barcode'
    ELSE 'sku'
  END,
  coalesce(nullif(btrim(CASE WHEN p.platform_source = 'amazon' THEN p.asin END), ''), nullif(btrim(p.barcode), ''), nullif(btrim(p.sku), '')),
  p.name, p.sku, p.barcode, 'linked',
  CASE WHEN nullif(btrim(p.barcode), '') IS NOT NULL THEN 'barcode' ELSE 'internal_sku' END, 1
FROM public.products p
WHERE coalesce(nullif(btrim(CASE WHEN p.platform_source = 'amazon' THEN p.asin END), ''), nullif(btrim(p.barcode), ''), nullif(btrim(p.sku), '')) IS NOT NULL
ON CONFLICT (merchant_code, platform, identifier_type, identifier_value) DO NOTHING;

-- Orders without a deterministic SKU/barcode match are surfaced for review.
INSERT INTO public.product_channel_mappings (
  merchant_code, platform, identifier_type, identifier_value,
  source_name, source_sku, match_status
)
SELECT DISTINCT ON (o.merchant_code, o.platform, coalesce(nullif(btrim(o.partner_sku), ''), nullif(btrim(o.sku), ''), nullif(btrim(o.noon_sku), '')))
  o.merchant_code, o.platform,
  CASE WHEN nullif(btrim(o.partner_sku), '') IS NOT NULL THEN 'partner_sku' ELSE 'sku' END,
  coalesce(nullif(btrim(o.partner_sku), ''), nullif(btrim(o.sku), ''), nullif(btrim(o.noon_sku), '')),
  o.product_name, coalesce(o.partner_sku, o.sku, o.noon_sku), 'unknown'
FROM public.orders o
WHERE coalesce(nullif(btrim(o.partner_sku), ''), nullif(btrim(o.sku), ''), nullif(btrim(o.noon_sku), '')) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.merchant_code = o.merchant_code
      AND (p.sku = coalesce(nullif(btrim(o.partner_sku), ''), nullif(btrim(o.sku), ''), nullif(btrim(o.noon_sku), ''))
        OR p.barcode = coalesce(nullif(btrim(o.partner_sku), ''), nullif(btrim(o.sku), ''), nullif(btrim(o.noon_sku), '')))
  )
ON CONFLICT (merchant_code, platform, identifier_type, identifier_value) DO NOTHING;

CREATE OR REPLACE FUNCTION public.unified_product_catalog(
  p_merchant_code text,
  p_status text DEFAULT 'all',
  p_platform text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT security.can_access_merchant(p_merchant_code)
     OR NOT security.has_merchant_permission(p_merchant_code, 'products') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('all','linked','review','unknown') THEN
    RAISE EXCEPTION 'invalid catalog status' USING errcode = '22023';
  END IF;

  WITH mapping_rollup AS (
    SELECT m.merchant_code, m.product_id,
      jsonb_agg(jsonb_build_object('id',m.id,'platform',m.platform,'identifier_type',m.identifier_type,'identifier_value',m.identifier_value,'status',m.match_status) ORDER BY m.platform) mappings,
      CASE WHEN bool_or(m.match_status = 'review') THEN 'review' ELSE 'linked' END match_status
    FROM public.product_channel_mappings m
    WHERE m.merchant_code=p_merchant_code AND m.product_id IS NOT NULL
      AND (p_platform IS NULL OR m.platform=p_platform)
    GROUP BY m.merchant_code, m.product_id
  ), linked AS (
    SELECT p.id, p.name, p.name_en, p.sku, p.barcode, p.brand, p.category, p.image_url,
      p.cost_price, p.sale_price, p.target_net_price, p.catalog_status,
      coalesce((SELECT sum(greatest(coalesce(i.quantity,0)-coalesce(i.reserved_quantity,0),0)) FROM public.inventory i
        WHERE i.merchant_code=p.merchant_code AND i.sku IN (p.sku,p.barcode)), 0)::bigint inventory,
      coalesce(m.mappings, '[]'::jsonb) mappings,
      coalesce(m.match_status, 'unknown') match_status
    FROM public.products p
    LEFT JOIN mapping_rollup m ON m.merchant_code=p.merchant_code AND m.product_id=p.id
    WHERE p.merchant_code=p_merchant_code
      AND (p_platform IS NULL OR m.product_id IS NOT NULL)
      AND (nullif(btrim(p_search),'') IS NULL OR p.name ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.name_en,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.sku,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.barcode,'') ILIKE '%'||btrim(p_search)||'%')
  ), unknown AS (
    SELECT NULL::uuid id, coalesce(m.source_name, m.identifier_value) name, NULL::text name_en,
      m.source_sku sku, m.source_barcode barcode, NULL::text brand, NULL::text category, NULL::text image_url,
      0::numeric cost_price, NULL::numeric sale_price, 0::numeric target_net_price, 'active'::text catalog_status,
      0::bigint inventory,
      jsonb_build_array(jsonb_build_object('id',m.id,'platform',m.platform,'identifier_type',m.identifier_type,'identifier_value',m.identifier_value,'status',m.match_status)) mappings,
      m.match_status
    FROM public.product_channel_mappings m
    WHERE m.merchant_code=p_merchant_code AND m.product_id IS NULL
      AND (p_platform IS NULL OR m.platform=p_platform)
      AND (nullif(btrim(p_search),'') IS NULL OR coalesce(m.source_name,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(m.source_sku,'') ILIKE '%'||btrim(p_search)||'%' OR m.identifier_value ILIKE '%'||btrim(p_search)||'%')
  ), entries AS (SELECT * FROM linked UNION ALL SELECT * FROM unknown), filtered AS (
    SELECT * FROM entries WHERE p_status='all' OR match_status=p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY CASE match_status WHEN 'unknown' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, name LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0)
  ), stats AS (
    SELECT count(*) total, count(*) FILTER (WHERE match_status='linked') linked,
      count(*) FILTER (WHERE match_status='review') review, count(*) FILTER (WHERE match_status='unknown') unknown FROM entries
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'stats',(SELECT to_jsonb(stats) FROM stats),'filtered_count',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.unified_product_catalog(text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unified_product_catalog(text,text,text,text,integer,integer) TO authenticated, service_role;
