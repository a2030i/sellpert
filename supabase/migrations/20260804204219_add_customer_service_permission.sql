-- Give merchant teams a dedicated customer-service capability without
-- granting access to marketplace credentials or the rest of integrations.

DROP POLICY IF EXISTS merchant_permission_read ON public.trendyol_customer_questions;
CREATE POLICY merchant_permission_read ON public.trendyol_customer_questions
  FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants', 'view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['customers', 'integrations']::text[]))
    )
  );

DROP POLICY IF EXISTS merchant_permission_read ON public.trendyol_question_reply_attempts;
CREATE POLICY merchant_permission_read ON public.trendyol_question_reply_attempts
  FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants', 'view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['customers', 'integrations']::text[]))
    )
  );
