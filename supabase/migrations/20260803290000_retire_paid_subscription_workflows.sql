-- Sellpert currently operates as one free SaaS service. Retire every automatic
-- paid-plan transition while retaining historical billing tables for audit.

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'auto-suspend-expired'
       or command ilike '%auto_suspend_expired_subscriptions%'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

update public.merchants
set subscription_plan = 'free',
    subscription_monthly_amount = 0
where subscription_plan is distinct from 'free'
   or subscription_monthly_amount is distinct from 0;

alter table public.merchants
  alter column subscription_plan set default 'free',
  alter column subscription_monthly_amount set default 0;

alter table public.merchants
  drop constraint if exists merchants_single_free_plan_check;

alter table public.merchants
  add constraint merchants_single_free_plan_check
  check (
    subscription_plan = 'free'
    and coalesce(subscription_monthly_amount, 0) = 0
  );

delete from public.app_settings
where key like 'plan_price_%';

update public.merchants
set permissions = permissions - 'view_revenue' - 'manage_subscriptions'
where role in ('staff', 'admin', 'super_admin')
  and jsonb_typeof(permissions) = 'array';

drop function if exists public.request_plan_upgrade(text, text, smallint);
drop function if exists public.auto_suspend_expired_subscriptions();
drop function if exists public.confirm_manual_payment(uuid, text, text);
drop function if exists public.reject_payment_request(uuid, text, text);

revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.payment_requests from anon, authenticated;

comment on column public.merchants.subscription_plan is
  'Compatibility field fixed to free while paid plans are retired.';
comment on column public.merchants.subscription_status is
  'Compatibility access-state field. Use only for administrative account suspension, never billing expiry.';
