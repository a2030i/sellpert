create table if not exists public.marketplace_action_logs (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  platform text not null check (platform in ('trendyol','amazon','noon')),
  action text not null,
  risk_level text not null check (risk_level in ('read','write','destructive')),
  idempotency_key text,
  status text not null check (status in ('running','success','failed')),
  request jsonb not null default '{}'::jsonb,
  response jsonb,
  external_batch_id text,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists marketplace_action_idempotency_uniq
  on public.marketplace_action_logs (merchant_code, platform, action, idempotency_key)
  where idempotency_key is not null;
create index if not exists marketplace_action_merchant_date_idx
  on public.marketplace_action_logs (merchant_code, platform, started_at desc);

alter table public.marketplace_action_logs enable row level security;
grant select on public.marketplace_action_logs to authenticated;
revoke insert, update, delete on public.marketplace_action_logs from anon, authenticated;

drop policy if exists marketplace_action_merchant_select on public.marketplace_action_logs;
create policy marketplace_action_merchant_select on public.marketplace_action_logs
for select to authenticated
using (
  merchant_code = (
    select m.merchant_code from public.merchants m
    where m.email = (select auth.email()) limit 1
  )
  or (select public.is_staff())
);

comment on table public.marketplace_action_logs is
  'Immutable audit trail for allow-listed marketplace API reads and mutations.';
