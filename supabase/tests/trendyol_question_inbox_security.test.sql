-- The question inbox contains customer text and merchant replies. It must be
-- readable only through an authenticated, tenant-scoped policy and writable
-- only by trusted backend services.
begin;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'trendyol_customer_questions',
    'trendyol_question_reply_attempts'
  ]
  loop
    if not (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = relation_name
    ) then
      raise exception 'RLS is not enabled on public.%', relation_name;
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = relation_name
        and policyname = 'tenant_boundary'
        and permissive = 'RESTRICTIVE'
        and cmd = 'ALL'
        and 'authenticated' = any(roles)
        and coalesce(qual, '') ilike '%can_access_merchant%'
        and coalesce(with_check, '') ilike '%can_access_merchant%'
    ) then
      raise exception 'tenant boundary is missing from public.%', relation_name;
    end if;

    if has_table_privilege('anon', format('public.%I', relation_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', relation_name), 'DELETE') then
      raise exception 'anonymous access was granted on public.%', relation_name;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', relation_name), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', relation_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', relation_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', relation_name), 'DELETE') then
      raise exception 'merchant grants are unsafe on public.%', relation_name;
    end if;
  end loop;
end
$$;

rollback;
