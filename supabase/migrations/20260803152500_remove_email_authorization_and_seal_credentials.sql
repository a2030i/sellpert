-- Authorization is tied to auth.uid(); email remains profile data only.
-- Replace legacy email-derived policies on permission-mapped tenant tables
-- with an identity scope. Existing restrictive tenant and permission policies
-- remain authoritative and are AND-ed with these permissive grants.
CREATE TEMP TABLE legacy_email_policies ON COMMIT DROP AS
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    COALESCE(qual, '') ILIKE '%auth.email%'
    OR COALESCE(with_check, '') ILIKE '%auth.email%'
    OR COALESCE(qual, '') ILIKE '%auth.jwt%email%'
    OR COALESCE(with_check, '') ILIKE '%auth.jwt%email%'
  );

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN SELECT * FROM legacy_email_policies LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  access_row record;
  boundary_name text;
  replacement_name text;
BEGIN
  FOR access_row IN
    SELECT DISTINCT tablename, cmd
    FROM legacy_email_policies
    WHERE tablename NOT IN (
      'merchant_account_links', 'merchant_notes', 'merchant_platform_mappings',
      'nps_responses', 'platform_credentials', 'task_comments'
    )
  LOOP
    boundary_name := 'merchant_permission_' || lower(access_row.cmd) || '_boundary';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = access_row.tablename
        AND policyname = boundary_name
    ) THEN
      CONTINUE;
    END IF;

    replacement_name := 'identity_scoped_' || lower(access_row.cmd);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', replacement_name, access_row.tablename);
    CASE access_row.cmd
      WHEN 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (security.can_access_merchant(merchant_code))',
          replacement_name, access_row.tablename
        );
      WHEN 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (security.can_access_merchant(merchant_code))',
          replacement_name, access_row.tablename
        );
      WHEN 'UPDATE' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (security.can_access_merchant(merchant_code)) WITH CHECK (security.can_access_merchant(merchant_code))',
          replacement_name, access_row.tablename
        );
      WHEN 'DELETE' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (security.can_access_merchant(merchant_code))',
          replacement_name, access_row.tablename
        );
      ELSE NULL;
    END CASE;
  END LOOP;
END
$$;

-- Credentials and platform mappings are server-side integration state.
-- Browser clients receive only redacted connection metadata from the guarded
-- manage-platform-credentials Edge Function.
REVOKE ALL ON TABLE public.platform_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.merchant_platform_mappings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.merchant_account_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.platform_credentials TO service_role;
GRANT ALL ON TABLE public.merchant_platform_mappings TO service_role;
GRANT ALL ON TABLE public.merchant_account_links TO service_role;

-- CRM notes are platform staff data, still constrained by tenant_boundary.
DROP POLICY IF EXISTS crm_notes_select ON public.merchant_notes;
DROP POLICY IF EXISTS crm_notes_insert ON public.merchant_notes;
DROP POLICY IF EXISTS crm_notes_update ON public.merchant_notes;
DROP POLICY IF EXISTS crm_notes_delete ON public.merchant_notes;
CREATE POLICY crm_notes_select ON public.merchant_notes FOR SELECT TO authenticated
  USING ((SELECT security.has_any_platform_permission(ARRAY['crm'])));
CREATE POLICY crm_notes_insert ON public.merchant_notes FOR INSERT TO authenticated
  WITH CHECK ((SELECT security.has_platform_permission('crm')));
CREATE POLICY crm_notes_update ON public.merchant_notes FOR UPDATE TO authenticated
  USING ((SELECT security.has_platform_permission('crm')))
  WITH CHECK ((SELECT security.has_platform_permission('crm')));
CREATE POLICY crm_notes_delete ON public.merchant_notes FOR DELETE TO authenticated
  USING ((SELECT security.has_platform_permission('crm')));

-- A merchant may submit feedback only for an accessible workspace. Platform
-- staff keep the existing read policy.
DROP POLICY IF EXISTS merchant_nps_insert ON public.nps_responses;
CREATE POLICY merchant_nps_insert ON public.nps_responses FOR INSERT TO authenticated
  WITH CHECK (security.can_access_merchant(merchant_code));

-- Store support conversations are visible to their workspace, but internal
-- comments and mutation controls stay with authorized platform staff.
DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
DROP POLICY IF EXISTS task_comments_update ON public.task_comments;
DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['tasks','crm']))
    OR (
      NOT is_internal
      AND EXISTS (
        SELECT 1 FROM public.merchant_requests request
        WHERE request.id = task_comments.task_id
          AND security.can_access_merchant(request.merchant_code)
      )
    )
  );
CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT security.has_platform_permission('tasks'))
    OR (
      NOT is_internal
      AND EXISTS (
        SELECT 1 FROM public.merchant_requests request
        WHERE request.id = task_comments.task_id
          AND security.can_access_merchant(request.merchant_code)
      )
    )
  );
CREATE POLICY task_comments_update ON public.task_comments FOR UPDATE TO authenticated
  USING ((SELECT security.has_platform_permission('tasks')))
  WITH CHECK ((SELECT security.has_platform_permission('tasks')));
CREATE POLICY task_comments_delete ON public.task_comments FOR DELETE TO authenticated
  USING ((SELECT security.has_platform_permission('tasks')));

-- Persist the immutable Auth subject as the primary audit actor. The JWT email
-- is a display fallback only for non-standard service calls.
CREATE OR REPLACE FUNCTION security.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION security.write_audit_log() FROM PUBLIC, anon, authenticated;
