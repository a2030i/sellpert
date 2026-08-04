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

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = relation_name
        and policyname = 'sellpert_require_mfa_if_enrolled'
        and permissive = 'RESTRICTIVE'
        and cmd = 'ALL'
        and 'authenticated' = any(roles)
        and coalesce(qual, '') ilike '%mfa_access_allowed%'
        and coalesce(with_check, '') ilike '%mfa_access_allowed%'
    ) then
      raise exception 'MFA boundary is missing from public.%', relation_name;
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

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_record
    join pg_class relation_record on relation_record.oid = constraint_record.conrelid
    join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
    where namespace_record.nspname = 'public'
      and relation_record.relname = 'trendyol_customer_questions'
      and constraint_record.conname = 'trendyol_customer_questions_hidden_name_check'
      and pg_get_constraintdef(constraint_record.oid) ilike '%show_customer_name%customer_name is null%'
  ) then
    raise exception 'hidden Trendyol customer names are not protected by a database constraint';
  end if;
end
$$;

rollback;
