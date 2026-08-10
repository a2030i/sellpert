CREATE OR REPLACE FUNCTION security.guard_product_mapping_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.match_status IS DISTINCT FROM OLD.match_status THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION security.guard_product_mapping_actor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.guard_product_mapping_actor() TO service_role;

DROP TRIGGER IF EXISTS guard_product_mapping_actor ON public.product_channel_mappings;
CREATE TRIGGER guard_product_mapping_actor
  BEFORE INSERT OR UPDATE ON public.product_channel_mappings
  FOR EACH ROW EXECUTE FUNCTION security.guard_product_mapping_actor();
