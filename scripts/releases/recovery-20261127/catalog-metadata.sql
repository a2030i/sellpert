select jsonb_build_object(
  'relations', (
    select jsonb_agg(jsonb_build_object(
      'key', n.nspname||'.'||c.relname, 'kind', c.relkind, 'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'security_invoker', coalesce(c.reloptions @> array['security_invoker=true'],false),
      'view_hash', case when c.relkind='v' then md5(pg_get_viewdef(c.oid,true)) else null end,
      'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
      'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
      'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
      'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
      'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE')
    ) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','security') and c.relkind in ('r','p','v')
  ),
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'key',n.nspname||'.'||c.relname||'.'||a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default_hash',case when d.oid is not null then md5(pg_get_expr(d.adbin,d.adrelid)) else null end,
      'authenticated_select',has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
      'authenticated_insert',has_column_privilege('authenticated',c.oid,a.attnum,'INSERT'),
      'authenticated_update',has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')
    ) order by n.nspname,c.relname,a.attname)
    from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname in ('public','security') and c.relkind in ('r','p','v') and a.attnum>0 and not a.attisdropped
  ),
  'routines', (
    select jsonb_agg(jsonb_build_object(
      'key',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      'result',pg_get_function_result(p.oid),'language',l.lanname,
      'security_definer',p.prosecdef,'volatility',p.provolatile,
      'source_hash',md5(p.prosrc),'config_hash',md5(coalesce(p.proconfig::text,'')),
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')
    ) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname in ('public','security') and p.prokind='f'
  ),
  'policies', (
    select jsonb_agg(jsonb_build_object(
      'key',schemaname||'.'||tablename||'.'||policyname,
      'command',cmd,'permissive',permissive,'roles',roles::text,
      'using_hash',md5(coalesce(qual,'')),'check_hash',md5(coalesce(with_check,''))
    ) order by schemaname,tablename,policyname)
    from pg_policies where schemaname in ('public','security')
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object(
      'key',n.nspname||'.'||c.relname||'.'||k.conname,'type',k.contype,
      'validated',k.convalidated,'definition_hash',md5(pg_get_constraintdef(k.oid,true))
    ) order by n.nspname,c.relname,k.conname)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','security')
  ),
  'indexes', (
    select jsonb_agg(jsonb_build_object(
      'key',n.nspname||'.'||c.relname,'unique',i.indisunique,'valid',i.indisvalid,
      'definition_hash',md5(pg_get_indexdef(c.oid))
    ) order by n.nspname,c.relname)
    from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','security')
  )
) as catalog;
