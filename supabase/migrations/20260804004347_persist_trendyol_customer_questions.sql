-- Keep Trendyol customer questions available between provider calls and retain
-- an immutable merchant-visible trail of every reply attempt.

CREATE TABLE public.trendyol_customer_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL,
  question_id text NOT NULL,
  status text NOT NULL DEFAULT 'WAITING_FOR_ANSWER',
  question_text text NOT NULL,
  customer_name text,
  show_customer_name boolean NOT NULL DEFAULT false,
  product_name text,
  image_url text,
  barcode text,
  product_content_id text,
  answer_text text,
  answer_status text,
  asked_at timestamptz,
  answered_at timestamptz,
  provider_updated_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trendyol_customer_questions_tenant_unique UNIQUE (merchant_code, question_id),
  CONSTRAINT trendyol_customer_questions_id_not_blank CHECK (btrim(question_id) <> ''),
  CONSTRAINT trendyol_customer_questions_text_not_blank CHECK (btrim(question_text) <> '')
);

CREATE TABLE public.trendyol_question_reply_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL,
  question_id text NOT NULL,
  answer_text text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sending',
  provider_message text,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT trendyol_question_reply_status_check
    CHECK (status IN ('sending', 'sent', 'failed')),
  CONSTRAINT trendyol_question_reply_text_length_check
    CHECK (char_length(btrim(answer_text)) BETWEEN 10 AND 2000),
  CONSTRAINT trendyol_question_reply_question_not_blank
    CHECK (btrim(question_id) <> '')
);

CREATE INDEX trendyol_customer_questions_inbox_idx
  ON public.trendyol_customer_questions (merchant_code, status, asked_at DESC NULLS LAST);
CREATE INDEX trendyol_customer_questions_product_idx
  ON public.trendyol_customer_questions (merchant_code, barcode)
  WHERE barcode IS NOT NULL;
CREATE INDEX trendyol_question_reply_history_idx
  ON public.trendyol_question_reply_attempts (merchant_code, question_id, requested_at DESC);

ALTER TABLE public.trendyol_customer_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trendyol_question_reply_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON public.trendyol_customer_questions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)));

CREATE POLICY tenant_boundary ON public.trendyol_question_reply_attempts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)));

CREATE POLICY sellpert_require_mfa_if_enrolled ON public.trendyol_customer_questions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT security.mfa_access_allowed()))
  WITH CHECK ((SELECT security.mfa_access_allowed()));

CREATE POLICY sellpert_require_mfa_if_enrolled ON public.trendyol_question_reply_attempts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT security.mfa_access_allowed()))
  WITH CHECK ((SELECT security.mfa_access_allowed()));

CREATE POLICY merchant_permission_read ON public.trendyol_customer_questions
  FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants', 'view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['orders', 'integrations', 'dashboard']::text[]))
    )
  );

CREATE POLICY merchant_permission_read ON public.trendyol_question_reply_attempts
  FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants', 'view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['orders', 'integrations', 'dashboard']::text[]))
    )
  );

REVOKE ALL ON public.trendyol_customer_questions FROM anon, authenticated;
REVOKE ALL ON public.trendyol_question_reply_attempts FROM anon, authenticated;
GRANT SELECT ON public.trendyol_customer_questions TO authenticated;
GRANT SELECT ON public.trendyol_question_reply_attempts TO authenticated;
GRANT ALL ON public.trendyol_customer_questions TO service_role;
GRANT ALL ON public.trendyol_question_reply_attempts TO service_role;

COMMENT ON TABLE public.trendyol_customer_questions IS
  'Tenant-isolated merchant inbox synchronized from Trendyol customer questions.';
COMMENT ON TABLE public.trendyol_question_reply_attempts IS
  'Immutable merchant-visible audit trail for Trendyol question reply attempts.';
