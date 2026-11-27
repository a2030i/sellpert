begin;
update security.sellpert_release_control set maintenance=true;
do $$ begin
 begin perform security.require_current_release(); raise exception 'Maintenance was bypassed';
 exception when sqlstate 'PT503' then null; end;
end $$;
update security.sellpert_release_control set maintenance=false,required_client='sellpert-accounts-v1';
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.headers','{"origin":"https://app.sellpert.com","x-client-info":"old-browser"}',true);
do $$ begin
 begin perform security.require_current_release(); raise exception 'Old browser accepted';
 exception when sqlstate 'PT409' then null; end;
end $$;
select set_config('request.headers','{"origin":"https://app.sellpert.com","x-client-info":"sellpert-accounts-v1"}',true);
select security.require_current_release();
select set_config('request.headers','{}',true);
-- Authenticated server-side actor clients remain usable.
select security.require_current_release();
set local role authenticated;
do $$ begin
 begin update security.sellpert_release_control set maintenance=false; raise exception 'Browser changed release gate';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.headers','{}',true);
select security.require_current_release();
update security.sellpert_release_control set maintenance=true;
do $$ begin
 begin perform security.require_current_release(); raise exception 'Service role bypassed maintenance';
 exception when sqlstate 'PT503' then null; end;
end $$;
rollback;
