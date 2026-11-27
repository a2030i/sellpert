-- Read-only exact-baseline inspection. No provider or customer data.
with f as (
with routines as (
 select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' identity,
        pg_get_functiondef(p.oid) definition, pg_get_userbyid(p.proowner) owner, p.proacl::text acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','security') and p.prokind in ('f','p')
   and p.oid <> 'security.enqueue_active_marketplace_syncs()'::regprocedure
), relations as (
 select n.nspname || '.' || c.relname identity, c.relkind, pg_get_userbyid(c.relowner) owner,
 c.relacl::text acl, c.relrowsecurity, c.relforcerowsecurity, c.reloptions,
 case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) else null end viewdef
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','security') and c.relkind in ('r','p','v','m','S','f')
), columns as (
 select n.nspname || '.' || c.relname || '.' || a.attname identity, a.attnum,
 format_type(a.atttypid,a.atttypmod) type, a.attnotnull,a.attidentity,a.attgenerated,
 a.attacl::text acl, pg_get_expr(d.adbin,d.adrelid) default_expression
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where n.nspname in ('public','security') and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped
), constraints_meta as (
 select n.nspname || '.' || c.relname || '.' || x.conname identity, x.contype,x.convalidated,pg_get_constraintdef(x.oid,true) definition
 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','security')
), indexes_meta as (
 select schemaname || '.' || indexname identity,indexdef from pg_indexes where schemaname in ('public','security')
), policies_meta as (
 select schemaname || '.' || tablename || '.' || policyname identity,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname in ('public','security')
), triggers_meta as (
 select n.nspname || '.' || c.relname || '.' || t.tgname identity,t.tgenabled,pg_get_triggerdef(t.oid,true) definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','security') and not t.tgisinternal
)
select
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from routines x) routines_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from relations x) relations_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from columns x) columns_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from constraints_meta x) constraints_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from indexes_meta x) indexes_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from policies_meta x) policies_sha256,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by identity),'sha256'),'hex') from triggers_meta x) triggers_sha256,
 (select count(*) from supabase_migrations.schema_migrations where version <> '20261127090000') ledger_count,
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by version),'sha256'),'hex') from supabase_migrations.schema_migrations x where version <> '20261127090000') ledger_sha256
)
select
 coalesce((current_user = 'postgres'),false) as expected_actor,
 coalesce((exists (select 1 from pg_proc p where p.oid='security.enqueue_active_marketplace_syncs()'::regprocedure and p.prosecdef and p.proconfig = array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')),false) as scheduler_boundary,
 coalesce((not has_function_privilege('anon','security.enqueue_active_marketplace_syncs()','EXECUTE') and not has_function_privilege('authenticated','security.enqueue_active_marketplace_syncs()','EXECUTE') and has_function_privilege('service_role','security.enqueue_active_marketplace_syncs()','EXECUTE')),false) as service_role_only,
 coalesce(((select count(*)=1 and bool_and(active and schedule='*/30 * * * *' and command=$cron$select security.enqueue_active_marketplace_syncs()$cron$) from cron.job where jobname='enqueue-active-marketplace-syncs')),false) as scheduler_cron_unchanged,
 coalesce((f.ledger_count=226 and f.ledger_sha256='f3ff95b89dbd0f58380a1e47261d24f4e242081481976268f92b26272a055dc2'),false) as original_history_preserved,
 coalesce((exists(select 1 from supabase_migrations.schema_migrations where version='20261126120000')),false) as prior_amazon_history_present,
 coalesce((f.routines_sha256='83ec64606c39adf510e5864512f05ee534ceeb40f32d9351de76c1db9cddfa00'),false) as routines_unchanged,
 coalesce((f.relations_sha256='593f46c325ee07fc719d4fa97c847fa6141df83bd39988e6a456276529dcd9c8'),false) as relations_unchanged,
 coalesce((f.columns_sha256='63c186b7ebe4857bfdcd57d46f0740fd3eaad02c12f8d63a6e4540795e03b5bb'),false) as columns_unchanged,
 coalesce((f.constraints_sha256='22531e004004f61b12dfc05f7cd005a7d4dfd366bd38076a53831651934b41bd'),false) as constraints_unchanged,
 coalesce((f.indexes_sha256='b30a3f0730a72920b4baf68be144f9f489ad54d35c4ae5b36a4712763d959564'),false) as indexes_unchanged,
 coalesce((f.policies_sha256='2670f0b0677b1d335f7e160d5ee8a21f2941cd3185b649ee9e5e01fdef553efa'),false) as policies_unchanged,
 coalesce((f.triggers_sha256='0de620e46eb45f31d1c3113d22facee6ab93cf6fc33f860434ab6ea90ce3eb9d'),false) as triggers_unchanged,
 coalesce((encode(extensions.digest(pg_get_functiondef('security.enqueue_active_marketplace_syncs()'::regprocedure),'sha256'),'hex')='6087384485f9159a1c4e94838f8558ce764c78c250f691047f56baa1cf79f882'),false) as scheduler_exact_definition,
 coalesce(((select count(*) from supabase_migrations.schema_migrations)=226),false) as total_history_expected,
 coalesce((not exists(select 1 from supabase_migrations.schema_migrations where version='20261127090000')),false) as new_history_absent,
 coalesce((not exists(select 1 from public.platform_credentials where platform='amazon' and is_active is true)),false) as no_active_amazon_connections
from f;
