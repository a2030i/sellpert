-- Authenticate pg_cron calls to queue-worker with the project's signed anon JWT.
-- queue-worker only processes jobs already authorized into sync_queue.
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
