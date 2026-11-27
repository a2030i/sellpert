begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
select pg_advisory_xact_lock(2701123);
do $$ begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception 'WRONG_RELEASE_ACTOR'; end if;
 if to_regclass('security.sellpert_release_control') is not null then raise exception 'RELEASE_ALREADY_STARTED_INSPECT_FIRST'; end if;
 if exists(select 1 from pg_roles r cross join lateral unnest(r.rolconfig) s where r.rolname='authenticator' and s like 'pgrst.db_pre_request=%') then raise exception 'EXISTING_REQUEST_HOOK_REQUIRES_REVIEW'; end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>227 then raise exception 'HISTORY_DRIFT'; end if;
end $$;
create temporary table release_verified_snapshot(digest text primary key) on commit drop;
create function pg_temp.assert_release_catalog(expected text) returns void language plpgsql set search_path=public,pg_catalog as $check$
declare observed jsonb; normalized jsonb; actual text;
begin
 observed := (select jsonb_build_object(
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
) as catalog);
 normalized := (select jsonb_object_agg(section.key,(select coalesce(jsonb_agg(item.value order by (item.value->>'key') collate "C"),'[]'::jsonb) from jsonb_array_elements(section.value) item where item.value->>'key' not like 'security.sellpert_release_control%' and item.value->>'key' not like 'security.require_current_release%' and item.value->>'key' not like 'security.freeze_release_writes%')) from jsonb_each(observed) section);
 actual := encode(extensions.digest(normalized::text,'sha256'),'hex');
 if actual<>expected then raise exception 'REVIEWED_CATALOG_MISMATCH'; end if;
