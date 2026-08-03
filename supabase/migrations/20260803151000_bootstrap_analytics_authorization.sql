-- Legacy analytics RPCs existed before the tracked migration history. Keep
-- their original authorization anchor so the following hardening migration
-- can add the required null-workspace rejection deterministically. Later
-- feature migrations replace these compatibility implementations in full.

create or replace function public.merchant_health_score(p_merchant_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public.revenue_forecast(p_merchant_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public.merchant_executive_brief(p_merchant_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return '{}'::jsonb;
end;
$$;
