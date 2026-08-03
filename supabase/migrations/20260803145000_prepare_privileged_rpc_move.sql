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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

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
$function$;

-- Service-only and trigger implementations moved by the same boundary migration.

CREATE OR REPLACE FUNCTION public.bulk_notify(p_merchant_codes text[], p_title text, p_body text, p_action_path text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  c text;
BEGIN
  FOREACH c IN ARRAY p_merchant_codes LOOP
    INSERT INTO public.notifications (merchant_code, type, title, body, action_path)
    VALUES (c, 'info', p_title, p_body, p_action_path);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;
CREATE OR REPLACE FUNCTION public.check_budget_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_spent numeric;
  v_pct numeric;
  v_count int := 0;
BEGIN
  FOR rec IN SELECT * FROM public.budget_alerts WHERE is_active LOOP
    SELECT COALESCE(SUM(spend), 0) INTO v_spent
    FROM public.ad_metrics
    WHERE merchant_code = rec.merchant_code
      AND (rec.platform IS NULL OR platform = rec.platform)
      AND report_date >= DATE_TRUNC('month', CURRENT_DATE);

    v_pct := (v_spent / NULLIF(rec.monthly_limit, 0)) * 100;
    IF v_pct >= rec.alert_at_pct
       AND (rec.last_alerted_at IS NULL OR rec.last_alerted_at < CURRENT_DATE) THEN
      INSERT INTO public.notifications (merchant_code, type, title, body, action_path)
      VALUES (rec.merchant_code, 'warning',
        '⚠️ تجاوز ميزانية الإعلانات',
        'أنفقت ' || ROUND(v_spent) || ' ر.س من ميزانية ' || rec.monthly_limit || ' ر.س (' || ROUND(v_pct) || '%)' || COALESCE(' على ' || rec.platform, ''),
        '/marketing');
      UPDATE public.budget_alerts SET last_alerted_at = NOW() WHERE id = rec.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $function$;
CREATE OR REPLACE FUNCTION public.complete_queue_job(job_id bigint, success boolean, err_msg text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempts    SMALLINT;
  v_max_att     SMALLINT;
  v_retry_delay INTERVAL;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max_att
  FROM sync_queue WHERE id = job_id;

  IF success THEN
    UPDATE sync_queue
    SET status = 'done', finished_at = now(), error_message = NULL
    WHERE id = job_id;
  ELSE
    IF v_attempts >= v_max_att THEN
      UPDATE sync_queue
      SET status = 'failed', finished_at = now(), error_message = err_msg
      WHERE id = job_id;
    ELSE
      -- Exponential backoff: 1min, 5min, 30min
      v_retry_delay := CASE v_attempts
        WHEN 1 THEN interval '1 minute'
        WHEN 2 THEN interval '5 minutes'
        ELSE         interval '30 minutes'
      END;
      UPDATE sync_queue
      SET status        = 'pending',
          started_at    = NULL,
          error_message = err_msg,
          next_retry_at = now() + v_retry_delay,
          scheduled_at  = now() + v_retry_delay
      WHERE id = job_id;
    END IF;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_upload_cascade_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted jsonb := '{}'::jsonb;
  v_count   integer;
  v_merchant text;
BEGIN
  SELECT merchant_code INTO v_merchant FROM platform_file_uploads WHERE id = p_upload_id;

  SELECT count(*) INTO v_count FROM orders                        WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('orders', v_count);
  SELECT count(*) INTO v_count FROM products                      WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('products', v_count);
  SELECT count(*) INTO v_count FROM inventory                     WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('inventory', v_count);
  SELECT count(*) INTO v_count FROM account_transactions          WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('account_transactions', v_count);
  SELECT count(*) INTO v_count FROM ad_metrics                    WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('ad_metrics', v_count);
  SELECT count(*) INTO v_count FROM returns                       WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('returns', v_count);
  SELECT count(*) INTO v_count FROM goods_received                WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('goods_received', v_count);
  SELECT count(*) INTO v_count FROM platform_deals                WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('platform_deals', v_count);
  SELECT count(*) INTO v_count FROM product_performance_snapshots WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('product_performance_snapshots', v_count);
  SELECT count(*) INTO v_count FROM inbound_shipments             WHERE upload_id = p_upload_id; v_deleted := v_deleted || jsonb_build_object('inbound_shipments', v_count);

  DELETE FROM platform_file_uploads WHERE id = p_upload_id;

  v_deleted := v_deleted || jsonb_build_object('merchant', v_merchant);
  RETURN v_deleted;
END $function$;
CREATE OR REPLACE FUNCTION public.delete_upload_with_data_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_merchant text; cnts jsonb := '{}'::jsonb; c int;
BEGIN
  SELECT merchant_code INTO v_merchant FROM public.platform_file_uploads WHERE id = p_upload_id;
  IF v_merchant IS NULL THEN RETURN jsonb_build_object('error', 'upload not found'); END IF;

  DELETE FROM public.inbound_shipment_items        WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('inbound_shipment_items', c);
  DELETE FROM public.inbound_shipments             WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('inbound_shipments', c);
  DELETE FROM public.goods_received                WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('goods_received', c);
  DELETE FROM public.ad_metrics                    WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('ad_metrics', c);
  DELETE FROM public.account_transactions          WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('account_transactions', c);
  DELETE FROM public.product_performance_snapshots WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('product_performance_snapshots', c);
  DELETE FROM public.platform_deals                WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('platform_deals', c);
  DELETE FROM public.amazon_daily_sales            WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('amazon_daily_sales', c);
  DELETE FROM public.returns                       WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('returns', c);
  DELETE FROM public.orders                        WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('orders', c);
  DELETE FROM public.inventory                     WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('inventory', c);
  DELETE FROM public.products                      WHERE upload_id = p_upload_id; GET DIAGNOSTICS c = ROW_COUNT; cnts := cnts || jsonb_build_object('products', c);

  DELETE FROM public.platform_file_uploads WHERE id = p_upload_id;
  PERFORM public.rebuild_all_derived_data(v_merchant);
  RETURN jsonb_build_object('ok', true, 'merchant', v_merchant, 'deleted', cnts);
END $function$;
CREATE OR REPLACE FUNCTION public.derive_orders_from_account_tx(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.orders
   WHERE merchant_code = p_merchant_code AND platform = 'amazon';

  INSERT INTO public.orders (
    merchant_code, platform, order_id, status,
    product_name, sku, quantity, unit_price, total_amount,
    platform_fee, currency, order_date
  )
  SELECT
    merchant_code, 'amazon', order_id,
    'delivered',
    MAX(NULLIF(description, '')),
    MAX(NULLIF(product_sku, '')),
    1,
    ROUND(SUM(GREATEST(credit, 0))::numeric / NULLIF(COUNT(*) FILTER (WHERE credit > 0), 0), 2),
    SUM(net_amount),
    SUM(GREATEST(debit, 0)),
    MAX(currency),
    MAX(COALESCE(transaction_date, posted_date, created_at))
  FROM public.account_transactions
  WHERE merchant_code = p_merchant_code
    AND platform = 'amazon'
    AND order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$'  -- صيغة طلب أمازون فقط
    AND transaction_type ILIKE '%مبلغ الطلب%'
    AND COALESCE(amount_description, '') NOT ILIKE '%استرداد%'
    AND COALESCE(amount_description, '') NOT ILIKE '%refund%'
    AND COALESCE(amount_description, '') NOT ILIKE '%إلغاء%'
    AND COALESCE(amount_description, '') NOT ILIKE '%cancel%'
    AND COALESCE(description, '') NOT ILIKE '%رسوم الإلغاء%'
    AND COALESCE(description, '') NOT ILIKE '%Tax%'
  GROUP BY merchant_code, order_id
  HAVING SUM(net_amount) > 0;  -- فقط طلبات بقيمة موجبة

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
CREATE OR REPLACE FUNCTION public.derive_product_platform_prices(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.product_platform_prices
   WHERE merchant_code = p_merchant_code;

  INSERT INTO public.product_platform_prices (
    product_id, merchant_code, platform, selling_price, commission_rate, is_active
  )
  SELECT DISTINCT ON (p.id, i.platform)
    p.id, p.merchant_code, i.platform,
    COALESCE(p.sale_price, p.msrp, p.target_net_price, 0)::numeric,
    COALESCE(c.rate, 0),
    i.is_active
  FROM public.inventory i
  JOIN public.products p
    ON p.merchant_code = i.merchant_code
   AND (p.sku = i.sku OR p.barcode = i.partner_sku OR p.barcode = i.sku)
  LEFT JOIN public.platform_commission_rates c ON c.platform = i.platform
  WHERE i.merchant_code = p_merchant_code;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
CREATE OR REPLACE FUNCTION public.derive_returns_from_account_tx(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.returns
   WHERE merchant_code = p_merchant_code
     AND order_id LIKE 'AMZ-%';

  INSERT INTO public.returns (
    merchant_code, platform, order_id, product_name, sku,
    quantity, return_amount, reason, return_date, status
  )
  SELECT
    merchant_code, 'amazon',
    'AMZ-' || order_id,
    MAX(NULLIF(description, '')),
    MAX(NULLIF(product_sku, '')),
    1,
    ABS(SUM(net_amount))::numeric,
    MAX(amount_description),
    DATE(MAX(COALESCE(transaction_date, posted_date))),
    'processed'
  FROM public.account_transactions
  WHERE merchant_code = p_merchant_code
    AND platform = 'amazon'
    AND order_id IS NOT NULL AND order_id <> '' AND order_id <> '---'
    AND (
      amount_description ILIKE '%استرداد%' OR amount_description ILIKE '%refund%' OR
      transaction_type ILIKE '%استرداد%' OR transaction_type ILIKE '%refund%'
    )
  GROUP BY merchant_code, order_id
  HAVING SUM(net_amount) < 0;  -- فقط المرتجعات الحقيقية (سالبة)

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
CREATE OR REPLACE FUNCTION public.derive_returns_from_snapshots(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  DELETE FROM public.returns
   WHERE merchant_code = p_merchant_code
     AND order_id LIKE 'SNAP-%';

  INSERT INTO public.returns (
    merchant_code, platform, order_id, product_name, sku,
    quantity, return_amount, reason, return_date, status
  )
  SELECT
    s.merchant_code, s.platform,
    'SNAP-' || s.id::text,
    s.product_name, s.sku,
    s.returned,
    ROUND((COALESCE(s.avg_price, 0) * s.returned)::numeric, 2),
    (
      SELECT key FROM jsonb_each_text(s.return_reasons) AS r(key, val)
      WHERE val::numeric > 0
      ORDER BY val::numeric DESC LIMIT 1
    ),
    s.snapshot_date,
    'processed'
  FROM public.product_performance_snapshots s
  WHERE s.merchant_code = p_merchant_code
    AND s.returned > 0;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
CREATE OR REPLACE FUNCTION public.enqueue_daily_salla_sync()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO sync_queue (merchant_code, platform, job_type, priority, status, scheduled_at)
  SELECT
    sc.merchant_code,
    'salla',
    'sync_analytics',
    5,  -- low priority (background)
    'pending',
    now()
  FROM salla_connections sc
  JOIN merchants m ON m.merchant_code = sc.merchant_code
  WHERE sc.uninstalled_at IS NULL
    AND sc.sync_status   != 'suspended'
    AND m.subscription_status = 'active'
    -- Avoid duplicate: don't queue if one pending in last hour
    AND NOT EXISTS (
      SELECT 1 FROM sync_queue sq
      WHERE sq.merchant_code = sc.merchant_code
        AND sq.platform      = 'salla'
        AND sq.job_type      = 'sync_analytics'
        AND sq.status        = 'pending'
        AND sq.created_at    > now() - interval '1 hour'
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_db_health_internal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  tomorrow_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Riyadh') + interval '1 day') at time zone 'Asia/Riyadh';
  is_service_role boolean := COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
BEGIN
  IF NOT is_service_role AND NOT security.has_platform_permission('view_db_health') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'table_stats', (
      SELECT jsonb_agg(jsonb_build_object(
        'table', stats.relname,
        'rows', stats.n_live_tup,
        'size_bytes', pg_catalog.pg_total_relation_size(stats.relid)
      ) ORDER BY stats.n_live_tup DESC)
      FROM pg_catalog.pg_stat_user_tables stats
      WHERE stats.schemaname = 'public'
    ),
    'active_connections', (
      SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE state = 'active' AND datname = pg_catalog.current_database()
    ),
    'total_connections', (
      SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE datname = pg_catalog.current_database()
    ),
    'max_connections', (
      SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'max_connections'
    ),
    'queue_stats', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'running', count(*) FILTER (WHERE status IN ('processing','running')),
        'failed', count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours'),
        'done_today', count(*) FILTER (WHERE status IN ('done','success') AND created_at > now() - interval '24 hours'),
        'stalled', count(*) FILTER (
          WHERE status IN ('pending','processing','running')
            AND COALESCE(started_at, created_at) < now() - interval '30 minutes'
        )
      ) FROM public.sync_queue
    ),
    'upload_stats', (
      SELECT jsonb_build_object(
        'processing', count(*) FILTER (WHERE status = 'processing'),
        'stalled', count(*) FILTER (WHERE status = 'processing' AND uploaded_at < now() - interval '30 minutes'),
        'failed_24h', count(*) FILTER (WHERE status = 'failed' AND uploaded_at > now() - interval '24 hours'),
        'success_24h', count(*) FILTER (WHERE status = 'success' AND uploaded_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) FILTER (WHERE status = 'success')
      ) FROM public.platform_file_uploads
    ),
    'sync_stats', (
      SELECT jsonb_build_object(
        'errors_24h', count(*) FILTER (WHERE status = 'error' AND started_at > now() - interval '24 hours'),
        'success_24h', count(*) FILTER (WHERE status = 'success' AND started_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) FILTER (WHERE status = 'success'),
        'last_error_at', max(finished_at) FILTER (WHERE status = 'error')
      ) FROM public.sync_logs
    ),
    'stale_active_connections', (
      SELECT count(*) FROM public.platform_credentials
      WHERE is_active = true
        AND (last_sync_at IS NULL OR last_sync_at < now() - interval '24 hours')
    ),
    'recent_incidents', (
      SELECT COALESCE(jsonb_agg(incident ORDER BY incident_time DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'source', 'sync', 'merchant_code', merchant_code, 'platform', platform,
          'occurred_at', COALESCE(finished_at, started_at),
          'message', left(COALESCE(error_message, 'ÙØ´Ù„Øª Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø©'), 240)
        ) AS incident,
        COALESCE(finished_at, started_at) AS incident_time
        FROM public.sync_logs WHERE status = 'error'
        UNION ALL
        SELECT jsonb_build_object(
          'source', 'upload', 'merchant_code', merchant_code, 'platform', platform,
          'occurred_at', COALESCE(finished_at, uploaded_at),
          'message', left(COALESCE(error_message, 'ÙØ´Ù„ Ø§Ø³ØªÙŠØ±Ø§Ø¯ Ø§Ù„Ù…Ù„Ù'), 240)
        ) AS incident,
        COALESCE(finished_at, uploaded_at) AS incident_time
        FROM public.platform_file_uploads WHERE status = 'failed'
        ORDER BY incident_time DESC LIMIT 10
      ) incidents
    ),
    'webhook_errors_24h', (
      SELECT count(*) FROM public.webhook_events
      WHERE status = 'failed' AND received_at > now() - interval '24 hours'
    ),
    'merchant_count', (SELECT count(*) FROM public.merchants WHERE role = 'merchant'),
    'active_subscriptions', (SELECT count(*) FROM public.subscriptions WHERE status = 'active'),
    'suspended_merchants', (SELECT count(*) FROM public.merchants WHERE subscription_status = 'suspended'),
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_today', (
      SELECT count(*) FROM public.orders
      WHERE order_date >= today_start AND order_date < tomorrow_start
    ),
    'cache_hit_ratio', (
      SELECT round(100.0 * sum(heap_blks_hit) /
        nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1)
      FROM pg_catalog.pg_statio_user_tables
    ),
    'oldest_pending_minutes', (
      SELECT round(extract(epoch FROM (now() - min(created_at))) / 60)
      FROM public.sync_queue WHERE status = 'pending'
    )
  ) INTO result;

  RETURN result;
END
$function$;
CREATE OR REPLACE FUNCTION public.handle_self_service_merchant_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_code text;
  v_name text;
  v_phone text;
  v_attempt integer := 0;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'signup_source', '') <> 'self_service' THEN
    RETURN NEW;
  END IF;

  v_name := left(
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'متجر جديد'
    ),
    120
  );
  v_phone := NULLIF(left(btrim(NEW.raw_user_meta_data->>'whatsapp_phone'), 32), '');

  LOOP
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

    BEGIN
      INSERT INTO public.merchants (
        id, merchant_code, name, email, currency, role,
        subscription_plan, subscription_status, signup_source,
        whatsapp_phone, is_active
      ) VALUES (
        NEW.id,
        v_code,
        v_name,
        lower(NEW.email),
        'SAR',
        'merchant',
        'free',
        'active',
        'self_service',
        v_phone,
        true
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM public.merchants WHERE id = NEW.id) THEN
          RETURN NEW;
        END IF;
        IF v_attempt >= 3 THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  RETURN NEW;
END
$function$;
CREATE OR REPLACE FUNCTION public.notify_order_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_threshold numeric;
BEGIN
  -- لا ترسل لو الطلب قديم (عند الاستيراد)
  IF NEW.order_date < NOW() - INTERVAL '1 hour' THEN RETURN NEW; END IF;
  -- لا ترسل لو الإجمالي صفر/سلبي
  IF COALESCE(NEW.total_amount, 0) <= 0 THEN RETURN NEW; END IF;

  -- ندعو edge function notify-whatsapp عبر pg_net
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    PERFORM net.http_post(
      url := 'https://urdyzbsukcuibadlaath.supabase.co/functions/v1/notify-whatsapp',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'merchant_code', NEW.merchant_code,
        'event', 'new_order',
        'data', jsonb_build_object(
          'platform', NEW.platform,
          'amount', NEW.total_amount,
          'currency', COALESCE(NEW.currency, 'SAR'),
          'order_id', NEW.order_id,
          'product_name', NEW.product_name
        )
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; -- silently ignore failures
END $function$;
CREATE OR REPLACE FUNCTION public.reactivate_merchant(p_merchant_code text, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE merchants
  SET subscription_status = 'active'
  WHERE merchant_code = p_merchant_code;

  UPDATE salla_connections
  SET sync_status = 'idle'
  WHERE merchant_code = p_merchant_code
    AND sync_status = 'suspended';

  UPDATE subscriptions
  SET status               = 'active',
      cancelled_at         = NULL,
      cancel_reason        = NULL,
      current_period_end   = COALESCE(p_period_end, now() + interval '1 month'),
      current_period_start = now(),
      updated_at           = now()
  WHERE merchant_code = p_merchant_code;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rebuild_performance_data(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE affected integer;
BEGIN
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  WITH order_agg AS (
    SELECT o.merchant_code, o.platform, DATE(o.order_date) AS data_date,
      SUM(o.total_amount) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(CASE WHEN o.platform = 'noon' AND COALESCE(o.platform_fee,0) = 0
            THEN o.total_amount * (COALESCE(cr.rate,0)/100.0) * (1 + COALESCE(cr.vat_rate,0)/100.0)
            ELSE COALESCE(o.platform_fee,0) END) AS platform_fees
    FROM public.orders o
    LEFT JOIN public.platform_commission_rates cr
      ON cr.platform = o.platform AND cr.category = 'default'
    WHERE o.merchant_code = p_merchant_code AND o.status NOT IN ('cancelled')
    GROUP BY o.merchant_code, o.platform, DATE(o.order_date)
  ),
  amz_tx_orders AS (
    SELECT t.merchant_code, t.platform, DATE(t.transaction_date) AS data_date,
      SUM(GREATEST(t.credit, 0)) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(GREATEST(t.debit, 0)) AS platform_fees
    FROM public.account_transactions t
    WHERE t.merchant_code = p_merchant_code
      AND t.platform = 'amazon'
      AND (t.transaction_type ILIKE '%مبلغ الطلب%'
        OR t.transaction_type ILIKE '%order%'
        OR t.amount_type ILIKE '%ItemPrice%')
      AND t.transaction_date IS NOT NULL
      -- Orders are the canonical sale source once they exist. Amazon finance
      -- rows can be posted on another date and must not be added again.
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
    GROUP BY t.merchant_code, t.platform, DATE(t.transaction_date)
  ),
  amz_dashboard AS (
    SELECT d.merchant_code, 'amazon'::text AS platform, d.data_date,
      d.total_sales, COALESCE(d.units,0) AS order_count,
      0::numeric AS platform_fees
    FROM public.amazon_daily_sales d
    WHERE d.merchant_code = p_merchant_code
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
      AND NOT EXISTS (SELECT 1 FROM amz_tx_orders)
  ),
  trendyol_snap AS (
    SELECT s.merchant_code, s.platform, s.snapshot_date AS data_date,
      SUM(s.gross_sales) AS total_sales,
      SUM(s.net_sold)::int AS order_count,
      SUM(s.discount) AS platform_fees
    FROM public.product_performance_snapshots s
    WHERE s.merchant_code = p_merchant_code
      AND s.platform = 'trendyol'
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'trendyol')
    GROUP BY s.merchant_code, s.platform, s.snapshot_date
  ),
  ad_agg AS (
    SELECT merchant_code, platform, report_date AS data_date, SUM(spend) AS ad_spend
    FROM public.ad_metrics
    WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, report_date
  ),
  combined AS (
    SELECT * FROM order_agg
    UNION ALL SELECT * FROM amz_tx_orders
    UNION ALL SELECT * FROM amz_dashboard
    UNION ALL SELECT * FROM trendyol_snap
  ),
  collapsed AS (
    SELECT merchant_code, platform, data_date,
      SUM(total_sales) AS total_sales,
      SUM(order_count) AS order_count,
      SUM(platform_fees) AS platform_fees
    FROM combined
    GROUP BY merchant_code, platform, data_date
  )
  INSERT INTO public.performance_data
    (merchant_code, platform, data_date, total_sales, order_count, platform_fees, ad_spend)
  SELECT COALESCE(c.merchant_code, a.merchant_code),
    COALESCE(c.platform, a.platform), COALESCE(c.data_date, a.data_date),
    COALESCE(c.total_sales, 0), COALESCE(c.order_count, 0)::int,
    COALESCE(c.platform_fees, 0), COALESCE(a.ad_spend, 0)
  FROM collapsed c
  FULL OUTER JOIN ad_agg a
    ON c.merchant_code = a.merchant_code
   AND c.platform = a.platform
   AND c.data_date = a.data_date;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;
CREATE OR REPLACE FUNCTION public.suspend_merchant(p_merchant_code text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 1. Suspend merchant
  UPDATE merchants
  SET subscription_status = 'suspended'
  WHERE merchant_code = p_merchant_code;

  -- 2. Cancel pending queue jobs
  UPDATE sync_queue
  SET status = 'skipped', error_message = 'subscription_suspended'
  WHERE merchant_code = p_merchant_code
    AND status = 'pending';

  -- 3. Mark salla connection as suspended
  UPDATE salla_connections
  SET sync_status = 'suspended'
  WHERE merchant_code = p_merchant_code;

  -- 4. Update subscription record
  UPDATE subscriptions
  SET status       = 'suspended',
      cancelled_at = now(),
      cancel_reason = COALESCE(p_reason, 'salla_cancellation'),
      updated_at   = now()
  WHERE merchant_code = p_merchant_code
    AND status = 'active';
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_queue_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anon_key text;
BEGIN
  SELECT value INTO v_anon_key
  FROM public.app_settings
  WHERE key = 'SUPABASE_ANON_KEY'
  LIMIT 1;

  IF v_anon_key IS NULL OR v_anon_key = '' THEN
    RAISE WARNING 'trigger_queue_worker: SUPABASE_ANON_KEY not set in app_settings';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://urdyzbsukcuibadlaath.supabase.co/functions/v1/queue-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_queue_worker HTTP error: %', SQLERRM;
END;
$function$;
