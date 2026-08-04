-- Structural guardrail: adding a merchant-owned table or view without the
-- shared tenant boundary must fail CI before it can reach production.
begin;

do $$
declare
  unsafe_tables text;
  unsafe_views text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into unsafe_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = 'merchant_code'
   and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname not in (
      -- Both use intentionally stricter/specialized policies verified by
      -- their dedicated regression suites.
      'account_closure_requests',
      'merchants'
    )
    and (
      not c.relrowsecurity
      or not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.policyname = 'tenant_boundary'
          and p.permissive = 'RESTRICTIVE'
          and p.cmd = 'ALL'
          and 'authenticated' = any(p.roles)
          and coalesce(p.qual, '') ilike '%can_access_merchant%'
          and coalesce(p.with_check, '') ilike '%can_access_merchant%'
      )
    );

  if unsafe_tables is not null then
    raise exception 'merchant tables missing the restrictive tenant boundary: %', unsafe_tables;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into unsafe_views
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = 'merchant_code'
   and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true'];

  if unsafe_views is not null then
    raise exception 'merchant views bypass underlying RLS: %', unsafe_views;
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    where c.oid = 'public.account_closure_requests'::regclass
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'account_closure_requests'
      and policyname = 'account_closure_deny_direct_access'
      and permissive = 'RESTRICTIVE'
      and coalesce(qual, '') = 'false'
      and coalesce(with_check, '') = 'false'
  ) then
    raise exception 'account closure requests lost their direct-access denial';
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    where c.oid = 'public.merchants'::regclass
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'merchants'
      and policyname = 'sellpert_select_access'
      and coalesce(qual, '') ilike '%can_access_merchant%'
  ) then
    raise exception 'merchant identity table lost its specialized access boundary';
  end if;
end
$$;

rollback;

