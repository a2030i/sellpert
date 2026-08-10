-- Products use column-level privileges. Expose only the new non-sensitive
-- canonical presentation fields; raw marketplace payloads remain sealed.
GRANT SELECT (name_en, catalog_status) ON public.products TO authenticated, service_role;
