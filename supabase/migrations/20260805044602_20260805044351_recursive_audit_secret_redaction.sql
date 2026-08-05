-- Audit rows may contain nested provider metadata. Redact credential-shaped
-- keys at every depth so the immutable audit trail cannot become a secondary
-- secret store. Non-sensitive structure is preserved for incident review.

create or replace function security.redact_audit_values(p_values jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind text;
  v_result jsonb;
begin
  if p_values is null then
    return null;
  end if;

  v_kind := jsonb_typeof(p_values);

  if v_kind = 'object' then
    select coalesce(
      jsonb_object_agg(entry.key, security.redact_audit_values(entry.value)),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_values) as entry
    where lower(regexp_replace(entry.key, '[^a-zA-Z0-9]', '', 'g')) <> all (array[
      'apikey',
      'apisecret',
      'secret',
      'secretblob',
      'accesstoken',
      'refreshtoken',
      'idtoken',
      'bearertoken',
      'authorization',
      'password',
      'encryptedpayload',
      'credentialpayload',
      'clientsecret',
      'webhooksecret',
      'privatekey',
      'servicekey',
      'servicerolekey',
      'tokensecretid',
      'accesstokensecretid',
      'refreshtokensecretid',
      'ciphertext'
    ]::text[]);
    return v_result;
  end if;

  if v_kind = 'array' then
    select coalesce(
      jsonb_agg(security.redact_audit_values(item.value) order by item.ordinality),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_values) with ordinality as item(value, ordinality);
    return v_result;
  end if;

  return p_values;
end
$$;

revoke all on function security.redact_audit_values(jsonb) from public, anon, authenticated;
grant execute on function security.redact_audit_values(jsonb) to service_role;

comment on function security.redact_audit_values(jsonb) is
  'Recursively removes credential values from immutable audit snapshots.';
