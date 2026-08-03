-- Restore the privileged RPC implementations that predate the repository's
-- migration history. The following migration moves these implementations into
-- the private security schema and exposes stable invoker wrappers.

CREATE OR REPLACE FUNCTION public.current_merchant_code()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN member.role = 'employee' THEN member.owner_merchant_code
    ELSE member.merchant_code
  END
  FROM public.merchants member
  LEFT JOIN public.merchants owner
    ON member.role = 'employee'
   AND owner.merchant_code = member.owner_merchant_code
   AND owner.role = 'merchant'
  WHERE member.id = (SELECT auth.uid())
    AND COALESCE(member.is_active, true)
    AND (
      member.role <> 'employee'
      OR (owner.id IS NOT NULL AND COALESCE(owner.is_active, true))
    )
  LIMIT 1
$function$

CREATE OR REPLACE FUNCTION public.delete_employee(p_employee_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_owner_code text;
  v_employee_id uuid;
BEGIN
  SELECT merchant_code INTO v_owner_code
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND role = 'merchant'
    AND COALESCE(is_active, true);

  IF v_owner_code IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT id INTO v_employee_id
  FROM public.merchants
  WHERE merchant_code = p_employee_code
    AND role = 'employee'
    AND owner_merchant_code = v_owner_code;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING errcode = 'P0002';
  END IF;

  DELETE FROM public.merchants WHERE id = v_employee_id;
  RETURN jsonb_build_object('ok', true, 'auth_id', v_employee_id);
END
$function$

CREATE OR REPLACE FUNCTION public.delete_upload_cascade(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.delete_upload_with_data(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.get_db_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if not security.has_platform_permission('view_db_health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  result := security.get_db_health_internal();
  return result || jsonb_build_object(
    'client_incident_stats', (
      select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'fatal_open', count(*) filter (where status = 'open' and severity = 'fatal'),
        'new_24h', count(*) filter (where first_seen_at > now() - interval '24 hours'),
        'occurrences_24h', coalesce(sum(occurrence_count) filter (where last_seen_at > now() - interval '24 hours'), 0)
      ) from security.client_incidents
    ),
    'recent_client_incidents', (
      select coalesce(jsonb_agg(item order by incident_time desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', incident.id,
          'source', 'client',
          'merchant_code', incident.merchant_code,
          'platform', null,
          'occurred_at', incident.last_seen_at,
          'category', incident.category,
          'severity', incident.severity,
          'page_path', incident.page_path,
          'component', incident.component,
          'action', incident.action,
          'error_code', incident.error_code,
          'http_status', incident.http_status,
          'release', incident.release,
          'occurrence_count', incident.occurrence_count,
          'status', incident.status,
          'message', concat(incident.category, ': ', incident.component, ' · ', incident.error_code)
        ) as item,
        incident.last_seen_at as incident_time
        from security.client_incidents incident
        where incident.status = 'open'
        order by incident.last_seen_at desc
        limit 20
      ) recent
    )
  );
end
$function$

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
      AND COALESCE(is_active, true)
  )
$function$

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
      AND COALESCE(is_active, true)
  )
$function$

CREATE OR REPLACE FUNCTION public.merchant_payouts(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.my_employees()
 RETURNS TABLE(id uuid, merchant_code text, name text, email text, whatsapp_phone text, job_title text, permissions jsonb, is_active boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT employee.id, employee.merchant_code, employee.name, employee.email,
         employee.whatsapp_phone, employee.job_title, employee.permissions,
         employee.is_active, employee.created_at
  FROM public.merchants employee
  JOIN public.merchants owner
    ON owner.id = (SELECT auth.uid())
   AND owner.role = 'merchant'
   AND COALESCE(owner.is_active, true)
   AND employee.owner_merchant_code = owner.merchant_code
  WHERE employee.role = 'employee'
  ORDER BY employee.created_at DESC
$function$

CREATE OR REPLACE FUNCTION public.my_linked_merchants()
 RETURNS TABLE(merchant_code text, name text, role text, is_default boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH member AS (
    SELECT identity.id, identity.merchant_code
    FROM public.merchants identity
    WHERE identity.id = (SELECT auth.uid())
      AND identity.role = 'merchant'
      AND COALESCE(identity.is_active, true)
  ),
  accessible AS (
    SELECT own.merchant_code, own.name, own.role, true AS is_default
    FROM member
    JOIN public.merchants own ON own.merchant_code = member.merchant_code

    UNION ALL

    SELECT target.merchant_code, target.name, target.role, COALESCE(link.is_default, false)
    FROM member
    JOIN public.merchant_account_links link ON link.user_id = member.id
    JOIN public.merchants target
      ON target.merchant_code = link.merchant_code
     AND target.role = 'merchant'
     AND COALESCE(target.is_active, true)
    WHERE target.merchant_code <> member.merchant_code
  )
  SELECT accessible.merchant_code, accessible.name, accessible.role, accessible.is_default
  FROM accessible
  ORDER BY accessible.is_default DESC, accessible.name
$function$

CREATE OR REPLACE FUNCTION public.my_owner_merchant()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT owner.merchant_code
  FROM public.merchants employee
  JOIN public.merchants owner
    ON owner.merchant_code = employee.owner_merchant_code
   AND owner.role = 'merchant'
   AND COALESCE(owner.is_active, true)
  WHERE employee.id = (SELECT auth.uid())
    AND employee.role = 'employee'
    AND COALESCE(employee.is_active, true)
  LIMIT 1
$function$

CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_is_active boolean;
  v_effective_merchant text;
  v_is_service_role boolean := COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
  amz_orders int;
  rets_snap int;
  rets_amz int;
  prices int;
  perf int;
  alerts int;
BEGIN
  IF p_merchant_code IS NULL OR btrim(p_merchant_code) = '' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    SELECT role, COALESCE(is_active, true)
      INTO v_role, v_is_active
    FROM public.merchants
    WHERE id = (SELECT auth.uid());

    IF v_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    CASE v_role
      WHEN 'staff' THEN
        IF NOT security.has_platform_permission('upload_files') THEN
          RAISE EXCEPTION 'forbidden' USING errcode = '42501';
        END IF;
      WHEN 'admin', 'super_admin' THEN
        NULL;
      WHEN 'merchant', 'employee' THEN
        v_effective_merchant := public.current_merchant_code();
        IF NOT security.has_merchant_permission(p_merchant_code, 'integrations') THEN
          RAISE EXCEPTION 'forbidden' USING errcode = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END CASE;
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
$function$

CREATE OR REPLACE FUNCTION public.team_dashboard_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION public.update_employee(p_employee_code text, p_permissions jsonb DEFAULT NULL::jsonb, p_is_active boolean DEFAULT NULL::boolean, p_job_title text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_owner_code text;
BEGIN
  SELECT merchant_code INTO v_owner_code
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND role = 'merchant'
    AND COALESCE(is_active, true);

  IF v_owner_code IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_permissions IS NOT NULL AND (
    jsonb_typeof(p_permissions) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(p_permissions) permission(key, value)
      WHERE permission.key NOT IN (
        'dashboard', 'orders', 'products', 'inventory', 'marketing',
        'statement', 'integrations', 'settings'
      )
      OR jsonb_typeof(permission.value) <> 'boolean'
    )
  ) THEN
    RAISE EXCEPTION 'invalid permissions' USING errcode = '22023';
  END IF;

  IF p_job_title IS NOT NULL AND length(trim(p_job_title)) > 100 THEN
    RAISE EXCEPTION 'invalid job title' USING errcode = '22023';
  END IF;
  IF p_name IS NOT NULL AND (length(trim(p_name)) < 2 OR length(trim(p_name)) > 120) THEN
    RAISE EXCEPTION 'invalid employee name' USING errcode = '22023';
  END IF;

  UPDATE public.merchants
  SET permissions = COALESCE(p_permissions, permissions),
      is_active = COALESCE(p_is_active, is_active),
      job_title = CASE WHEN p_job_title IS NULL THEN job_title ELSE NULLIF(trim(p_job_title), '') END,
      name = CASE WHEN p_name IS NULL THEN name ELSE trim(p_name) END
  WHERE merchant_code = p_employee_code
    AND role = 'employee'
    AND owner_merchant_code = v_owner_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'employee not found' USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$function$

CREATE OR REPLACE FUNCTION public.update_my_store_profile(p_name text DEFAULT NULL::text, p_whatsapp_phone text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text, p_merchant_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_merchant_code text;
  v_result jsonb;
BEGIN
  v_merchant_code := COALESCE(NULLIF(btrim(p_merchant_code), ''), public.current_merchant_code());
  IF v_merchant_code IS NULL
     OR NOT security.has_merchant_permission(v_merchant_code, 'settings') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_name IS NOT NULL AND (length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 120) THEN
    RAISE EXCEPTION 'invalid store name' USING errcode = '22023';
  END IF;
  IF p_whatsapp_phone IS NOT NULL AND length(btrim(p_whatsapp_phone)) > 32 THEN
    RAISE EXCEPTION 'invalid phone' USING errcode = '22023';
  END IF;
  IF p_logo_url IS NOT NULL AND (
    length(p_logo_url) > 2048 OR p_logo_url !~ '^https://'
  ) THEN
    RAISE EXCEPTION 'invalid logo url' USING errcode = '22023';
  END IF;

  UPDATE public.merchants
  SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
      whatsapp_phone = CASE
        WHEN p_whatsapp_phone IS NULL THEN whatsapp_phone
        ELSE NULLIF(btrim(p_whatsapp_phone), '')
      END,
      logo_url = COALESCE(p_logo_url, logo_url)
  WHERE merchant_code = v_merchant_code
    AND role = 'merchant'
  RETURNING jsonb_build_object(
    'id', id,
    'merchant_code', merchant_code,
    'name', name,
    'email', email,
    'whatsapp_phone', whatsapp_phone,
    'logo_url', logo_url
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  RETURN v_result;
END
$function$

CREATE OR REPLACE FUNCTION public.wipe_merchant_data(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  IF NOT security.has_platform_permission('delete_merchants') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE merchant_code = p_merchant_code AND role = 'merchant'
  ) THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.platform_file_uploads
  WHERE merchant_code = p_merchant_code;
  v_deleted := v_deleted || jsonb_build_object('uploads', v_count);

  DELETE FROM public.platform_file_uploads WHERE merchant_code = p_merchant_code;
  DELETE FROM public.orders WHERE merchant_code = p_merchant_code;
  DELETE FROM public.products WHERE merchant_code = p_merchant_code;
  DELETE FROM public.inventory WHERE merchant_code = p_merchant_code;
  DELETE FROM public.account_transactions WHERE merchant_code = p_merchant_code;
  DELETE FROM public.ad_metrics WHERE merchant_code = p_merchant_code;
  DELETE FROM public.returns WHERE merchant_code = p_merchant_code;
  DELETE FROM public.goods_received WHERE merchant_code = p_merchant_code;
  DELETE FROM public.platform_deals WHERE merchant_code = p_merchant_code;
  DELETE FROM public.product_performance_snapshots WHERE merchant_code = p_merchant_code;
  DELETE FROM public.inbound_shipment_items
  WHERE upload_id IS NULL
    AND shipment_id IN (
      SELECT id FROM public.inbound_shipments WHERE merchant_code = p_merchant_code
    );
  DELETE FROM public.inbound_shipments WHERE merchant_code = p_merchant_code;
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  RETURN v_deleted;
END
$function$


