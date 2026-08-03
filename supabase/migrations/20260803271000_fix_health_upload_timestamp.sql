-- The upload ledger uses uploaded_at, not created_at. Patch the already-deployed
-- health function without changing its signature or permissions.
do $migration$
declare
  v_definition text;
  v_corrected text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'merchant_health_score'
    and pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

  v_corrected := replace(
    v_definition,
    'max(created_at) from public.platform_file_uploads',
    'max(uploaded_at) from public.platform_file_uploads'
  );

  if v_definition is null then
    raise exception 'merchant_health_score upload timestamp patch did not match';
  elsif v_corrected <> v_definition then
    execute v_corrected;
  elsif position('max(uploaded_at) from public.platform_file_uploads' in v_definition) = 0 then
    raise exception 'merchant_health_score upload timestamp patch did not match';
  end if;
end
$migration$;
