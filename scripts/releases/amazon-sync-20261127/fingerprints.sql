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
 (select encode(extensions.digest(string_agg(to_jsonb(x)::text,E'\n' order by version),'sha256'),'hex') from supabase_migrations.schema_migrations x where version <> '20261127090000') ledger_sha256;
