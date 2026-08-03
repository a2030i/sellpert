-- Put explicit authorization gates in front of the remaining privileged RPCs
-- that need SECURITY DEFINER to perform multi-table work.

-- Clean rebuilds already contain the invoker-only compatibility wrappers
-- created while moving implementations into the private security schema.
-- Remove only those public wrappers before preserving the historical rename.
DROP FUNCTION IF EXISTS public.delete_upload_with_data_internal(uuid);

ALTER FUNCTION public.delete_upload_with_data(uuid)
  RENAME TO delete_upload_with_data_internal;
REVOKE ALL ON FUNCTION public.delete_upload_with_data_internal(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.delete_upload_with_data(p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
BEGIN
  SELECT merchant_code INTO v_merchant_code
  FROM public.platform_file_uploads
  WHERE id = p_upload_id;

  IF v_merchant_code IS NULL THEN
    RETURN jsonb_build_object('error', 'upload not found');
  END IF;
  IF NOT security.can_access_merchant(v_merchant_code) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN public.delete_upload_with_data_internal(p_upload_id);
END
$$;
REVOKE ALL ON FUNCTION public.delete_upload_with_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_upload_with_data(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.delete_upload_cascade_internal(uuid);

ALTER FUNCTION public.delete_upload_cascade(uuid)
  RENAME TO delete_upload_cascade_internal;
REVOKE ALL ON FUNCTION public.delete_upload_cascade_internal(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.delete_upload_cascade(p_upload_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
BEGIN
  SELECT merchant_code INTO v_merchant_code
  FROM public.platform_file_uploads
  WHERE id = p_upload_id;

  IF v_merchant_code IS NULL THEN
    RETURN jsonb_build_object('error', 'upload not found');
  END IF;
  IF NOT security.can_access_merchant(v_merchant_code) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN public.delete_upload_cascade_internal(p_upload_id);
END
$$;
REVOKE ALL ON FUNCTION public.delete_upload_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade(uuid) TO authenticated, service_role;

-- Database health is platform-administration data. Keep the existing
-- implementation private and expose a guarded wrapper to platform admins.
DROP FUNCTION IF EXISTS public.get_db_health_internal();

ALTER FUNCTION public.get_db_health() RENAME TO get_db_health_internal;
REVOKE ALL ON FUNCTION public.get_db_health_internal() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_db_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT security.has_platform_permission('view_db_health') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN public.get_db_health_internal();
END
$$;
REVOKE ALL ON FUNCTION public.get_db_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_db_health() TO authenticated, service_role;

-- These read/mutate only tenant-scoped rows and should therefore obey RLS.
ALTER FUNCTION public.generate_proactive_alerts(text) SECURITY INVOKER;
DO $$
BEGIN
  IF to_regprocedure('public.tasks_summary(text)') IS NOT NULL THEN
    ALTER FUNCTION public.tasks_summary(text) SECURITY INVOKER;
  END IF;
END
$$;

-- Trigger functions are invoked by their trigger and never directly by a
-- browser client.
DO $$
BEGIN
  IF to_regprocedure('public.notify_order_whatsapp()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.notify_order_whatsapp() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
