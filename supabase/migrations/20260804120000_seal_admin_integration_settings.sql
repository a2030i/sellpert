-- Global integration secrets are managed only through a service-role Edge Function.
-- Authenticated browser sessions must never read or write their backing tables.
REVOKE ALL ON TABLE public.platform_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;

-- Salla store metadata remains tenant-visible, while OAuth tokens stay server-only.
REVOKE ALL ON TABLE public.salla_connections FROM anon, authenticated;
GRANT SELECT (
  id, merchant_code, salla_store_id, salla_merchant_id, store_name, store_domain,
  store_currency, store_country, store_logo, token_expires_at, scope, installed_at,
  uninstalled_at, last_sync_at, sync_status, orders_synced, products_synced,
  created_at, updated_at
) ON TABLE public.salla_connections TO authenticated;

COMMENT ON TABLE public.platform_connections IS
  'Server-only global integrations. Secrets must never be selected by browser clients.';
COMMENT ON TABLE public.app_settings IS
  'Server-only application settings. Secret values are write-only from the administration UI.';
