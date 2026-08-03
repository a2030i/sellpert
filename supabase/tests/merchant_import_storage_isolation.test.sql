begin;

do $$
declare
  policy_count integer;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'merchant-imports'
      and public = false
      and file_size_limit = 26214400
      and allowed_mime_types @> array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
  ) then
    raise exception 'private merchant import bucket is missing or unsafe';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname in ('merchant_imports_select_own','merchant_imports_insert_own','merchant_imports_delete_own')
    and 'authenticated' = any(roles);
  if policy_count <> 3 then
    raise exception 'merchant import storage policies are incomplete';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'merchant_imports_%'
      and coalesce(qual, with_check, '') not ilike '%current_merchant_code%'
  ) then
    raise exception 'a merchant import storage policy is not tenant scoped';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_file_uploads' and column_name = 'storage_path'
  ) then
    raise exception 'upload audit rows cannot reference their private source file';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_file_uploads'::regclass
      and conname = 'platform_file_uploads_storage_path_scope_check'
  ) then
    raise exception 'storage path tenant constraint is missing';
  end if;
end
$$;

rollback;
