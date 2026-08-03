-- Provision self-service workspaces with high-entropy tenant identifiers.
-- The trigger stays inside the auth.users transaction so a profile failure
-- cannot leave a sign-in identity without a workspace.
CREATE OR REPLACE FUNCTION public.handle_self_service_merchant_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.handle_self_service_merchant_signup() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_self_service_merchant_signup() IS
  'Atomically provisions an isolated active merchant workspace for marked self-service Auth signups.';
