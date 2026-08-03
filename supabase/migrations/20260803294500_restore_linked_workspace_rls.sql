-- A previous performance optimization reduced the restrictive tenant policy
-- to the account's primary merchant code. That silently hid rows belonging to
-- explicitly linked workspaces even though security.can_access_merchant()
-- authorized them. Keep the init-plan optimization while using the complete
-- centralized authorization predicate.
DO $$
DECLARE
  relation_name regclass;
BEGIN
  FOR relation_name IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'merchants'
      AND a.attname = 'merchant_code'
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_boundary ON %s', relation_name);
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON %s AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.can_access_merchant(merchant_code))) WITH CHECK ((SELECT security.can_access_merchant(merchant_code)))',
      relation_name
    );
  END LOOP;
END
$$;

