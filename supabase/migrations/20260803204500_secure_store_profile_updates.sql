-- Narrow self-service store profile mutation. Merchant employees with the
-- settings permission may update only presentation/contact fields, never role,
-- subscription, ownership, permissions, or tenant identifiers.
CREATE OR REPLACE FUNCTION public.update_my_store_profile(
  p_name text DEFAULT NULL,
  p_whatsapp_phone text DEFAULT NULL,
  p_logo_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
  v_result jsonb;
BEGIN
  v_merchant_code := public.current_merchant_code();
  IF v_merchant_code IS NULL
     OR NOT security.has_merchant_permission(v_merchant_code, 'settings') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_name IS NOT NULL AND (length(trim(p_name)) < 2 OR length(trim(p_name)) > 120) THEN
    RAISE EXCEPTION 'invalid store name' USING errcode = '22023';
  END IF;
  IF p_whatsapp_phone IS NOT NULL AND length(trim(p_whatsapp_phone)) > 32 THEN
    RAISE EXCEPTION 'invalid phone' USING errcode = '22023';
  END IF;
  IF p_logo_url IS NOT NULL AND (
    length(p_logo_url) > 2048 OR p_logo_url !~ '^https://'
  ) THEN
    RAISE EXCEPTION 'invalid logo url' USING errcode = '22023';
  END IF;

  UPDATE public.merchants
  SET name = COALESCE(NULLIF(trim(p_name), ''), name),
      whatsapp_phone = CASE WHEN p_whatsapp_phone IS NULL THEN whatsapp_phone ELSE NULLIF(trim(p_whatsapp_phone), '') END,
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
$$;

REVOKE ALL ON FUNCTION public.update_my_store_profile(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_store_profile(text, text, text) TO authenticated, service_role;

