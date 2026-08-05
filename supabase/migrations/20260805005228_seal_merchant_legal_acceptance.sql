-- Supabase default privileges grant service_role full access to newly created
-- public tables. Legal attestations are append-only even for ordinary service
-- clients: only the database-owned signup trigger may create them, and service
-- processes may read/export or append a separately authorized acceptance.

revoke all on table public.merchant_legal_acceptances from service_role;
grant select, insert on table public.merchant_legal_acceptances to service_role;

comment on table public.merchant_legal_acceptances is
  'Append-only server-timestamped record of accepted legal documents; direct client mutations are denied.';
