CREATE OR REPLACE FUNCTION security.list_order_operating_facts_by_account(p_merchant_code text, p_sku text DEFAULT NULL::text)
 RETURNS TABLE(marketplace_account_id uuid, id uuid, merchant_code text, platform text, status text, product_name text, sku text, quantity integer, unit_price numeric, total_amount numeric, gross_amount numeric, platform_fee numeric, shipping_cost numeric, discount_amount numeric, currency text, order_date timestamp with time zone, created_at timestamp with time zone, upload_id uuid, last_synced_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    o.marketplace_account_id, o.id, o.merchant_code, o.platform, o.status, o.product_name, o.sku,
    o.quantity, o.unit_price, o.total_amount, o.gross_amount,
    o.platform_fee, o.shipping_cost, o.discount_amount, o.currency,
    o.order_date, o.created_at, o.upload_id, o.last_synced_at
  FROM public.orders o
  WHERE o.merchant_code = p_merchant_code
    AND security.can_access_merchant(p_merchant_code) AND security.mfa_access_allowed()
    AND (
      (
        NOT security.is_platform_staff_account()
        AND security.current_has_any_merchant_permission(
          ARRAY['dashboard', 'orders', 'products', 'statement']::text[]
        )
      )
      OR security.has_any_platform_permission(
        ARRAY['view_merchants', 'view_files', 'view_finance']::text[]
      )
    )
    AND (p_sku IS NULL OR o.sku = p_sku)
  ORDER BY o.order_date DESC, o.id
$function$;

CREATE OR REPLACE FUNCTION public.list_order_operating_facts_by_account(p_merchant_code text, p_sku text DEFAULT NULL::text)
 RETURNS TABLE(marketplace_account_id uuid, id uuid, merchant_code text, platform text, status text, product_name text, sku text, quantity integer, unit_price numeric, total_amount numeric, gross_amount numeric, platform_fee numeric, shipping_cost numeric, discount_amount numeric, currency text, order_date timestamp with time zone, created_at timestamp with time zone, upload_id uuid, last_synced_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT *
  FROM security.list_order_operating_facts_by_account(p_merchant_code, p_sku)
$function$;


revoke all on function security.list_order_operating_facts_by_account(text,text) from public,anon;
grant execute on function security.list_order_operating_facts_by_account(text,text) to authenticated,service_role;
revoke all on function public.list_order_operating_facts_by_account(text,text) from public,anon;
grant execute on function public.list_order_operating_facts_by_account(text,text) to authenticated,service_role;
CREATE OR REPLACE FUNCTION security.list_return_facts_by_account(p_merchant_code text, p_sku text DEFAULT NULL::text)
 RETURNS TABLE(marketplace_account_id uuid, id uuid, merchant_code text, platform text, order_id text, product_name text, sku text, quantity integer, return_amount numeric, reason text, return_date date, status text, created_at timestamp with time zone, upload_id uuid, claim_id text, claim_line_id text, last_synced_at timestamp with time zone, provider_claim_item_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    r.marketplace_account_id, r.id, r.merchant_code, r.platform, r.order_id, r.product_name, r.sku,
    r.quantity, r.return_amount, r.reason, r.return_date, r.status,
    r.created_at, r.upload_id, r.claim_id, r.claim_line_id,
    r.last_synced_at, r.provider_claim_item_id
  FROM public.returns r
  WHERE r.merchant_code = p_merchant_code
    AND security.can_access_merchant(p_merchant_code) AND security.mfa_access_allowed()
    AND (
      (
        NOT security.is_platform_staff_account()
        AND security.current_has_any_merchant_permission(
          ARRAY['dashboard', 'orders', 'products', 'statement']::text[]
        )
      )
      OR security.has_any_platform_permission(
        ARRAY['view_merchants', 'view_files', 'view_finance']::text[]
      )
    )
    AND (p_sku IS NULL OR r.sku = p_sku)
  ORDER BY r.return_date DESC NULLS LAST, r.created_at DESC, r.id
$function$;

CREATE OR REPLACE FUNCTION public.list_return_facts_by_account(p_merchant_code text, p_sku text DEFAULT NULL::text)
 RETURNS TABLE(marketplace_account_id uuid, id uuid, merchant_code text, platform text, order_id text, product_name text, sku text, quantity integer, return_amount numeric, reason text, return_date date, status text, created_at timestamp with time zone, upload_id uuid, claim_id text, claim_line_id text, last_synced_at timestamp with time zone, provider_claim_item_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM security.list_return_facts_by_account(p_merchant_code, p_sku)
$function$;


revoke all on function security.list_return_facts_by_account(text,text) from public,anon;
grant execute on function security.list_return_facts_by_account(text,text) to authenticated,service_role;
revoke all on function public.list_return_facts_by_account(text,text) from public,anon;
grant execute on function public.list_return_facts_by_account(text,text) to authenticated,service_role;