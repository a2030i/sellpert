-- A high score across only two dimensions is not a complete store rating.
-- Require at least 60% evidence coverage before returning an overall score.
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
    'case when v_available_weight >= 40',
    'case when v_available_weight >= 60'
  );

  if v_definition is null then
    raise exception 'merchant_health_score coverage threshold patch did not match';
  elsif v_corrected <> v_definition then
    execute v_corrected;
  elsif position('case when v_available_weight >= 60' in v_definition) = 0 then
    raise exception 'merchant_health_score coverage threshold patch did not match';
  end if;
end
$migration$;
