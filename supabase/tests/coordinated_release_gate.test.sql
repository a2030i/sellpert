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
-- Real browser headers merge the SDK default and the application token.
do $$ declare candidate text; begin
 foreach candidate in array array[
  'supabase-js-web/2.104.0, sellpert-accounts-v1',
  'sellpert-accounts-v1, supabase-js-web/2.104.0',
  ' supabase-js-web/2.104.0 , sellpert-accounts-v1 '
 ] loop
  perform set_config('request.headers',jsonb_build_object('origin','https://app.sellpert.com','x-client-info',candidate)::text,true);
  perform security.require_current_release();
 end loop;
 foreach candidate in array array[
  '', 'supabase-js-web/2.104.0', 'sellpert-accounts-v10',
  'prefix-sellpert-accounts-v1', 'sellpert-accounts-v1-suffix',
  'supabase-js-web/2.104.0, sellpert-accounts-v10'
 ] loop
  perform set_config('request.headers',jsonb_build_object('origin','https://app.sellpert.com','x-client-info',candidate)::text,true);
  begin perform security.require_current_release(); raise exception 'Invalid client accepted';
  exception when sqlstate 'PT409' then null; end;
 end loop;
end $$;
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
