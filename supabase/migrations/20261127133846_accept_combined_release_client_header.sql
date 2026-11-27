-- HTTP clients can combine case-insensitive X-Client-Info fields into a comma-separated list.
-- Match a complete trimmed token; retain maintenance, browser and authorization boundaries.
create or replace function security.require_current_release()
returns void language plpgsql security definer set search_path = '' as $$
declare gate security.sellpert_release_control%rowtype;
 request_role text := coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','anon');
 client_info text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info','');
begin
 select * into strict gate from security.sellpert_release_control where singleton;
 if gate.maintenance then
   raise sqlstate 'PT503' using message='يجري تحديث النظام، يرجى إعادة المحاولة بعد قليل';
 end if;
 -- This compatibility check is only for browsers; server-side actor clients
 -- use the same JWT with no Origin header. It is not an authorization boundary.
 if request_role='authenticated'
    and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'origin','') <> ''
    and gate.required_client is not null
    and not exists (
      select 1 from unnest(string_to_array(client_info, ',')) as supplied(value)
      where btrim(supplied.value) = gate.required_client
    ) then
   raise sqlstate 'PT409' using message='تم تحديث النظام. حدّث الصفحة للمتابعة', detail='APP_RELOAD_REQUIRED';
 end if;
end $$;
revoke all on function security.require_current_release() from public, anon;
grant execute on function security.require_current_release() to authenticated, service_role;