end $check$;
create function pg_temp.assert_original_history() returns void language plpgsql set search_path=public,pg_catalog as $check$ begin if not (with original(version,record_sha256) as (values
('20260421195927','de7f138d5a12128500e8cbeb3ced6419f2f1d08b7da8252a21bef2b33a2451dd'),('20260421200308','835997c07092b988f4d90ada621fd35460638d206401bda4bb9205eeaa5eda19'),('20260421201425','d1bb58f2fe57dccc07f68a963822485e66c59df1a02d9c2a5b77166c253fcb9e'),('20260421203538','4370a940f1eed99c6753c41dffa5b8af8daaa702681d26dd8304cd0f6eae752f'),('20260421211449','b3d8bba8168ed698fd4290478e05da19aa7260db3d109be65cd22201b8013c24'),('20260421214033','bf89f780c1de58d5fe32272df7b81661ca77fc27ab11fb451150680518ce0fa5'),('20260421215704','5ccfde784b03a4b4426214de7980fddcfaea020400a530fcd78a038da6dd80cb'),('20260422070356','03e670dbb8add40985f4f6e0fc70f3422afa908c61012050bf5236bf66ac1075'),('20260422071505','f993f44b63968099999c840eebd6377f1d8c8aee0c8c000a7632f7f1ff4f0893'),('20260422072236','c608fa344ca2d0138a5250514943ab458bafdb00a12088332021b7d197b55751'),('20260422082845','9d176bb9726a7a2e6cf2d7afe01f8fce7014b3f37cdc385611c238b037b5a4f1'),('20260422084413','cff1007b28859c6e9078bbd1447af0de9696ffcfd68aa99e0f86618c1a138b78'),('20260422084715','2f34ce9f74373ee2dbf7ecc73ae19ddd7b3fdede1013d4fec8e507f2f7bd29f6'),('20260422090930','b586de0f13966afb54dc1e0ba5bd74e51e3d8fa1f0641abb32bab6bcde8a512b'),('20260422091721','954715f20917d4c1816513574d54ea758a04d53586b237bd25064a32082326a8'),('20260422092439','aa8d4b40b97b9f900287c2984fa266173dd0eb744c8877bfbbdf3d1971e36640'),('20260422092516','aa06faaf7a3aae579578b88b8cf1adef8859d76cbdfbe52294dc7bb4696922a6'),('20260422093040','966e16265bd50b788e515549a2510604de7342858a2962c7c71379f56d582444'),('20260423070019','dfac30631741a971375e745e60a071dc7bf0b6e41503e5420ea0aee8edccff7e'),('20260423070030','a48300350b6e086af75b203d566c44d9afcc3219af070268931ca26987338094'),('20260423081804','d1690adb9ac11d47ebeea8e4a48dd8b6dc9625604d7505ac20a79d428d7ef8bc'),('20260423082356','dd1e9f2a923a780c20871c3bb258cb24cedff553ad3557c145426bbb3556d7ab'),('20260423100401','c833f0746d62cad4502e65bbd6b2ae683bc38f6256702820d4ea9da833d1be57'),('20260423101103','98f36bc2628afa8374a5e2245240da41bdc21e3939277c8886c2fc52ff4ae4b9'),('20260423101156','d14581c78f6340e77e1331e994e2d6f38f817a97d8fac20813ff98078aa3fd2c'),('20260423134245','c0a98084b2a57e403e139f28ab9e5e201b19eb1067e08004eeb9a27d71ce8d82'),('20260426104327','96d37ca29e9c4a9c0174f2cccaa90bb08c9b719bd315836fd4f3252886748007'),('20260426104608','9c5998a649be2f30b50df5fcf7e3a7f7b3221b53522d893529dcb329ce669528'),('20260426104803','4c2dc756a1392688d92af2f9a4ffb2bf0957ff79a9a5031e410f91757d42e672'),('20260426104950','5287f9d8df6871cf748e2cd4a54ec61947f5cb497c713795838522e83acf0bb3'),('20260426105911','5d4d915444ce5a018b3563a248701a67984bd6a83b629b4e6fa5c1b982da7834'),('20260426105919','b9622b3ed17dee39b39a20031c3a2862dba4ae64241f7d9a6d54ddd15ef62303'),('20260503181110','3b59a9a06ce84a646435a958d2620ea44411259908237d7959c6e1a6ab115dfc'),('20260503183753','46cd51ff091a62ac2e117925106dc4b85538afe3c22e1da90780561987cb6b9b'),('20260503184237','4d8e0713468baa11e8396d1436a40be5069c1c60db34d08ed8918ef9518c3134'),('20260503184448','eea9607867c9ecd115bfcf64d45a9e32317f5872bdb59da270b48390ae419e77'),('20260503184722','ece35d68c30c96032a96b4a436e5c868f6a99ddfddebbcd473ad7a21929484b7'),('20260503184742','040822dc5cb744364dd9f2d3af21158838ab061ce3fc55c8e4f07d71ed0e69ea'),('20260503184801','1b6018d3da23cee282ed9eb35981eeb8033c550a971ca1d535b526e4a3e1fc93'),('20260503184813','73df1d277dbe23f0c42b4f4cbf373d1f9f0ffc6cdc3b5ae6b9c125a94c2a7673'),('20260503190510','c4144eea07736aad3c244466d37f2a47e190f67809e1b37d6402cc175df20dd6'),('20260503193014','89ebed7c938edd483799434c3585b3fe9076552f1d2aa74fea50527f99d46db8'),('20260503194139','8adb8327567af4d497c67c3dc27c3d313be1e2f56f84b566c1255c5e93350761'),('20260503194926','1589303c82713b683f915f5cf04327368d85a8356e0d2c1b5e0bcf55d455ab76'),('20260503195823','95b54f8ee7769c0522d5a48e6947735f6036df9873c1c1d2bae06a61652a8889'),('20260503203528','bdc933bd5abfc52f4e11a3fc50eb3e9f889abacd51baed34abf56df31d5c7c95'),('20260504070653','4a77fb21e37e0c0d44bde100e06694d66984a210052eabe14b4478a63ea1dd00'),('20260504071128','6010926d840ee6b67af73249a780afe939c15f42462cf9220b319abfd7aefad1'),('20260504072507','41c7de7b4466ede1ba16232cb2b3468e0b68e324dd15bd0a03d8e1ba20d1d907'),('20260504074253','a040bb4507dc9a59da18c249f4989249ac23cb3438aed6024ed55509413832e5'),('20260504102733','090eb44b85de770b41e49f4f962b601a3875ac28a5b7d23c4a58d4b4e8572d04'),('20260504105310','bb57d3cb9e2024895274ab2111b701a081972ea6ce8850531d5c487430b90a7f'),('20260505100846','38f964b62d00c2f17ad3f1a5d716b2dcabda506e324b3a4710cd4ad8a14c8ffa'),('20260505105041','eed56beec3668e5e37c6b5df4f0727b70003fa2df74824c7cf4f6bce12e0df8d'),('20260505110139','9262a0b23a1d21b4c09e75b3f3deb5ee57400b4c904e99138e93993471c36139'),('20260506102811','5f14dd1ec46b7543fdd959e2945bfce0b66ac247b1503de213abf9c95c785cd0'),('20260506115408','ef338b5e415a6bacf87240209679b5ed1e49de1f5e02b57d01152bf09a14c278'),('20260506115726','134bc9842a4d9f61700b3062a81549054624ab53cabec212ec5690346375d62d'),('20260506115853','2e6c2d75587cd94b3a4ee7bac9655b1934e1e1cf555cd3c0ee241dd6ae120011'),('20260511070703','0da95ed7e4f1925b99b87e82de01eeaf2eff7676b535949c1e9ed77145bd740f'),('20260511072038','7307d1f7907be70136cb48d55355cc2926eeff8918cb92fff83b112d13301392'),('20260611030347','b9203127fcb4b5c119e30df196bafc0df8e683d460ec43d13e08b2c5104cc847'),('20260611030950','dbe18100e8658139eb13d92361912ecc5a062a663556c660d89439b4c5e6d2a7'),('20260611034048','0ffd2a4b859cdba7fef6ae54a1b4ff401fff3978ebfeff2ad58ba36a74ee045d'),('20260611164657','4358d91ffad74ff36e7d278ab96a363d7d9de22671f549e5c53f3b021514659e'),('20260611165136','3a96ac7e0b49149e2b4eb8f8c7a44fd41efa6ce4b2df389ee1868cf843d83a79'),('20260611170459','d2fefe752afa87744376004ce3df7d08ac007f5478994044c28ee5a65bad588c'),('20260611173758','c1819c6404eeb39f175d56ff677a6368605cbe46618f4dd44d81e22b46c28103'),('20260611173915','3a1e918b315c47cfa4845c5dd406e36ac6d49ef402b41974a2184131a20fb398'),('20260611174455','39956e970585a8d0a43df86c349d8f870dbbfd29b15dfeae9eff942d0d00f706'),('20260611174524','b5b562f9568fd68e9331e0a826dbfca0da86dfc5f5325e57f0eb8b504cac3d01'),('20260611174724','532589245d25a3d61528d235b25e43c5b600f7217a8095eaa8b4f3202067d45f'),('20260611174756','af3d63e7b4ae6de97c8c564a0e7421675489d9e3965ae90a7a211ff560d5a6ab'),('20260611175018','c0cb7853f14bd7003d4f87d6c202713ab1e56be5e2bebbfb3375f996798a4d46'),('20260611175155','45fd75717f595c89475ea1557b7eecd5ccdccd90a25930859e4c6ab600b20d94'),('20260629083406','7a61198566bf380e1a9a0acf3a5cc0719754e83d683f6ecc5e61b6b75476ded0'),('20260629083628','c3a4dd518c99a4b2252126a4a364e47aea41e88900d631b020211e1c33054a82'),('20260629123545','fe43d41a8e78741321f0175b664bddadeaba18a36771e00ebe4beb17e56ae885'),('20260629123606','ab39527389423ead3c2c664672d53283fb70f2fd5d49021bf5b942a61e52a91a'),('20260629130028','6fcce2e4900634be7731a6213534d2fe4f9a73ebc210cba8105ea0fb5f4af6b0'),('20260702113138','f2eeec16d3345d605d0978a3b43437dd4fb139921d8284097e36e7038326f94c'),('20260702113328','315533fdcc4eabd8dc541247df6f37be3a3bbf99fa1018e28114f6b7752c9054'),('20260703154150','ca0716fd9ae695c0772d1189244d97a5e9ad582e537b4dbbb79e51808fee8443'),('20260703160937','5b53e4c454e209fad4d9e777ad8c305a5f265aed6018587fd5223b158b6a54ac'),('20260703162554','a296d1f0dfc2af9df31d1787bcf2e2ff7b4b51d919bbb1faa11b4490861f870a'),('20260802084027','d1d8b1dab2e8ba1e857960023cae74d4f45f43f9ea956855cec8b66ffeb56798'),('20260802090108','35ef8dccc074c87fdd58176f9740b200ba89554e130eb2a33a226bcd9885f14f'),('20260802105311','2d872bf330ebeeaeadcf25c8162f8f60b178574d73f33c1bfd31b20e9287b56a'),('20260802105336','b2e618691fbd156470dfe9751eef058a4f6ffc16a454139b86bfffe8a291ed0e'),('20260802114352','3e488f09fd6a65f8644299e6d05ad752942323e9ab1d08fc7fba715b9a5baa36'),('20260802120442','daf245266dd81f73cbd2c1a3f1301c8b58ed41cef0ad162e85dc264e34708162'),('20260802190931','82d1d5012435af10a7820158576ba3dfe3370d84c604169e96d915558d861a50'),('20260802192845','14d0375a9ff40be6161e7a371065c2cd9ea7cf0774261879a36dad567827ca13'),('20260802212917','4535f51f4af8bdf1b3069611b10ea882b562d0227c5f1eb033f16b7418c32ea2'),('20260802213400','43bb2df4ab039b0af49e6a452fd4ac10dd5da96366514cfb9364f87a8c785267'),('20260802214246','ae158ff6d513db3d8a7061370e13d42c170605f822e4f3e796d36f13adf32d7e'),('20260802222006','421ffca4cf332f94e25f97007cc6ee98e5f95b9e7e519f6fd2a0dae35978a00e'),('20260802223158','c308fe47a52d53f2794b094c838e82b71e50ac8d472af2707bdf7fc9e166ec6c'),('20260802230200','cf8c11b9234a3f5c39df5f2bc958bd51fec7e5234cde425d3538fca00bd53160'),('20260802230413','f58eb0128abe743f0c8cbe16feb76a25ff639b71cb802f602a2147463284e585'),('20260802230707','a69d8f19e17092084dba367c1d2a3e359f26fca8f4648073590123d985e93268'),('20260802231147','f0decbd43dcae03de8941329476700894de10695a8b49ea881c52a2024800180'),('20260802232151','2452395b2c85e4cb9f8c5b3aadb709e502e3c0502dbe6f9e5ebbc254832e40b1'),('20260802232457','ffcfff5c0f87d97a0a0a4a0524d34dafc6fb39ca72b132ff1f6a5ab055c18ff6'),('20260802232758','b8eef979534b7ad0d1dfda639bf509f78754e6829766a403b1b36b5280f8a05d'),('20260802233512','a46cdaa1acd6952f552a00dea7a19503068798563a3183f3360c7555cc30a391'),('20260802234321','e4880092ac9817d7922e5ea133221dd91f97c6b7b330af88a893f2875d4b3bac'),('20260802234350','0c9a23c2dc4b6b89962e2401d58ae1330c5d5d5833247ee207815c902fc70575'),('20260802235000','cd0e6dca6c4d7463a635a478a10478d2c62ebb99279eb4aa2a40e3119b9ada24'),('20260802235559','088455582e999e9c253599bcecc35192a86b2d2424592ab35f26366773dfae1d'),('20260802235730','881944f6cb59078e8998820e279fe3a7b1c38e6a6467507f534ad8746c8e2f48'),('20260803000347','d08d8dd4abe148a28fc316c818e75f277593885bedf3c00aa15bf454c6d0c7bb'),('20260803001056','99a8c2959395703996a2aae2aba3703e8aec8876c30cf2b75d7d3ff85e4966aa'),('20260803002450','dd8821aaaa5c91c83af20d19fa5bd405c340d656996459c865bc00ab8d06df6b'),('20260803004835','112aa9bcdbf97a369b1d49856809b550612b510e7b57add420608e6e7753e2b3'),('20260803010053','6a809353defa85f28cbe8941dd4d5634beae5df5ced751ebb51f77da26ace55e'),('20260803070139','05a58aefaae69c6176ccb244e05f86689caf350d9e2d1beeb42979f9228f3a06'),('20260803070951','5dc1b7e38fb83ec0c95148dc47471236ce57a11383038e68876e2dcb64a87c71'),('20260803071350','1fb742e544b6a16f8a174688e61ecd70f353340f03de8d299e9fc4fc56091ccf'),('20260803075532','56838f927118b7d1cf52718072a3db292158b51c4a4c2804cf0e0f3885c0ca85'),('20260803081314','43a262ce447f7e7f590f37fa555e0689b79b4d10c7d65a6c7f1d1401a08424e1'),('20260803082211','570b6f8ebcec701cf6f9aceb8ad9a92152a73298601a894f853408b56e192da7'),('20260803084926','163d0b89c5958022a5a9a6f6d22c001fd7f12b32347325075b8db6a3bd1c3c22'),('20260803085056','3181c83922ca497c47973f0c521e4f58801f2f9e4b4d1c89d45016457846959e'),('20260803085636','2d05272faf24cd89dcdb0719e4b345ef7c30210f374fc6767a2027873b3d5d0b'),('20260803091205','f5ef82848e77e5f690feddf99c62a49f587f7eabe09892637652914a3ee72fa3'),('20260803093009','628e71436f776c449ded83812bd6ac3a027eb71b20b38002c79a735d14ae13e2'),('20260803093552','9a4ba3f8c72b8e84df0108e0ff5c63e03d0cd197cd953699c9fe7f05b8df4321'),('20260803101647','b79ee8abf18d3c0ede53d9c260f31bf0307e03a9860f487cef1f61e7ac8acc48'),('20260803101912','5ac70c7bcdb2bd03e3c57f88b5ca8cb47747ad57206a70f43685d907b558ea2c'),('20260803105926','b1a479a82daf75a290f086030667c741d6959bb7e598156fb59170e5f37244eb'),('20260803112532','44b4c0f78f16ed7eca1c694e5b2c10d62312f8ad3ec3e6658dc2b6d82b3b6e8a'),('20260803112636','c263ae62fc7cf3215cd5df1ecb1d72e76f63d4f370cb191cf0c18ade7c544971'),('20260803112845','6660e843b921723f2395686a2644ef3ae6e81af49826ca160091b9457cbdc350'),('20260803114421','93511d8ce03a901c05024ba213f3ecfea6fdac2dcb316e29b2cab56d8a23bddd'),('20260803115747','5c9b75d180e43b0c763a85d150ec8107c646ca3a41f8871a2753104e94035e51'),('20260803115920','6c25f018087453f78cf9bc5839c83f452744dbf2ce4cd20a3724f9c13114b183'),('20260803120103','e376c8df28af03ae16e8abd2b92c4e36cfff3fe215f0cc216ac46ae4d82b8730'),('20260803121521','926e99f527d6de230a8d085b36bd986474fd0373a430568866f99f08acbf017f'),('20260803122528','3182166561d85ad80548b4c6c52b04e2f3d44276e3bcce572156bc8c961e21ce'),('20260803122857','94402157a2057fe9e039830752fc53f144fd830a4ce696bb2f2655a66f0cee48'),('20260803123024','4d3db773cbc2d9bb71a2c6f81b9a57717e685c4d6d771b05e8e12bd78f065430'),('20260803123633','a5468b0633e0b0dbdc58b20545b1c4f6b4e45ebc06718d9a9ee44167d381b94d'),('20260803132107','1adbf2518d87a6322150b38ce0cb74cc01abb8fb3a79192f0bc50ffa835ed317'),('20260803134548','55f0d864b2c7318837d74b28d4671b839fddc02fc97a2f1fff835590a2e3d699'),('20260803134711','73ff7b265ea3b81d17c80ab3fd1098dca87677b1ff63601017a67a54960ac459'),('20260803140908','bd354597196d27ab3874ebef6c1e6632bbfe9ed75ea4f709dc9e0cd4c776db81'),('20260803142525','270a2e4476a44fd25e723b401668d33f94c4bf11fb7b363b37c71926e9e07fa8'),('20260803143236','6d66bbd6582440611ccbf22af09b3d1b9ed3f7d0e8356f1cdf837cbe3f611d5d'),('20260803143429','3a1d304886641a108b253e00187a36cf316713dd5a0e48cc228196df2dc240ca'),('20260803150136','12447ac7a98f9643a52d868eb1adc10c0806f283181e79b08d269d6e745de815'),('20260803150503','f6efb053578a6b16eb8811e407e3577f64f8a349f4f4bfd668c6e429d73aecad'),('20260803151308','5995ee0a3368be5219302208ec9a07a01a9e4b9b57892ddac357203851426acc'),('20260803151458','0f96197e4002de5d950264e3ef2a051bc847c4d07d3dbfdcedd5919da2ad51e7'),('20260803155807','67276e3d14afc28f608ef3c10bb03159691a559ca713e5d9d6b2dab8f942a0ca'),('20260803160001','c80e5b574705853eb24cbbc77469e06ca96bdeb954de3999031d298e28ae9fba'),('20260803192454','fcba9254ad433937da9ad9962f1e46b840ea4018664514ace86721c9aa33af79'),('20260803203045','c46a56fb6109bfa40d4ffa57f355c61459ff78817ea8b4859a81a3374117da29'),('20260803211416','cfdf454914fd8098b06ee4de689ae05833aa6d71b62b2229ae3e897fa7766dbb'),('20260803225443','a4170b19e1a09ec1f2e043b5ce243ff57ebbf82175940685025e9412ed34adf0'),('20260803225638','b3f0306bc43d14272057e6065ce3550fa953dcf7f10cc0dd7ad07d4a3faed52c'),('20260804001113','1f06fb6929ba4a99b6ca3f84d37025c1cddb0c773f1a65dc051e32c21e462e2f'),('20260804010150','04a21ea2dffcb5c59f65232352cae0a6404960ffc1299d78dc810071ce9a125a'),('20260804010727','b9ae249a3907e1693c9a2a5fb924fac1366df3b5d0de06f11fd00aadebd0c01b'),('20260804020728','71d76c01e6aa934a140a2c0b1cb7d624afb3e6d151713d857b75b035314810e8'),('20260804140633','d4c8fcef9c36d8e75adb16d083f0bcac7053e8f8ec09e2cedfae64ce3ec29b1a'),('20260804161739','5bda6af2b46cb17f4bc9b093797fa0b222160b82705dad4d57332edf3898ae82'),('20260804171459','13e925dcb95fd369dde7be8702c3142bd4f37e05e63a99d6e17fb3d644038e34'),('20260804182016','c17bea676a38296aec3a31ce7f02d5b4469fdca97bf06507ffcd2323f7a81ca6'),('20260804183920','43868ac5bf524cd44425db5d442cc6c3f5a5e047d1789bc8d1be9ab89287b6cc'),('20260804204915','f3d03d1a5ea790b86ec76b3e3838de040c14c12a452a863db2d7654956ff6b2b'),('20260804213922','91a0404e012422e873b8c5cab515fe5a9b9e98a588a53823caa46401cee01e23'),('20260804214044','094b6f59576f8f1c49cc1e112631a087849c4fba9a5db868c6f1cbff38e6326e'),('20260804214122','6ed316e450d84cd8665d050fe590d0816bc055d515aed6577d74f14a0a967f23'),('20260804215755','dbfa258fe0737e39d6be72d9eac828d886c059f83f5ffb383820540fdbca6309'),('20260804220446','25b603e304edaacb5d5823a520b7c5b1686d159523d7190e06b8c5a5f37a7c40'),('20260804222039','de78924a367c23598dc8eba510326c8dfdd548ff2e879b54cf2e95e1d1495798'),('20260804223348','a2e64c8c833c0729e29c8443897d7e166ad44871aa4d4df2ea995ab2996b7564'),('20260804224608','a3e1a19c94a25aa9835732efe3a5e37d2e37554f18f66494de53437eaee85b97'),('20260804224934','e8a57a0301c9ef790ed6764711273a511c3def933bfa6e3a36506d4c2b43374e'),('20260804225217','72fb259f32c7400e25774c89141792e1f230733cfb20f148a72dc13c4fcee1cc'),('20260804231658','6e5774d4bea2abdcd64f0e94db166894925a43b88222eda23ef203766f1c3044'),('20260804233425','5b9a8e6883c7ab4a1e11668808d7bbe869bec9640cd4f7be8279361ed31957c9'),('20260805005126','ae535d925c2dd38bc3dde58ed768b59a8c9ddfa38631cc0d8133b72574a5b47c'),('20260805005309','f225482b95f9e79e55d3559df0fe0b5e95909a4db4a6b02b99147f5057808256'),('20260805022434','1039df6352d051967e805549334c0fde622b3c8f49688af858b9c78991fb6fd0'),('20260805040550','3d32b7a383024fc476c3094c3d79a7bffcf350b80fccca641637e5d7fcbed855'),('20260805044602','f5d9fb4c8a2f8fb84c65304a194f9ffa4b0219768c708c62f498a3c2be101ce0'),('20260805045249','e511c9132e43b188b3570ca789ec7bede1137b71737d0df7e7492dc767cf6727'),('20260805045452','2b70eff96d1b435edb0e65b472bb37a170d73328c4e59dfeac72428e19e5e4c3'),('20260805051051','a2add7452942963df9d7925d66d0e7e960e5f106da6333163152289fbf0ae605'),('20260805053154','3bd955f2b1123bffb92a954d3c9b0c8ed14fc7d3647f83e0213f9cdcfd1dc18c'),('20260805054801','0e45aebd46ff3d410a88617fc4139bf257b62801ecc377743787db7d7cc56d76'),('20260805055352','bdc08268de1471cbf2a73d2a518c1b71ed1926204c17e2cd19703b5d9bdb3526'),('20260805061437','c1e8079e4d743dbb4df4cb9109b4f95f7aea6ed38eb2a20011495c49433d46a2'),('20260805063525','c51abbdca6d8d9cf5fa5034595cf54524a8bee117cf9cbc3594ec8fe038547dc'),('20260805064011','df228e97bbdf0ba1e645276cb40e4b22976a9841d5c6d36f34645aad051d6f3d'),('20260805065703','b4f13453a3aad2cff6637c1cd1a308908c067ebba47f329bb8dec6d39cafbdc5'),('20260805071150','cb268fad181ee04e19924cd42cfda9a055a6a410a6fae817f4a950489d9c0bc2'),('20260805071535','1b745d355043a7ed92f79b737902e5b67af86b05f5323bb220cd90cb9b5e06c0'),('20260805080213','32328bf9d21510c9f951339a091e233405911260cbf0bb2476cf8df2b5435359'),('20260805081943','f5c516fc89b581fe32b53f79567de526ccb65e7d45e13d5cc9c1e1f31979bed2'),('20260810110658','3ac75b0c5fe66ecb21e397896490870d4ca25c93b1bc0142c5c13c85f43df8c0'),('20260810130539','443d2fd8d571b91f5588d41b9ea9fe6b2083c02babec786244b2e4577f8ed745'),('20260810130631','ffb28ada3f769e79b3da5549da7e0b3b562e013226ce287a142ea1a806e1961f'),('20260810132146','eeeeb6bcf261aa6b49e3ad9aa40255a5f7d4f8915d1b46dae45da299542eedd4'),('20260810132403','9459dc50678cc86a18bdaf10d9a22cade563a218aae3c93245ee8f72821722e6'),('20260810132737','f57831142fc32d3e34fe09ca2dad20d1a59464e65df4b923937dca09673c0d12'),('20260810181753','af18eb5f4c15602edbf2fff2d1117b62d5a35290dbbb3481308cbb16dcb6956c'),('20260812203010','eba43726ba705a6848b6866524d0889c90a8feff4770c13413cda219baab2b85'),('20260813173627','25cccbe89297d33ae611d03cd564d5b89ca24fee3aba8f67aaf7d374fff909b3'),('20260813181626','86538816653923587a7b35e5f3f99a9a8382428393e320b6f6b322d0c22a052c'),('20260813183123','4265b911a66e1b2dc8c0432306facfac9167e956308f700ca5656a8da20768f4'),('20260813200842','06f0afcbeac84ca81c25dc3f52e6a890de12777f95732109b925aa1127bee7fa'),('20260813202105','8cb998f8ff3c00a30d83280faf761f876a796745ba3ea46ce889786f5e750b38'),('20260814120001','8593e4a5f3308d79a25a978f4e07dcf139a0001882173f7382a1b9c0226e7bd4'),('20260814120048','66a72c0b81ca93f499ff1161405525f520f4f02e675266043fc48edfa07796f5'),('20260816193743','44417e4b038988707bd1123b0a40eda5324fa5601c396f70432f61ded768693a'),('20260816193842','40b1dc568bd734a71c513f744fb87eefabce1ecb0e913b2ad74472e28170f659'),('20260816200015','bb76e514bef3d93893a5019112e6248f5f7cf56187af753e404b3059615759be'),('20260816200350','43292719d0fdb610a1a1be6b3382f7db9041ffdee85e61c098e93a9340f1304a'),('20260816202949','5a9f6599254056088656363b7a20bf337c22f3ad223d8eb19e61735a105f6e57'),('20260817092259','cea4e5a0049a0e5307b2f9f27e70126aff5210eab83562daf2824981413a280e'),('20260818183555','07bae23c0a4db2362b2c9ba1a2ceafdf39bc8603fed1b7c80dbd58e042bcdc03'),('20260818183744','63f98cad5e19bf5013dc863f7a3e33de5660b9bb9b591c02ae11f031f73012ba'),('20261126120000','6e83fd10190f5bf818a882043bb596358bf123fbafaed8820c98298f5aed2c00'),('20261127090000','12abc8168a9a29e383006941673db92cee5f301f81f29762fcfb4847f2017008'))
select count(*)=227 and bool_and(m.version is not null and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')=o.record_sha256) as original_history_preserved
from original o left join supabase_migrations.schema_migrations m on m.version=o.version) then raise exception 'ORIGINAL_HISTORY_CHANGED'; end if; end $check$;
select pg_temp.assert_original_history(); select pg_temp.assert_release_catalog('4b2f4e343a625a5886ce16c2c06e476936ced7f8dcf3ee35714f9aa18c17e5cf');
-- Operational release state contains no credentials or customer records.
create table if not exists security.sellpert_release_control (
 singleton boolean primary key default true check (singleton),
 maintenance boolean not null default false,
 required_client text,
 paused_cron_ids bigint[] not null default '{}',
 baseline_counts jsonb not null default '{}',
 source_commit text,
 schema_verified boolean not null default false,
 handlers_verified boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table security.sellpert_release_control enable row level security;
revoke all on security.sellpert_release_control from public, anon, authenticated;
-- Trusted server access follows the repository's explicit private-table grant contract.
grant all on security.sellpert_release_control to service_role;
insert into security.sellpert_release_control(singleton) values(true) on conflict do nothing;

create or replace function security.require_current_release()
returns void language plpgsql security definer set search_path = '' as $$
declare gate security.sellpert_release_control%rowtype;
 request_role text := coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','anon');
 client_info text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info','');
begin
 select * into strict gate from security.sellpert_release_control where singleton;
 if gate.maintenance then
   raise sqlstate 'PT503' using message='يجري تحديث النظام، يرجى إعادة المحاولة بعد قليل';
 end if;
 -- This compatibility check is only for browsers; server-side actor clients
 -- use the same JWT with no Origin header. It is not an authorization boundary.
 if request_role='authenticated'
    and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'origin','') <> ''
    and gate.required_client is not null
    and client_info <> gate.required_client then
   raise sqlstate 'PT409' using message='تم تحديث النظام. حدّث الصفحة للمتابعة', detail='APP_RELOAD_REQUIRED';
 end if;
end $$;
revoke all on function security.require_current_release() from public, anon;
grant execute on function security.require_current_release() to authenticated, service_role;

create or replace function security.freeze_release_writes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- SECURITY DEFINER business RPCs still have session_user=authenticator.
 -- Only the direct postgres deployment connection may change rows during cutover.
 if session_user <> 'postgres' and exists (
   select 1 from security.sellpert_release_control where singleton and maintenance
 ) then raise sqlstate 'PT503' using message='SELLPERT_RELEASE_MAINTENANCE'; end if;
 return null;
end $$;
revoke all on function security.freeze_release_writes() from public,anon,authenticated,service_role;

do $maintenance$ declare item record; amount bigint; counts jsonb:='{}'; begin
 for item in select schemaname,tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('select count(*) from %I.%I',item.schemaname,item.tablename) into amount;
  counts:=counts||jsonb_build_object(item.tablename,amount);
  execute format('create trigger sellpert_release_write_freeze before insert or update or delete or truncate on %I.%I for each statement execute function security.freeze_release_writes()',item.schemaname,item.tablename);
 end loop;
 update security.sellpert_release_control set maintenance=true,baseline_counts=counts,
  paused_cron_ids=coalesce((select array_agg(jobid order by jobid) from cron.job where active),'{}'),updated_at=now();
 for item in select jobid from cron.job where active loop perform cron.alter_job(item.jobid,active:=false); end loop;
end $maintenance$;
alter role authenticator set pgrst.db_pre_request='security.require_current_release';
notify pgrst,'reload config';
commit;
