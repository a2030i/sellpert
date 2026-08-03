-- The cost importer validates the requested workspace through
-- security.has_merchant_permission() and scopes every match/update by that
-- merchant code. Execute it as its owner so row policies tied to the account's
-- primary workspace cannot turn a valid linked-workspace import into a silent
-- zero-row update.
ALTER FUNCTION public.bulk_update_product_costs(jsonb, text) SECURITY DEFINER;
ALTER FUNCTION public.bulk_update_product_costs(jsonb, text) SET search_path = '';

REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.bulk_update_product_costs(jsonb, text) IS
  'Updates costs only in an explicitly authorized merchant workspace, including immutable user-linked workspaces.';

