-- Preserve merchant source files for traceability without making them public.
-- Object paths are immutable and tenant-scoped: merchant/upload-id/file-name.
alter table public.platform_file_uploads
  add column if not exists storage_path text;

alter table public.platform_file_uploads
  drop constraint if exists platform_file_uploads_storage_path_scope_check;
alter table public.platform_file_uploads
  add constraint platform_file_uploads_storage_path_scope_check
  check (
    storage_path is null
    or (
      length(storage_path) between 5 and 500
      and split_part(storage_path, '/', 1) = merchant_code
      and split_part(storage_path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  );

create unique index if not exists platform_file_uploads_storage_path_unique
  on public.platform_file_uploads (storage_path)
  where storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-imports',
  'merchant-imports',
  false,
  26214400,
  array[
    'text/csv',
    'text/plain',
    'text/tab-separated-values',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/zip'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists merchant_imports_select_own on storage.objects;
drop policy if exists merchant_imports_insert_own on storage.objects;
drop policy if exists merchant_imports_delete_own on storage.objects;

create policy merchant_imports_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and security.has_merchant_permission(security.current_merchant_code(), 'integrations')
);

create policy merchant_imports_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(storage.extension(name)) = any (array['csv','tsv','txt','xls','xlsx','xlsm','zip'])
  and security.has_merchant_permission(security.current_merchant_code(), 'integrations')
);

create policy merchant_imports_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'merchant-imports'
  and split_part(name, '/', 1) = security.current_merchant_code()
  and security.has_merchant_permission(security.current_merchant_code(), 'integrations')
);

comment on column public.platform_file_uploads.storage_path is
  'Private tenant-scoped source object in merchant-imports. Never expose as a public URL.';
