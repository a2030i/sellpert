-- REVIEW DRAFT ONLY. Preserve correct production behavior in fresh rebuilds.
-- Changes function definitions only; does not delete uploads, modify audit rows,
-- close imports/accounts, or rewrite existing merchant names.

CREATE OR REPLACE FUNCTION public.delete_upload_cascade_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_cascade_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION public.delete_upload_with_data_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_with_data_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION security.write_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := COALESCE(v_new, v_old, '{}'::jsonb);
  v_actor text;
  v_record_id text;
  v_merchant_code text;
BEGIN
  v_actor := COALESCE(
    (SELECT auth.uid())::text,
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    current_user
  );
  v_record_id := COALESCE(v_row ->> 'id', v_row ->> 'merchant_code', v_row ->> 'key');
  v_merchant_code := COALESCE(v_row ->> 'merchant_code', v_row ->> 'owner_merchant_code');

  INSERT INTO public.audit_log (
    merchant_code, action, table_name, record_id,
    old_values, new_values, performed_by, performed_at
  ) VALUES (
    v_merchant_code, lower(TG_OP), TG_TABLE_NAME, v_record_id,
    security.redact_audit_values(v_old),
    security.redact_audit_values(v_new),
    v_actor, now()
  );

  RETURN COALESCE(NEW, OLD);
END
$function$

;

CREATE OR REPLACE FUNCTION security.close_stale_imports()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.platform_file_uploads
  SET status = 'failed',
      finished_at = now(),
      error_message = COALESCE(
        NULLIF(error_message, ''),
        'توقفت المعالجة لأكثر من 30 دقيقة — أغلقها النظام تلقائياً ويمكن إعادة رفع الملف'
      )
  WHERE status = 'processing'
    AND uploaded_at < now() - interval '30 minutes';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$function$

;

CREATE OR REPLACE FUNCTION security.handle_self_service_merchant_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text;
  v_name text;
  v_phone text;
  v_legal_version text;
  v_accepted boolean;
  v_attempt integer := 0;
begin
  if coalesce(new.raw_user_meta_data->>'signup_source', '') <> 'self_service' then
    return new;
  end if;

  v_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'متجر جديد'), 120);
  v_phone := nullif(left(btrim(new.raw_user_meta_data->>'whatsapp_phone'), 32), '');
  v_legal_version := nullif(left(btrim(new.raw_user_meta_data->>'legal_version'), 10), '');
  v_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
    and coalesce((new.raw_user_meta_data->>'privacy_accepted')::boolean, false)
    and v_legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  loop
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.merchants (
        id, merchant_code, name, email, currency, role,
        workspace_status, signup_source, whatsapp_phone, is_active
      ) values (
        new.id, v_code, v_name, lower(new.email), 'SAR', 'merchant',
        'active', 'self_service', v_phone, new.email_confirmed_at is not null
      );
      exit;
    exception when unique_violation then
      if exists (select 1 from public.merchants where id = new.id) then return new; end if;
      if v_attempt >= 3 then raise; end if;
    end;
  end loop;

  if v_accepted then
    insert into public.merchant_legal_acceptances (merchant_code, user_id, terms_version, privacy_version)
    values (v_code, new.id, v_legal_version, v_legal_version);
  end if;
  return new;
end
$function$

;

-- Preserve private browser execution boundaries. Internal wrappers are service-only.
REVOKE ALL ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) TO service_role;
