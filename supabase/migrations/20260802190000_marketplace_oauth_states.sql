create table if not exists public.marketplace_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  platform text not null check (platform in ('amazon', 'noon')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.marketplace_oauth_states enable row level security;

create index if not exists marketplace_oauth_states_expiry_idx
  on public.marketplace_oauth_states (expires_at);

revoke all on public.marketplace_oauth_states from anon, authenticated;

