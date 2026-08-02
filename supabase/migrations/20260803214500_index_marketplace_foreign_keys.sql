-- Cover marketplace foreign keys used by audit and OAuth cleanup joins.
CREATE INDEX IF NOT EXISTS marketplace_action_logs_created_by_idx
  ON public.marketplace_action_logs (created_by);

CREATE INDEX IF NOT EXISTS marketplace_oauth_states_merchant_code_idx
  ON public.marketplace_oauth_states (merchant_code);

CREATE INDEX IF NOT EXISTS marketplace_oauth_states_user_id_idx
  ON public.marketplace_oauth_states (user_id);
