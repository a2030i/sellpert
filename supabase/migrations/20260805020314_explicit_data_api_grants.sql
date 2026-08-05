-- Make API access reproducible on projects created with either the legacy or
-- the 2026 least-privilege Data API defaults. RLS remains the row boundary;
-- these grants only make the intended roles able to reach the relation.

-- Edge Functions use a service-role client for trusted writes and maintenance.
-- Grant it explicitly instead of relying on project-level default privileges.
grant all privileges on all tables in schema public, security to service_role;
grant usage, select, update on all sequences in schema public, security to service_role;

-- Sellpert has no anonymous table API. Public legal/auth pages are static or
-- use Supabase Auth endpoints, so anon must not inherit CRUD from old projects.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public, security from anon;

-- Future migrations must opt browser roles into each relation deliberately.
-- This prevents a newly-created table from becoming an accidental API surface
-- on projects that still carry Supabase's historical default grants.
alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;

-- Objects created through Studio and some platform-managed flows are owned by
-- supabase_admin, so secure that owner's defaults as well as postgres'.
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant all privileges on tables to service_role;
alter default privileges for role supabase_admin in schema public
  grant usage, select, update on sequences to service_role;

alter default privileges in schema security
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema security
  revoke all privileges on sequences from anon, authenticated;
alter default privileges in schema security
  grant all privileges on tables to service_role;
alter default privileges in schema security
  grant usage, select, update on sequences to service_role;
alter default privileges for role supabase_admin in schema security
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema security
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role supabase_admin in schema security
  grant all privileges on tables to service_role;
alter default privileges for role supabase_admin in schema security
  grant usage, select, update on sequences to service_role;

-- Function EXECUTE is granted to PUBLIC by PostgreSQL's global hard-wired
-- default. It must be revoked globally; a per-schema revoke cannot override it.
alter default privileges
  revoke execute on functions from public, anon, authenticated;
alter default privileges
  grant execute on functions to service_role;
alter default privileges for role supabase_admin
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role supabase_admin
  grant execute on functions to service_role;
