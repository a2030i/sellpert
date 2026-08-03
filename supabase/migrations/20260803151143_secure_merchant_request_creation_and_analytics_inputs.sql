-- Authenticated merchants may create support requests and operating actions,
-- but they cannot pre-resolve them, assign them, or forge staff-only fields.
drop policy if exists merchant_request_safe_insert on public.merchant_requests;
create policy merchant_request_safe_insert
on public.merchant_requests
for insert
to authenticated
with check (
  security.has_platform_permission('tasks')
  or (
    security.can_access_merchant(merchant_code)
    and status = 'pending'
    and coalesce(created_by_role, 'merchant') = 'merchant'
    and assigned_to is null
    and admin_note is null
    and resolved_at is null
    and resolved_by is null
    and completion_result is null
    and completion_note is null
    and completion_recorded_at is null
  )
);

comment on policy merchant_request_safe_insert on public.merchant_requests is
  'Allows tenant-scoped request creation while reserving assignment, resolution, and completion evidence for authorized staff workflows.';

-- Reject missing workspace identifiers before evaluating access. SQL three-value
-- logic otherwise turns NOT can_access_merchant(NULL) into NULL and skips the guard.
do $migration$
declare
  target_name text;
  current_definition text;
  patched_definition text;
  guard_anchor text := E'  if auth.uid() is not null\n     and not security.can_access_merchant(p_merchant_code) then';
  guarded_anchor text := E'  if nullif(btrim(p_merchant_code), '''') is null then\n    raise exception ''MERCHANT_CODE_REQUIRED'' using errcode = ''22023'';\n  end if;\n  if auth.uid() is not null\n     and not security.can_access_merchant(p_merchant_code) then';
begin
  foreach target_name in array array[
    'merchant_health_score',
    'revenue_forecast',
    'merchant_executive_brief'
  ]
  loop
    select pg_get_functiondef(p.oid)
      into current_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = target_name
      and pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

    if current_definition is null or position(guard_anchor in current_definition) = 0 then
      raise exception 'Expected authorization guard not found in public.%(text)', target_name;
    end if;

    patched_definition := replace(current_definition, guard_anchor, guarded_anchor);
    execute patched_definition;
  end loop;
end
$migration$;

notify pgrst, 'reload schema';
