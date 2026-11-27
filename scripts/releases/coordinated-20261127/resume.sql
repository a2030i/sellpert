begin;
set local lock_timeout='5s'; select pg_advisory_xact_lock(2701123);
do $$ declare item record; begin
 if not exists(select 1 from security.sellpert_release_control where singleton and maintenance and schema_verified and handlers_verified) then raise exception 'RELEASE_NOT_READY'; end if;
 for item in select jobid from cron.job where jobid=any((select paused_cron_ids from security.sellpert_release_control where singleton)::bigint[]) loop perform cron.alter_job(item.jobid,active:=true); end loop;
 for item in select n.nspname,c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgname='sellpert_release_write_freeze' and n.nspname='public' loop execute format('drop trigger sellpert_release_write_freeze on %I.%I',item.nspname,item.relname); end loop;
 update security.sellpert_release_control set maintenance=false,required_client='sellpert-accounts-v1',updated_at=now() where singleton;
end $$;
notify pgrst,'reload schema'; notify pgrst,'reload config';
commit;
