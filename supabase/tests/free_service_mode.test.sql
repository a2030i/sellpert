begin;

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'auto-suspend-expired'
       or command ilike '%auto_suspend_expired_subscriptions%'
  ) then
    raise exception 'paid subscription suspension cron is still active';
  end if;

  if to_regprocedure('public.request_plan_upgrade(text,text,smallint)') is not null then
    raise exception 'paid plan upgrade RPC is still installed';
  end if;

  if to_regprocedure('public.auto_suspend_expired_subscriptions()') is not null then
    raise exception 'paid subscription expiry function is still installed';
  end if;

  if to_regprocedure('public.confirm_manual_payment(uuid,text,text)') is not null
     or to_regprocedure('public.reject_payment_request(uuid,text,text)') is not null then
    raise exception 'manual paid billing RPCs are still installed';
  end if;

  if exists (
    select 1 from public.merchants
    where subscription_plan is distinct from 'free'
       or coalesce(subscription_monthly_amount, 0) <> 0
  ) then
    raise exception 'a merchant is not normalized to the free service';
  end if;
end
$$;

do $$
begin
  begin
    update public.merchants
    set subscription_plan = 'pro'
    where merchant_code = (
      select merchant_code from public.merchants where role = 'merchant' limit 1
    );
    raise exception 'paid plan constraint did not reject the update';
  exception
    when check_violation then null;
  end;
end
$$;

rollback;
