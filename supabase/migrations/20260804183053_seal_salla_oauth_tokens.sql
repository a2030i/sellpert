create extension if not exists supabase_vault with schema vault;

alter table public.salla_connections
  add column if not exists access_token_secret_id uuid,
  add column if not exists refresh_token_secret_id uuid;

alter table public.salla_connections
  alter column access_token drop not null;

-- Move any legacy plaintext credentials into authenticated encryption before
-- the database starts rejecting plaintext writes. Vault keeps backups and
-- replication streams encrypted as well.
do $migration$
declare
  connection_row record;
  access_secret_id uuid;
  refresh_secret_id uuid;
begin
  for connection_row in
    select id, access_token, refresh_token
    from public.salla_connections
    where access_token is not null or refresh_token is not null
    for update
  loop
    access_secret_id := null;
    refresh_secret_id := null;

    if nullif(connection_row.access_token, '') is not null then
      access_secret_id := vault.create_secret(
        connection_row.access_token,
        'salla_access_' || connection_row.id::text,
        'Salla OAuth access token for connection ' || connection_row.id::text
      );
    end if;

    if nullif(connection_row.refresh_token, '') is not null then
      refresh_secret_id := vault.create_secret(
        connection_row.refresh_token,
        'salla_refresh_' || connection_row.id::text,
        'Salla OAuth refresh token for connection ' || connection_row.id::text
      );
    end if;

    update public.salla_connections
    set access_token_secret_id = access_secret_id,
        refresh_token_secret_id = refresh_secret_id,
        access_token = null,
        refresh_token = null,
        updated_at = now()
    where id = connection_row.id;
  end loop;
end
$migration$;

create or replace function security.get_salla_connection_tokens(p_connection_id uuid)
returns table(access_token text, refresh_token text)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;

  return query
  select access_secret.decrypted_secret,
         refresh_secret.decrypted_secret
  from public.salla_connections connection
  left join vault.decrypted_secrets access_secret
    on access_secret.id = connection.access_token_secret_id
  left join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = connection.refresh_token_secret_id
  where connection.id = p_connection_id;
end
$function$;

create or replace function security.store_salla_connection_tokens(
  p_connection_id uuid,
  p_access_token text,
  p_refresh_token text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  access_secret_id uuid;
  refresh_secret_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise insufficient_privilege using message = 'service role required';
  end if;
  if nullif(p_access_token, '') is null then
    raise check_violation using message = 'access token is required';
  end if;

  select connection.access_token_secret_id, connection.refresh_token_secret_id
  into access_secret_id, refresh_secret_id
  from public.salla_connections connection
  where connection.id = p_connection_id
  for update;

  if not found then
    raise no_data_found using message = 'Salla connection not found';
  end if;

  if access_secret_id is null then
    access_secret_id := vault.create_secret(
      p_access_token,
      'salla_access_' || p_connection_id::text,
      'Salla OAuth access token for connection ' || p_connection_id::text
    );
  else
    perform vault.update_secret(
      access_secret_id,
      p_access_token,
      'salla_access_' || p_connection_id::text,
      'Salla OAuth access token for connection ' || p_connection_id::text
    );
  end if;

  if nullif(p_refresh_token, '') is not null then
    if refresh_secret_id is null then
      refresh_secret_id := vault.create_secret(
        p_refresh_token,
        'salla_refresh_' || p_connection_id::text,
        'Salla OAuth refresh token for connection ' || p_connection_id::text
      );
    else
      perform vault.update_secret(
        refresh_secret_id,
        p_refresh_token,
        'salla_refresh_' || p_connection_id::text,
        'Salla OAuth refresh token for connection ' || p_connection_id::text
      );
    end if;
  end if;

  update public.salla_connections
  set access_token_secret_id = access_secret_id,
      refresh_token_secret_id = refresh_secret_id,
      access_token = null,
      refresh_token = null,
      token_expires_at = coalesce(p_expires_at, token_expires_at),
      updated_at = now()
  where id = p_connection_id;
end
$function$;

create or replace function public.get_salla_connection_tokens(p_connection_id uuid)
returns table(access_token text, refresh_token text)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from security.get_salla_connection_tokens(p_connection_id)
$function$;

create or replace function public.store_salla_connection_tokens(
  p_connection_id uuid,
  p_access_token text,
  p_refresh_token text default null,
  p_expires_at timestamptz default null
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $function$
  select security.store_salla_connection_tokens(p_connection_id, p_access_token, p_refresh_token, p_expires_at)
$function$;

revoke all on function security.get_salla_connection_tokens(uuid) from public, anon, authenticated;
revoke all on function security.store_salla_connection_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_salla_connection_tokens(uuid) from public, anon, authenticated;
revoke all on function public.store_salla_connection_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function security.get_salla_connection_tokens(uuid) to service_role;
grant execute on function security.store_salla_connection_tokens(uuid, text, text, timestamptz) to service_role;
grant execute on function public.get_salla_connection_tokens(uuid) to service_role;
grant execute on function public.store_salla_connection_tokens(uuid, text, text, timestamptz) to service_role;

alter table public.salla_connections
  drop constraint if exists salla_connections_no_plaintext_tokens;
alter table public.salla_connections
  add constraint salla_connections_no_plaintext_tokens
  check (access_token is null and refresh_token is null);

comment on column public.salla_connections.access_token_secret_id is
  'Reference to the encrypted Salla access token in Supabase Vault.';
comment on column public.salla_connections.refresh_token_secret_id is
  'Reference to the encrypted Salla refresh token in Supabase Vault.';
