CREATE INDEX trendyol_question_reply_attempts_actor_idx
  ON public.trendyol_question_reply_attempts (actor_id)
  WHERE actor_id IS NOT NULL;
