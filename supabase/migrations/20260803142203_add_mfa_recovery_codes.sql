-- One-time MFA recovery codes are mediated exclusively by the mfa-recovery
-- Edge Function. Clients never receive stored hashes or attempt history.
create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  code_hash text not null check (length(code_hash) = 64),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (user_id, code_hash)
);

create index if not exists mfa_recovery_codes_user_unused_idx
  on public.mfa_recovery_codes (user_id, created_at desc)
  where used_at is null;

create table if not exists public.mfa_recovery_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists mfa_recovery_attempts_user_time_idx
  on public.mfa_recovery_attempts (user_id, attempted_at desc);

alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;
alter table public.mfa_recovery_attempts enable row level security;
alter table public.mfa_recovery_attempts force row level security;

revoke all on table public.mfa_recovery_codes from public, anon, authenticated;
revoke all on table public.mfa_recovery_attempts from public, anon, authenticated;
revoke all on sequence public.mfa_recovery_attempts_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.mfa_recovery_codes to service_role;
grant select, insert, delete on table public.mfa_recovery_attempts to service_role;
grant usage, select on sequence public.mfa_recovery_attempts_id_seq to service_role;

comment on table public.mfa_recovery_codes is
  'Service-only SHA-256 hashes for single-use MFA recovery codes. Plain codes are never persisted.';
comment on table public.mfa_recovery_attempts is
  'Service-only rate-limit evidence for authenticated MFA recovery attempts.';
