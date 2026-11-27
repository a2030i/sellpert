begin;
set local lock_timeout='5s'; set local statement_timeout='180s';
select pg_advisory_xact_lock(2701123);
lock table supabase_migrations.schema_migrations in access exclusive mode;
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
do $$ begin
 if not exists(select 1 from security.sellpert_release_control where singleton and maintenance) then raise exception 'MAINTENANCE_REQUIRED'; end if;
 if exists(select 1 from public.sync_queue where status in ('pending','running','processing')) or exists(select 1 from public.platform_file_uploads where status in ('processing','uploading')) or exists(select 1 from cron.job_run_details where status='running') then raise exception 'WRITERS_NOT_DRAINED'; end if;
end $$;

-- Actual reviewed correction 20261126092419_restore_omitted_analytics_baseline.sql
-- DRAFT: restore 17 analytics views and 8 routines omitted by the baseline.
-- Source: scoped, preflight-screened production catalog snapshot 2026-11-26.
-- No customer rows or credentials were exported. No existing object is replaced.
-- Existing definitions must match the reviewed snapshot; unexpected drift aborts.
-- Existing ACLs remain unchanged. New views receive SELECT only, and routines
-- receive EXECUTE only, for authenticated/service_role; PUBLIC/anon receive none.
-- SECURITY INVOKER preserves underlying tenant/RLS/MFA and column grants.
-- No financial formulas, routing, data, or provider integrations change here.
-- Known existing defect deliberately preserved: return_reasons_breakdown is
-- STABLE but uses a temporary table. Repair requires a separate reviewed change.

DO $restore_analytics$
DECLARE
  object_oid oid;
BEGIN
  PERFORM set_config('search_path', 'public,pg_catalog', true);
  -- public.brand_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.brand_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.brand_performance WITH (security_invoker = true) AS
 WITH from_snap AS (
         SELECT product_performance_snapshots.merchant_code,
            product_performance_snapshots.platform,
            product_performance_snapshots.brand,
            sum(product_performance_snapshots.sold)::integer AS units_sold,
            sum(product_performance_snapshots.returned)::integer AS units_returned,
            sum(product_performance_snapshots.gross_sales) AS revenue,
            sum(product_performance_snapshots.net_revenue) AS net_revenue
           FROM product_performance_snapshots
          WHERE product_performance_snapshots.brand IS NOT NULL AND product_performance_snapshots.brand <> ''::text
          GROUP BY product_performance_snapshots.merchant_code, product_performance_snapshots.platform, product_performance_snapshots.brand
        ), from_orders AS (
         SELECT orders.merchant_code,
            orders.platform,
            orders.brand,
            count(*)::integer AS units_sold,
            0 AS units_returned,
            sum(orders.total_amount) AS revenue,
            sum(orders.total_amount - COALESCE(orders.platform_fee, 0::numeric)) AS net_revenue
           FROM orders
          WHERE orders.brand IS NOT NULL AND orders.brand <> ''::text AND orders.status <> 'cancelled'::text
          GROUP BY orders.merchant_code, orders.platform, orders.brand
        ), combined AS (
         SELECT from_snap.merchant_code,
            from_snap.platform,
            from_snap.brand,
            from_snap.units_sold,
            from_snap.units_returned,
            from_snap.revenue,
            from_snap.net_revenue
           FROM from_snap
        UNION ALL
         SELECT from_orders.merchant_code,
            from_orders.platform,
            from_orders.brand,
            from_orders.units_sold,
            from_orders.units_returned,
            from_orders.revenue,
            from_orders.net_revenue
           FROM from_orders
        )
 SELECT merchant_code,
    platform,
    brand,
    sum(units_sold)::integer AS units_sold,
    sum(units_returned)::integer AS units_returned,
    sum(revenue) AS revenue,
    sum(net_revenue) AS net_revenue,
        CASE
            WHEN sum(units_sold) > 0 THEN round(sum(units_returned)::numeric / sum(units_sold)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS return_rate_pct
   FROM combined
  GROUP BY merchant_code, platform, brand;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.brand_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.brand_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.brand_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '81758e66a6706b2cf538514f018001cf' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.brand_performance; review required';
  END IF;

  -- public.buybox_warnings: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.buybox_warnings');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.buybox_warnings WITH (security_invoker = true) AS
 SELECT merchant_code,
    id AS product_id,
    name,
    sku,
    barcode,
    sale_price AS my_price,
    buybox_price,
    round((sale_price - buybox_price) / NULLIF(buybox_price, 0::numeric) * 100::numeric, 1) AS overprice_pct,
        CASE
            WHEN sale_price > (buybox_price * 1.05) THEN 'losing'::text
            WHEN sale_price > buybox_price THEN 'at_risk'::text
            ELSE 'winning'::text
        END AS buybox_status
   FROM products p
  WHERE buybox_price IS NOT NULL AND buybox_price > 0::numeric AND sale_price IS NOT NULL AND sale_price > 0::numeric;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.buybox_warnings FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.buybox_warnings TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.buybox_warnings; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2152f38a7b99a41d364a5b516424f119' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.buybox_warnings; review required';
  END IF;

  -- public.cross_platform_product_perf: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.cross_platform_product_perf');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.cross_platform_product_perf WITH (security_invoker = true) AS
 WITH o AS (
         SELECT o_1.merchant_code,
            o_1.platform,
            COALESCE(o_1.partner_sku, o_1.sku) AS sku_norm,
            p.barcode,
            o_1.product_name,
            COALESCE(p.cost_price, 0::numeric) AS cost_price,
            count(*)::integer AS orders,
            sum(o_1.quantity) AS units,
            sum(o_1.total_amount) AS revenue,
            avg(o_1.total_amount / NULLIF(o_1.quantity, 0)::numeric) AS avg_price,
            sum(
                CASE
                    WHEN o_1.platform = 'noon'::text AND COALESCE(o_1.platform_fee, 0::numeric) = 0::numeric THEN o_1.total_amount * (COALESCE(cr.rate, 0::numeric) / 100.0) * (1::numeric + COALESCE(cr.vat_rate, 0::numeric) / 100.0)
                    ELSE COALESCE(o_1.platform_fee, 0::numeric)
                END) AS fees
           FROM orders o_1
             LEFT JOIN products p ON p.merchant_code = o_1.merchant_code AND (p.sku = o_1.sku OR p.sku = o_1.partner_sku)
             LEFT JOIN platform_commission_rates cr ON cr.platform = o_1.platform AND cr.category = 'default'::text
          WHERE o_1.status <> 'cancelled'::text
          GROUP BY o_1.merchant_code, o_1.platform, (COALESCE(o_1.partner_sku, o_1.sku)), p.barcode, o_1.product_name, (COALESCE(p.cost_price, 0::numeric))
        ), ad AS (
         SELECT am.merchant_code,
            am.platform,
            COALESCE(pp.sku, am.sku) AS sku_join,
            sum(am.spend) AS ad_spend
           FROM ad_metrics am
             LEFT JOIN products pp ON pp.merchant_code = am.merchant_code AND (pp.sku = am.sku OR pp.noon_sku_child = am.sku)
          WHERE am.sku IS NOT NULL AND am.sku <> ''::text
          GROUP BY am.merchant_code, am.platform, (COALESCE(pp.sku, am.sku))
        )
 SELECT o.merchant_code,
    COALESCE(o.barcode, o.sku_norm) AS product_key,
    max(o.product_name) AS product_name,
    jsonb_object_agg(o.platform, jsonb_build_object('orders', o.orders, 'units', o.units, 'revenue', round(o.revenue, 2), 'avg_price', round(o.avg_price, 2), 'fees', round(o.fees, 2), 'ad_spend', round(COALESCE(a.ad_spend, 0::numeric), 2), 'net', round(o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric), 2), 'margin',
        CASE
            WHEN o.revenue > 0::numeric THEN round((o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric)) / o.revenue * 100::numeric, 1)
            ELSE NULL::numeric
        END)) AS by_platform,
    count(DISTINCT o.platform) AS platforms_count,
    sum(o.revenue) AS total_revenue
   FROM o
     LEFT JOIN ad a ON a.merchant_code = o.merchant_code AND a.platform = o.platform AND a.sku_join = o.sku_norm
  GROUP BY o.merchant_code, (COALESCE(o.barcode, o.sku_norm))
 HAVING count(DISTINCT o.platform) > 1;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.cross_platform_product_perf FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.cross_platform_product_perf TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.cross_platform_product_perf; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'dd3951ebcfb881b1669e7b4c36ed2aa2' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.cross_platform_product_perf; review required';
  END IF;

  -- public.fulfillment_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.fulfillment_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.fulfillment_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(fulfillment_model, ''::text), 'Unknown'::text) AS fulfillment_model,
    count(*)::integer AS orders,
    sum(total_amount) AS revenue,
    sum(platform_fee) AS fees,
    avg(total_amount) AS avg_order_value,
    count(*) FILTER (WHERE status = 'cancelled'::text)::integer AS cancelled,
    count(*) FILTER (WHERE status = 'returned'::text)::integer AS returned,
    avg(EXTRACT(epoch FROM shipment_date - order_date) / 3600.0) AS avg_ship_hours,
    avg(EXTRACT(epoch FROM delivered_date - shipment_date) / 3600.0) AS avg_delivery_hours
   FROM orders
  WHERE order_date >= (now() - '180 days'::interval)
  GROUP BY merchant_code, platform, fulfillment_model;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.fulfillment_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.fulfillment_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.fulfillment_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '08a03fa77adc3fda2534be18f92c7b5c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.fulfillment_performance; review required';
  END IF;

  -- public.inventory_ageing: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_ageing');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_ageing WITH (security_invoker = true) AS
 WITH last_movement AS (
         SELECT o.merchant_code,
            o.platform,
            o.sku,
            max(o.order_date) AS last_sold
           FROM orders o
          WHERE o.status <> 'cancelled'::text
          GROUP BY o.merchant_code, o.platform, o.sku
        )
 SELECT i.id,
    i.merchant_code,
    i.platform,
    i.sku,
    i.product_name,
    i.quantity,
    COALESCE(i.cost_price, 0::numeric) AS cost_price,
    i.quantity::numeric * COALESCE(i.cost_price, 0::numeric) AS tied_capital,
    lm.last_sold,
    COALESCE(EXTRACT(day FROM now() - lm.last_sold)::integer, EXTRACT(day FROM now() - i.created_at)::integer) AS age_days,
        CASE
            WHEN lm.last_sold IS NULL THEN 'never_sold'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 90::numeric THEN 'dead_stock'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 60::numeric THEN 'aging'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 30::numeric THEN 'slow'::text
            ELSE 'fresh'::text
        END AS ageing_class
   FROM inventory i
     LEFT JOIN last_movement lm ON lm.merchant_code = i.merchant_code AND lm.platform = i.platform AND lm.sku = i.sku
  WHERE i.is_active AND i.quantity > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_ageing FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_ageing TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_ageing; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '7f9c56a12fba577f79f5c78117497003' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_ageing; review required';
  END IF;

  -- public.inventory_pipeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_pipeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_pipeline WITH (security_invoker = true) AS
 WITH asn AS (
         SELECT s.merchant_code,
            s.platform,
            s.asn_number,
            s.expected_qty,
            s.delivered_qty,
            s.expected_qty - s.delivered_qty AS lost_qty,
            s.delivery_date,
            s.created_at AS asn_sent_at,
            s.warehouse_code
           FROM inbound_shipments s
        ), grn_per_asn AS (
         SELECT g.merchant_code,
            g.asn_number,
            sum(g.grn_quantity) AS grn_total,
            sum(g.grn_quantity) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_qty,
            count(*) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_lines,
            min(g.grn_date) AS grn_date
           FROM goods_received g
          GROUP BY g.merchant_code, g.asn_number
        ), sales_per_asn AS (
         SELECT a.merchant_code,
            a.asn_number,
            count(o.id) AS orders_after,
            COALESCE(sum(o.quantity), 0::bigint) AS units_sold_after,
            COALESCE(sum(o.total_amount), 0::numeric) AS revenue_after
           FROM asn a
             LEFT JOIN orders o ON o.merchant_code = a.merchant_code AND o.platform = a.platform AND o.order_date::date >= COALESCE(a.delivery_date, a.asn_sent_at::date) AND o.status <> 'cancelled'::text
          GROUP BY a.merchant_code, a.asn_number
        )
 SELECT asn.merchant_code,
    asn.platform,
    asn.asn_number,
    asn.warehouse_code,
    asn.asn_sent_at,
    asn.delivery_date,
    asn.expected_qty,
    asn.delivered_qty,
    asn.lost_qty,
    COALESCE(grn.grn_total, 0::bigint) AS grn_total,
    COALESCE(grn.qc_failed_qty, 0::bigint) AS qc_failed_qty,
    COALESCE(grn.qc_failed_lines, 0::bigint) AS qc_failed_lines,
    COALESCE(sa.orders_after, 0::bigint) AS orders_after_receive,
    COALESCE(sa.units_sold_after, 0::bigint) AS units_sold_after_receive,
    COALESCE(sa.revenue_after, 0::numeric) AS revenue_after_receive,
        CASE
            WHEN asn.delivery_date IS NOT NULL AND asn.asn_sent_at IS NOT NULL THEN EXTRACT(day FROM asn.delivery_date::timestamp without time zone::timestamp with time zone - asn.asn_sent_at)::integer
            ELSE NULL::integer
        END AS days_to_receive
   FROM asn
     LEFT JOIN grn_per_asn grn USING (merchant_code, asn_number)
     LEFT JOIN sales_per_asn sa USING (merchant_code, asn_number);$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_pipeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_pipeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_pipeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '801d93ee41a9f47e0206e4eaab261911' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_pipeline; review required';
  END IF;

  -- public.merchant_timeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.merchant_timeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.merchant_timeline WITH (security_invoker = true) AS
 SELECT merchant_notes.merchant_code,
    'note'::text AS kind,
    merchant_notes.id::text AS ref_id,
    merchant_notes.type AS sub_type,
    merchant_notes.body AS title,
    NULL::text AS body,
    merchant_notes.author_email,
    merchant_notes.created_at
   FROM merchant_notes
UNION ALL
 SELECT merchant_requests.merchant_code,
    'task'::text AS kind,
    merchant_requests.id::text AS ref_id,
    COALESCE(merchant_requests.category, merchant_requests.type) AS sub_type,
    merchant_requests.title,
    merchant_requests.note AS body,
    merchant_requests.created_by AS author_email,
    merchant_requests.created_at
   FROM merchant_requests
UNION ALL
 SELECT platform_file_uploads.merchant_code,
    'upload'::text AS kind,
    platform_file_uploads.id::text AS ref_id,
    platform_file_uploads.file_type AS sub_type,
    platform_file_uploads.file_name AS title,
    NULL::text AS body,
    platform_file_uploads.uploaded_by AS author_email,
    platform_file_uploads.uploaded_at AS created_at
   FROM platform_file_uploads
UNION ALL
 SELECT notifications.merchant_code,
    'notify'::text AS kind,
    notifications.id::text AS ref_id,
    notifications.type AS sub_type,
    notifications.title,
    notifications.body,
    NULL::text AS author_email,
    notifications.created_at
   FROM notifications;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.merchant_timeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.merchant_timeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.merchant_timeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'e202d55cbba76ebae198ea832c7187d8' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.merchant_timeline; review required';
  END IF;

  -- public.product_abc_analysis: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.product_abc_analysis');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.product_abc_analysis WITH (security_invoker = true) AS
 WITH ranked AS (
         SELECT pp.merchant_code,
            pp.product_id,
            pp.product_name,
            pp.sku,
            pp.brand,
            pp.revenue,
            pp.units_sold,
            pp.net_profit,
            sum(pp.revenue) OVER (PARTITION BY pp.merchant_code) AS total_revenue,
            row_number() OVER (PARTITION BY pp.merchant_code ORDER BY pp.revenue DESC) AS rank
           FROM product_profitability pp
          WHERE pp.units_sold > 0
        ), cumulative AS (
         SELECT ranked.merchant_code,
            ranked.product_id,
            ranked.product_name,
            ranked.sku,
            ranked.brand,
            ranked.revenue,
            ranked.units_sold,
            ranked.net_profit,
            ranked.total_revenue,
            ranked.rank,
            sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_revenue,
                CASE
                    WHEN ranked.total_revenue > 0::numeric THEN sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / ranked.total_revenue * 100::numeric
                    ELSE 0::numeric
                END AS cum_pct
           FROM ranked
        )
 SELECT merchant_code,
    product_id,
    product_name,
    sku,
    brand,
    revenue,
    units_sold,
    net_profit,
    rank,
    round(cum_pct, 1) AS cumulative_pct,
        CASE
            WHEN cum_pct <= 80::numeric THEN 'A'::text
            WHEN cum_pct <= 95::numeric THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class
   FROM cumulative;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.product_abc_analysis FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.product_abc_analysis TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.product_abc_analysis; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'aadec7721b77a1698b38dc1a4425251c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.product_abc_analysis; review required';
  END IF;

  -- public.receiving_accuracy: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.receiving_accuracy');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.receiving_accuracy WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    COALESCE(NULLIF(barcode, ''::text), partner_sku) AS barcode,
    count(DISTINCT asn_number) AS shipments,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'passed'::text), 0::bigint) AS received_ok,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint) AS rejected,
    sum(grn_quantity) AS total_received,
        CASE
            WHEN sum(grn_quantity) > 0 THEN round(COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint)::numeric / sum(grn_quantity)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS rejection_rate_pct,
    array_agg(DISTINCT reject_reason) FILTER (WHERE qc_status = 'failed'::text AND reject_reason <> ''::text) AS reject_reasons
   FROM goods_received gr
  GROUP BY merchant_code, platform, sku, (COALESCE(NULLIF(barcode, ''::text), partner_sku));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.receiving_accuracy FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.receiving_accuracy TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.receiving_accuracy; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8df9a9af71320e7c822479b5fdf2e7a3' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.receiving_accuracy; review required';
  END IF;

  -- public.search_query_insights: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.search_query_insights');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.search_query_insights WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    search_query,
    count(*)::integer AS occurrences,
    sum(impressions) AS impressions,
    sum(clicks) AS clicks,
    sum(orders)::integer AS orders,
    sum(spend) AS spend,
    sum(revenue) AS revenue,
        CASE
            WHEN sum(impressions) > 0 THEN round(sum(clicks)::numeric / sum(impressions)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS ctr,
        CASE
            WHEN sum(spend) > 0::numeric THEN round(sum(revenue) / sum(spend), 2)
            ELSE NULL::numeric
        END AS roas,
        CASE
            WHEN sum(clicks) > 0 THEN round(sum(orders)::numeric / sum(clicks)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS cvr
   FROM ad_metrics
  WHERE search_query IS NOT NULL AND search_query <> ''::text
  GROUP BY merchant_code, platform, search_query;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.search_query_insights FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.search_query_insights TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.search_query_insights; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '6ac302dd43cd56e22134d126f4c26ee6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.search_query_insights; review required';
  END IF;

  -- public.sku_lifecycle: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sku_lifecycle');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sku_lifecycle WITH (security_invoker = true) AS
 WITH stats AS (
         SELECT p.merchant_code,
            p.id,
            p.name,
            p.sku,
            p.created_at,
            EXTRACT(day FROM now() - p.created_at)::integer AS age_days,
            COALESCE(pp.units_sold, 0::bigint) AS units_sold,
            COALESCE(pp.revenue, 0::numeric) AS revenue,
            COALESCE(pp.profit_margin_pct, 0::numeric) AS margin
           FROM products p
             LEFT JOIN product_profitability pp ON pp.product_id = p.id
        )
 SELECT merchant_code,
    id,
    name,
    sku,
    created_at,
    age_days,
    units_sold,
    revenue,
    margin,
        CASE
            WHEN age_days < 30 AND units_sold > 0 THEN 'launching'::text
            WHEN age_days < 30 AND units_sold = 0 THEN 'new_no_sales'::text
            WHEN units_sold > 0 AND age_days >= 30 AND age_days <= 180 THEN 'growing'::text
            WHEN units_sold > 0 AND age_days > 180 THEN 'mature'::text
            WHEN units_sold = 0 AND age_days > 60 THEN 'dormant'::text
            ELSE 'unknown'::text
        END AS lifecycle_stage
   FROM stats;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sku_lifecycle FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sku_lifecycle TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sku_lifecycle; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'f047c391d25cd08ea9fc184eac5725b1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sku_lifecycle; review required';
  END IF;

  -- public.supplier_quality_over_time: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supplier_quality_over_time');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supplier_quality_over_time WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    date_trunc('month'::text, grn_date::timestamp with time zone)::date AS month,
    count(*) AS total_lines,
    count(*) FILTER (WHERE qc_status = 'failed'::text) AS failed_lines,
    sum(grn_quantity) AS total_qty,
    sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text) AS failed_qty,
    round(count(*) FILTER (WHERE qc_status = 'failed'::text)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 2) AS failure_rate_pct
   FROM goods_received
  WHERE grn_date IS NOT NULL
  GROUP BY merchant_code, platform, (date_trunc('month'::text, grn_date::timestamp with time zone));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supplier_quality_over_time FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supplier_quality_over_time TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supplier_quality_over_time; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2951f5f88032aab39cc13106fe700cd0' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supplier_quality_over_time; review required';
  END IF;

  -- public.supply_chain_health: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supply_chain_health');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supply_chain_health WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    count(*) AS shipments,
    sum(expected_qty) AS total_expected,
    sum(delivered_qty) AS total_delivered,
    sum(variance) AS total_variance,
    round(sum(abs(LEAST(variance, 0)))::numeric / NULLIF(sum(expected_qty), 0)::numeric * 100::numeric, 2) AS loss_rate_pct,
    ( SELECT count(*) AS count
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failures,
    ( SELECT COALESCE(sum(g.grn_quantity), 0::bigint) AS "coalesce"
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failed_qty
   FROM inbound_shipments s
  GROUP BY merchant_code, platform;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supply_chain_health FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supply_chain_health TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supply_chain_health; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '85a18521d6f27e65b6b0318a307eafa1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supply_chain_health; review required';
  END IF;

  -- public.sync_queue_stats: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sync_queue_stats');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sync_queue_stats WITH (security_invoker = true) AS
 SELECT platform,
    job_type,
    status,
    count(*) AS job_count,
    avg(EXTRACT(epoch FROM finished_at - started_at))::integer AS avg_duration_sec,
    max(created_at) AS latest_job
   FROM sync_queue
  WHERE created_at > (now() - '24:00:00'::interval)
  GROUP BY platform, job_type, status
  ORDER BY platform, job_type, status;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sync_queue_stats FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sync_queue_stats TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sync_queue_stats; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'a55c4a57f9c6538e52814385cc301b8c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sync_queue_stats; review required';
  END IF;

  -- public.top_failing_skus: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.top_failing_skus');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.top_failing_skus WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    partner_sku,
    barcode,
    count(*) AS reject_events,
    sum(grn_quantity) AS total_rejected_qty,
    array_agg(DISTINCT reject_reason) FILTER (WHERE reject_reason IS NOT NULL) AS reasons
   FROM goods_received
  WHERE qc_status = 'failed'::text
  GROUP BY merchant_code, platform, sku, partner_sku, barcode;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.top_failing_skus FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.top_failing_skus TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.top_failing_skus; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '926aa4df787ee90df821b95d9cfd3f75' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.top_failing_skus; review required';
  END IF;

  -- public.true_ad_effectiveness: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.true_ad_effectiveness');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.true_ad_effectiveness WITH (security_invoker = true) AS
 SELECT am.merchant_code,
    am.platform,
    NULLIF(am.sku, ''::text) AS sku,
    am.campaign_name,
    sum(am.spend) AS spend,
    sum(am.revenue) AS gross_revenue,
    sum(am.orders) AS orders,
    round(sum(am.revenue) * COALESCE(fp.fee_rate, 0::numeric), 2) AS est_fees,
    round(sum(am.revenue) * COALESCE(rp.return_rate, 0::numeric), 2) AS est_returns,
    fp.fee_rate,
    rp.return_rate,
    round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)), 2) AS net_revenue,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS gross_roas,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS net_roas,
    fp.commission,
    fp.fba_fee,
    fp.withheld_vat,
    max(pr.name) AS product_name
   FROM ad_metrics am
     LEFT JOIN platform_fee_profile fp ON fp.merchant_code = am.merchant_code AND fp.platform = am.platform
     LEFT JOIN platform_return_profile rp ON rp.merchant_code = am.merchant_code AND rp.platform = am.platform
     LEFT JOIN products pr ON pr.merchant_code = am.merchant_code AND (pr.sku = am.sku OR pr.noon_sku_child = am.sku)
  WHERE am.spend > 0::numeric
  GROUP BY am.merchant_code, am.platform, (NULLIF(am.sku, ''::text)), am.campaign_name, fp.fee_rate, rp.return_rate, fp.commission, fp.fba_fee, fp.withheld_vat;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.true_ad_effectiveness FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.true_ad_effectiveness TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.true_ad_effectiveness; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8dfaab5984388d078e12f9b637dc314d' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.true_ad_effectiveness; review required';
  END IF;

  -- public.variant_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.variant_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.variant_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(brand, ''::text), 'بلا ماركة'::text) AS brand,
    COALESCE(NULLIF(color, ''::text), 'بلا لون'::text) AS color,
    COALESCE(NULLIF(size, ''::text), 'بلا مقاس'::text) AS size,
    sum(sold)::integer AS units_sold,
    sum(returned)::integer AS units_returned,
    sum(gross_sales) AS revenue,
    sum(net_revenue) AS net_revenue,
    round(sum(returned)::numeric / NULLIF(sum(sold), 0)::numeric * 100::numeric, 1) AS return_rate_pct
   FROM product_performance_snapshots
  WHERE color IS NOT NULL OR size IS NOT NULL
  GROUP BY merchant_code, platform, brand, color, size
 HAVING sum(sold) > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.variant_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.variant_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.variant_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '25ad00592dd52bc01b231bfacda22f00' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.variant_performance; review required';
  END IF;

  object_oid := to_regprocedure('public.inventory_turnover(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cogs AS (
    SELECT COALESCE(SUM(o.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs,
           COALESCE(SUM(o.total_amount), 0) AS total_revenue
    FROM public.orders o
    LEFT JOIN public.products p ON p.merchant_code = o.merchant_code AND p.sku = o.sku
    WHERE o.merchant_code = p_merchant_code
      AND o.order_date >= NOW() - p_days * INTERVAL '1 day'
      AND o.status NOT IN ('cancelled')
  ),
  inv AS (
    SELECT COALESCE(SUM(quantity * COALESCE(cost_price, 0)), 0) AS avg_inv_value,
           COALESCE(SUM(quantity), 0) AS total_units
    FROM public.inventory
    WHERE merchant_code = p_merchant_code AND is_active
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'cogs',          cogs.total_cogs,
    'revenue',       cogs.total_revenue,
    'avg_inv_value', inv.avg_inv_value,
    'total_units',   inv.total_units,
    'turnover_ratio', CASE WHEN inv.avg_inv_value > 0 THEN ROUND((cogs.total_cogs / inv.avg_inv_value)::numeric * (365.0 / p_days), 2) ELSE NULL END,
    'days_to_sell_all', CASE WHEN cogs.total_cogs > 0 THEN ROUND((inv.avg_inv_value / cogs.total_cogs * p_days)::numeric, 0) ELSE NULL END
  )
  FROM cogs, inv;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.inventory_turnover; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f86cda032fe06b2d38d3dc6feb1c5ab6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_turnover; review required';
  END IF;

  object_oid := to_regprocedure('public.period_comparison(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.period_comparison(p_merchant_code text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH curr AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - p_days * INTERVAL '1 day')
      AND data_date <= CURRENT_DATE
  ),
  prev AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - 2 * p_days * INTERVAL '1 day')
      AND data_date <= (CURRENT_DATE - p_days * INTERVAL '1 day')
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'current',  jsonb_build_object('sales', curr.sales, 'orders', curr.orders, 'ad_spend', curr.ad_spend, 'fees', curr.fees),
    'previous', jsonb_build_object('sales', prev.sales, 'orders', prev.orders, 'ad_spend', prev.ad_spend, 'fees', prev.fees),
    'delta_pct', jsonb_build_object(
      'sales',    CASE WHEN prev.sales    > 0 THEN ROUND(((curr.sales - prev.sales) / prev.sales * 100)::numeric, 1) ELSE NULL END,
      'orders',   CASE WHEN prev.orders   > 0 THEN ROUND(((curr.orders - prev.orders)::numeric / prev.orders * 100), 1) ELSE NULL END,
      'ad_spend', CASE WHEN prev.ad_spend > 0 THEN ROUND(((curr.ad_spend - prev.ad_spend) / prev.ad_spend * 100)::numeric, 1) ELSE NULL END,
      'fees',     CASE WHEN prev.fees     > 0 THEN ROUND(((curr.fees - prev.fees) / prev.fees * 100)::numeric, 1) ELSE NULL END
    )
  )
  FROM curr, prev;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.period_comparison; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '72571f4b98ed76ef4d6281bd88f6c15c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.period_comparison; review required';
  END IF;

  object_oid := to_regprocedure('public.restock_recommendations(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer DEFAULT 14)
 RETURNS TABLE(sku text, product_name text, platform text, current_qty integer, daily_velocity numeric, days_of_stock numeric, suggested_order_qty integer, urgency text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT
      sku, product_name, platform,
      quantity AS current_qty,
      daily_velocity,
      days_of_stock,
      GREATEST(CEIL(daily_velocity * (p_lead_time_days + 30))::int - quantity, 0) AS suggested_order_qty,
      CASE
        WHEN quantity = 0 THEN 'urgent'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < p_lead_time_days THEN 'high'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < (p_lead_time_days + 7) THEN 'medium'
        ELSE 'low'
      END AS urgency
    FROM public.inventory_health
    WHERE merchant_code = p_merchant_code
      AND daily_velocity > 0
      AND (days_of_stock IS NULL OR days_of_stock < (p_lead_time_days + 14))
  ) t
  ORDER BY
    (CASE t.urgency WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END),
    t.days_of_stock NULLS FIRST;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.restock_recommendations; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '640cc7bef99e0560c1dac28b705fe0a7' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.restock_recommendations; review required';
  END IF;

  object_oid := to_regprocedure('public.return_reasons_breakdown(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.return_reasons_breakdown(p_merchant_code text)
 RETURNS TABLE(reason text, count integer, percentage numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE total int;
BEGIN
  CREATE TEMP TABLE _rr (reason text, cnt int) ON COMMIT DROP;
  INSERT INTO _rr
    SELECT key, SUM(value::int)::int AS cnt
    FROM public.product_performance_snapshots,
         jsonb_each_text(return_reasons) AS r(key, value)
    WHERE merchant_code = p_merchant_code
      AND value::int > 0
    GROUP BY key;
  SELECT SUM(cnt) INTO total FROM _rr;
  RETURN QUERY
    SELECT _rr.reason, _rr.cnt, CASE WHEN total > 0 THEN ROUND((_rr.cnt::numeric / total * 100)::numeric, 1) ELSE 0 END
    FROM _rr ORDER BY _rr.cnt DESC;
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.return_reasons_breakdown; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '41ded9e99be0b950291d81e512bf2d21' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.return_reasons_breakdown; review required';
  END IF;

  object_oid := to_regprocedure('public.sales_heatmap(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS TABLE(day_of_week integer, hour_of_day integer, orders integer, sales numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    EXTRACT(DOW FROM order_date)::int  AS day_of_week,
    EXTRACT(HOUR FROM order_date)::int AS hour_of_day,
    COUNT(*)::int AS orders,
    COALESCE(SUM(total_amount), 0)::numeric AS sales
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - p_days * INTERVAL '1 day'
    AND status NOT IN ('cancelled')
    AND order_date::time <> '00:00:00'
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.sales_heatmap; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'c7e0158141ca857ff124c87fe0885ea4' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sales_heatmap; review required';
  END IF;

  object_oid := to_regprocedure('public.shipping_analytics(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.shipping_analytics(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ship AS (
    SELECT
      EXTRACT(EPOCH FROM (shipment_date - order_date)) / 3600.0 AS ship_hours,
      EXTRACT(EPOCH FROM (delivered_date - shipment_date)) / 3600.0 AS delivery_hours,
      EXTRACT(EPOCH FROM (delivered_date - order_date)) / 86400.0 AS total_days,
      status, platform
    FROM public.orders
    WHERE merchant_code = p_merchant_code
      AND order_date >= NOW() - INTERVAL '90 days'
      AND shipment_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'total_orders', COUNT(*),
    'avg_ship_hours', ROUND(AVG(ship_hours)::numeric, 1),
    'avg_delivery_hours', ROUND(AVG(delivery_hours)::numeric, 1),
    'avg_total_days', ROUND(AVG(total_days)::numeric, 1),
    'late_shipments', COUNT(*) FILTER (WHERE ship_hours > 48),
    'fastest_hours', ROUND(MIN(ship_hours)::numeric, 1),
    'slowest_hours', ROUND(MAX(ship_hours)::numeric, 1)
  )
  FROM ship;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.shipping_analytics(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.shipping_analytics(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.shipping_analytics; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '0bafae1e3e1b44c87f378f2d68277b28' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.shipping_analytics; review required';
  END IF;

  object_oid := to_regprocedure('public.tasks_summary(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.tasks_summary(p_assigned text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',       COUNT(*),
    'pending',     COUNT(*) FILTER (WHERE status = 'pending'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'done',        COUNT(*) FILTER (WHERE status = 'done'),
    'blocked',     COUNT(*) FILTER (WHERE status = 'blocked'),
    'urgent',      COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('done','rejected')),
    'overdue',     COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('done','rejected'))
  )
  FROM public.merchant_requests
  WHERE p_assigned IS NULL OR assigned_to = p_assigned;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_summary(p_assigned text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tasks_summary(p_assigned text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.tasks_summary; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'd5724bc1469042a78608406328af4c7a' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.tasks_summary; review required';
  END IF;

  object_oid := to_regprocedure('public.weekly_digest(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.weekly_digest(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curr jsonb; v_prev jsonb;
  v_top_product text; v_alerts text;
BEGIN
  -- مقارنة 7 يوم مع 7 السابقة
  SELECT public.period_comparison(p_merchant_code, 7) INTO v_curr;

  -- أعلى منتج بيع آخر 7 أيام
  SELECT product_name INTO v_top_product
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - INTERVAL '7 days'
    AND status NOT IN ('cancelled')
    AND product_name IS NOT NULL
  GROUP BY product_name
  ORDER BY SUM(total_amount) DESC
  LIMIT 1;

  -- التنبيهات
  SELECT string_agg(title, E'\n') INTO v_alerts
  FROM (
    SELECT title FROM public.notifications
    WHERE merchant_code = p_merchant_code AND created_at >= NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'merchant_code', p_merchant_code,
    'period', '7 أيام',
    'sales',     v_curr->'current'->>'sales',
    'orders',    v_curr->'current'->>'orders',
    'ad_spend',  v_curr->'current'->>'ad_spend',
    'sales_delta_pct',  v_curr->'delta_pct'->>'sales',
    'orders_delta_pct', v_curr->'delta_pct'->>'orders',
    'top_product', COALESCE(v_top_product, 'لا يوجد'),
    'alerts',      COALESCE(v_alerts, 'لا تنبيهات جديدة')
  );
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.weekly_digest(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.weekly_digest(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.weekly_digest; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f8e4d63929905515b18012b2b6caaefc' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.weekly_digest; review required';
  END IF;

END
$restore_analytics$;


-- Actual reviewed correction 20261126092426_reconcile_confirmed_security_schema_gaps.sql
-- REVIEW DRAFT ONLY: confirmed schema gaps; not approved for production.
-- Exact private implementation/public wrapper from the rebuilt committed history.
-- Does not execute cost imports, clear names, replay baseline or repair history.
CREATE OR REPLACE FUNCTION security.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_merchant_code text := COALESCE(NULLIF(btrim(p_merchant_code), ''), public.current_merchant_code());
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR v_merchant_code IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  IF NOT security.has_merchant_permission(v_merchant_code, 'products') THEN
    RAISE EXCEPTION 'PRODUCT_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COST_UPDATE_PAYLOAD';
  END IF;

  v_rows := jsonb_array_length(p_updates);
  IF v_rows = 0 OR v_rows > 5000 THEN
    RAISE EXCEPTION 'COST_UPDATE_ROW_LIMIT';
  END IF;

  RETURN QUERY
  WITH raw_input AS (
    SELECT trim(COALESCE(row_data ->> 'identifier', '')) AS identifier,
           trim(COALESCE(row_data ->> 'cost_price', '')) AS cost_text,
           ordinality
    FROM jsonb_array_elements(p_updates) WITH ORDINALITY AS input(row_data, ordinality)
  ), parsed AS (
    SELECT identifier, lower(identifier) AS normalized_identifier,
           CASE WHEN replace(cost_text, ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
             THEN replace(cost_text, ',', '.')::numeric ELSE NULL END AS cost_price,
           ordinality
    FROM raw_input
  ), valid_input AS (
    SELECT DISTINCT ON (normalized_identifier) identifier, normalized_identifier, cost_price
    FROM parsed
    WHERE normalized_identifier <> '' AND cost_price > 0
    ORDER BY normalized_identifier, ordinality DESC
  ), matches AS (
    SELECT input.identifier, input.normalized_identifier, input.cost_price,
           product.id AS product_id,
           count(*) OVER (PARTITION BY input.normalized_identifier) AS match_count
    FROM valid_input input
    JOIN public.products product
      ON product.merchant_code = v_merchant_code
     AND input.normalized_identifier IN (
       lower(trim(COALESCE(product.sku, ''))), lower(trim(COALESCE(product.barcode, ''))),
       lower(trim(COALESCE(product.external_id, ''))), lower(trim(COALESCE(product.model_code, ''))),
       lower(trim(COALESCE(product.supplier_sku, ''))), lower(trim(COALESCE(product.psku_code, ''))),
       lower(trim(COALESCE(product.noon_sku_child, ''))), lower(trim(COALESCE(product.asin, '')))
     )
  ), updated AS (
    UPDATE public.products product
       SET cost_price = match.cost_price, updated_at = now()
      FROM matches match
     WHERE match.match_count = 1
       AND product.id = match.product_id
       AND product.merchant_code = v_merchant_code
    RETURNING product.id
  )
  SELECT
    (SELECT count(*)::integer FROM updated),
    COALESCE((SELECT array_agg(input.identifier ORDER BY input.identifier)
      FROM valid_input input WHERE NOT EXISTS (
        SELECT 1 FROM matches match WHERE match.normalized_identifier = input.normalized_identifier
      )), '{}'::text[]),
    COALESCE((SELECT array_agg(DISTINCT match.identifier ORDER BY match.identifier)
      FROM matches match WHERE match.match_count > 1), '{}'::text[]),
    (SELECT count(*)::integer FROM parsed
      WHERE normalized_identifier = '' OR cost_price IS NULL OR cost_price <= 0);
END
$function$
;
CREATE OR REPLACE FUNCTION public.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT * FROM security.bulk_update_product_costs(p_updates, p_merchant_code) $function$
;

REVOKE ALL ON FUNCTION security.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;

-- Restrictive tenant/permission boundaries do not grant access by themselves;
-- sales_targets also needs a permissive write policy for the merchant goal RPC.
-- The restrictive policies remain the final tenant and section guard.
DROP POLICY IF EXISTS merchant_sales_targets_insert ON public.sales_targets;
CREATE POLICY merchant_sales_targets_insert
ON public.sales_targets
FOR INSERT TO authenticated
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));

DROP POLICY IF EXISTS merchant_sales_targets_update ON public.sales_targets;
CREATE POLICY merchant_sales_targets_update
ON public.sales_targets
FOR UPDATE TO authenticated
USING (security.has_merchant_permission(merchant_code, 'dashboard'))
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));


-- Validate the original privacy predicate without rewriting any customer rows.
-- A bounded production aggregate found zero violations during review.
-- If a concurrent violation exists at application time this migration must abort;
-- no automatic cleanup is authorized.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.trendyol_customer_questions'::regclass
      AND conname='trendyol_customer_questions_hidden_name_check'
  ) THEN
    ALTER TABLE public.trendyol_customer_questions
      ADD CONSTRAINT trendyol_customer_questions_hidden_name_check
      CHECK (show_customer_name OR customer_name IS NULL);
  END IF;
END
$migration$;


-- Actual reviewed correction 20261126092919_preserve_production_rpc_and_audit_behavior.sql
-- REVIEW DRAFT ONLY. Preserve correct production behavior in fresh rebuilds.
-- Changes function definitions only; does not delete uploads, modify audit rows,
-- close imports/accounts, or rewrite existing merchant names.

CREATE OR REPLACE FUNCTION public.delete_upload_cascade_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_cascade_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION public.delete_upload_with_data_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_with_data_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION security.write_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := COALESCE(v_new, v_old, '{}'::jsonb);
  v_actor text;
  v_record_id text;
  v_merchant_code text;
BEGIN
  v_actor := COALESCE(
    (SELECT auth.uid())::text,
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    current_user
  );
  v_record_id := COALESCE(v_row ->> 'id', v_row ->> 'merchant_code', v_row ->> 'key');
  v_merchant_code := COALESCE(v_row ->> 'merchant_code', v_row ->> 'owner_merchant_code');

  INSERT INTO public.audit_log (
    merchant_code, action, table_name, record_id,
    old_values, new_values, performed_by, performed_at
  ) VALUES (
    v_merchant_code, lower(TG_OP), TG_TABLE_NAME, v_record_id,
    security.redact_audit_values(v_old),
    security.redact_audit_values(v_new),
    v_actor, now()
  );

  RETURN COALESCE(NEW, OLD);
END
$function$

;

CREATE OR REPLACE FUNCTION security.close_stale_imports()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.platform_file_uploads
  SET status = 'failed',
      finished_at = now(),
      error_message = COALESCE(
        NULLIF(error_message, ''),
        'توقفت المعالجة لأكثر من 30 دقيقة — أغلقها النظام تلقائياً ويمكن إعادة رفع الملف'
      )
  WHERE status = 'processing'
    AND uploaded_at < now() - interval '30 minutes';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$function$

;

CREATE OR REPLACE FUNCTION security.handle_self_service_merchant_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text;
  v_name text;
  v_phone text;
  v_legal_version text;
  v_accepted boolean;
  v_attempt integer := 0;
begin
  if coalesce(new.raw_user_meta_data->>'signup_source', '') <> 'self_service' then
    return new;
  end if;

  v_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'متجر جديد'), 120);
  v_phone := nullif(left(btrim(new.raw_user_meta_data->>'whatsapp_phone'), 32), '');
  v_legal_version := nullif(left(btrim(new.raw_user_meta_data->>'legal_version'), 10), '');
  v_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
    and coalesce((new.raw_user_meta_data->>'privacy_accepted')::boolean, false)
    and v_legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  loop
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.merchants (
        id, merchant_code, name, email, currency, role,
        workspace_status, signup_source, whatsapp_phone, is_active
      ) values (
        new.id, v_code, v_name, lower(new.email), 'SAR', 'merchant',
        'active', 'self_service', v_phone, new.email_confirmed_at is not null
      );
      exit;
    exception when unique_violation then
      if exists (select 1 from public.merchants where id = new.id) then return new; end if;
      if v_attempt >= 3 then raise; end if;
    end;
  end loop;

  if v_accepted then
    insert into public.merchant_legal_acceptances (merchant_code, user_id, terms_version, privacy_version)
    values (v_code, new.id, v_legal_version, v_legal_version);
  end if;
  return new;
end
$function$

;

-- Preserve private browser execution boundaries. Internal wrappers are service-only.
REVOKE ALL ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) TO service_role;


-- Actual reviewed correction 20261126094647_reconcile_analytics_validation_and_arabic_labels.sql
-- DRAFT: preserve three production validation guards and repair two fallback labels.
-- Scoped catalog source passed credential/network/settings preflight.
-- No financial formulas, actor checks, signatures, function options or grants change.
-- Abort if either reviewed source version no longer matches the target.
DO $analytics_compat$
DECLARE object_oid oid;
BEGIN
  object_oid := to_regprocedure('public.merchant_health_score(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('4756fbbf9af85b758d608995c6bdd85f', 'fd5def43ee5918e71a626137f189bb93') THEN
    RAISE EXCEPTION 'Unexpected definition for public.merchant_health_score; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.merchant_health_score(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_data_as_of timestamptz;
  v_data_age_days integer;
  v_anchor_date date;
  v_orders_30d integer := 0;
  v_orders_prev_30d integer := 0;
  v_active_days integer := 0;
  v_sales_30d numeric := 0;
  v_sales_prev_30d numeric := 0;
  v_growth_pct numeric;
  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_profitable_products integer := 0;
  v_cost_coverage_pct numeric := 0;
  v_avg_margin_pct numeric;
  v_inventory_total integer := 0;
  v_inventory_fresh integer := 0;
  v_inventory_velocity integer := 0;
  v_inventory_stockouts integer := 0;
  v_inventory_reorder integer := 0;
  v_ad_spend numeric := 0;
  v_ad_net numeric := 0;
  v_net_roas numeric;
  v_readiness_indicators integer := 0;
  v_readiness_total numeric := 0;
  v_readiness_score numeric;
  v_profitability_score numeric;
  v_inventory_score numeric;
  v_demand_score numeric;
  v_marketing_score numeric;
  v_available_weight numeric := 0;
  v_weighted_points numeric := 0;
  v_score numeric;
  v_coverage_pct numeric := 0;
  v_confidence text := 'low';
  v_rating text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  v_data_as_of := greatest(
    (select max(created_at) from public.orders where merchant_code = p_merchant_code),
    (select max(last_updated) from public.inventory where merchant_code = p_merchant_code),
    (select max(uploaded_at) from public.platform_file_uploads where merchant_code = p_merchant_code),
    (select security.latest_platform_sync_at(p_merchant_code))
  );
  v_data_age_days := case when v_data_as_of is null then null
    else greatest(0, current_date - v_data_as_of::date) end;

  if v_anchor_date is not null then
    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      count(distinct order_date::date) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_30d, v_active_days, v_sales_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 29 and v_anchor_date;

    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_prev_30d, v_sales_prev_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

    v_growth_pct := case when v_sales_prev_30d > 0
      then round(((v_sales_30d - v_sales_prev_30d) / v_sales_prev_30d) * 100, 1)
      else null end;
  end if;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0 and net_profit > 0)::integer,
    avg(profit_margin_pct) filter (where units_sold > 0 and cost_price > 0)
  into v_sold_products, v_costed_products, v_profitable_products, v_avg_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'out_of_stock')::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'reorder_soon')::integer
  into v_inventory_total, v_inventory_fresh, v_inventory_velocity, v_inventory_stockouts, v_inventory_reorder
  from public.inventory_health
  where merchant_code = p_merchant_code;

  select coalesce(sum(total_spend), 0), coalesce(sum(total_net), 0)
    into v_ad_spend, v_ad_net
  from public.ad_net_summary
  where merchant_code = p_merchant_code;
  v_net_roas := case when v_ad_spend > 0 then v_ad_net / v_ad_spend else null end;

  -- Readiness (25%): only score evidence that actually exists.
  if v_sold_products > 0 then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + v_cost_coverage_pct;
  end if;
  if v_data_as_of is not null then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + case
      when v_data_age_days <= 2 then 100
      when v_data_age_days <= 7 then 70
      when v_data_age_days <= 14 then 40
      else 10 end;
  end if;
  if v_readiness_indicators > 0 then
    v_readiness_score := round(v_readiness_total / v_readiness_indicators, 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_readiness_score * 0.25;
  end if;

  -- Profitability (25%): unavailable until at least 80% of sold products have cost.
  if v_costed_products > 0 and v_cost_coverage_pct >= 80 then
    v_profitability_score := round(least(100, greatest(0,
      (v_profitable_products::numeric / v_costed_products * 70)
      + (least(30, greatest(-10, coalesce(v_avg_margin_pct, -10))) + 10) / 40 * 30
    )), 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_profitability_score * 0.25;
  end if;

  -- Inventory (20%): stale or velocity-free inventory is not scored.
  if v_inventory_velocity > 0 then
    v_inventory_score := round(least(100, greatest(0,
      100
      - (v_inventory_stockouts::numeric / v_inventory_velocity * 70)
      - (v_inventory_reorder::numeric / v_inventory_velocity * 30)
    )), 1);
    v_available_weight := v_available_weight + 20;
    v_weighted_points := v_weighted_points + v_inventory_score * 0.20;
  end if;

  -- Demand (15%): combine continuity with bounded period growth.
  if v_orders_30d > 0 then
    v_demand_score := round(least(100, greatest(0,
      (least(100, v_active_days::numeric / 30 * 100) * 0.45)
      + (case when v_growth_pct is null then 45
              else least(100, greatest(0, 50 + least(50, greatest(-50, v_growth_pct)))) end * 0.55)
    )), 1);
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_demand_score * 0.15;
  end if;

  -- Marketing (15%): no advertising data means unavailable, never free points.
  if v_ad_spend > 0 then
    v_marketing_score := case
      when v_net_roas < 1 then 10
      when v_net_roas < 2 then 40
      when v_net_roas < 3 then 65
      when v_net_roas < 5 then 85
      else 100 end;
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_marketing_score * 0.15;
  end if;

  v_coverage_pct := v_available_weight;
  v_score := case when v_available_weight >= 60
    then round(v_weighted_points / v_available_weight * 100, 0)
    else null end;
  v_confidence := case
    when v_coverage_pct >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_coverage_pct >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;
  v_rating := case
    when v_score is null then 'insufficient'
    when v_score >= 80 then 'excellent'
    when v_score >= 65 then 'good'
    when v_score >= 45 then 'watch'
    else 'critical' end;

  return jsonb_build_object(
    'score', v_score,
    'rating', v_rating,
    'confidence', v_confidence,
    'coverage_pct', v_coverage_pct,
    'data_as_of', v_data_as_of,
    'data_age_days', v_data_age_days,
    'breakdown', jsonb_build_object(
      'readiness', jsonb_build_object('available', v_readiness_score is not null, 'score', v_readiness_score, 'weight', 25, 'cost_coverage_pct', v_cost_coverage_pct, 'data_age_days', v_data_age_days),
      'profitability', jsonb_build_object('available', v_profitability_score is not null, 'score', v_profitability_score, 'weight', 25, 'sold_products', v_sold_products, 'costed_products', v_costed_products, 'profitable_products', v_profitable_products, 'avg_margin_pct', round(coalesce(v_avg_margin_pct, 0), 1)),
      'inventory', jsonb_build_object('available', v_inventory_score is not null, 'score', v_inventory_score, 'weight', 20, 'total_items', v_inventory_total, 'fresh_items', v_inventory_fresh, 'velocity_items', v_inventory_velocity, 'stockouts', v_inventory_stockouts, 'reorder_soon', v_inventory_reorder),
      'demand', jsonb_build_object('available', v_demand_score is not null, 'score', v_demand_score, 'weight', 15, 'orders_30d', v_orders_30d, 'active_days', v_active_days, 'sales_30d', v_sales_30d, 'growth_pct', v_growth_pct),
      'marketing', jsonb_build_object('available', v_marketing_score is not null, 'score', v_marketing_score, 'weight', 15, 'spend', v_ad_spend, 'net_revenue', v_ad_net, 'net_roas', round(coalesce(v_net_roas, 0), 2))
    )
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('public.revenue_forecast(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('657e01d64fb9785f70b7e997a05c04cc', 'a44ca5b9208e9378093d352eae66305a') THEN
    RAISE EXCEPTION 'Unexpected definition for public.revenue_forecast; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.revenue_forecast(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_first_date date;
  v_observed_days integer := 0;
  v_active_days integer := 0;
  v_data_age_days integer;
  v_last_30_sales numeric := 0;
  v_prev_30_sales numeric := 0;
  v_avg_daily numeric := 0;
  v_stddev numeric := 0;
  v_cv numeric := 0;
  v_growth_pct numeric;
  v_bounded_growth numeric := 0;
  v_forecast_30 numeric := 0;
  v_uncertainty_pct numeric := 0.45;
  v_lower_30 numeric := 0;
  v_upper_30 numeric := 0;
  v_confidence text := 'low';
  v_caveat text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date, min(order_date)::date
    into v_anchor_date, v_first_date
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned');

  if v_anchor_date is null then
    return jsonb_build_object(
      'last_30_sales', 0, 'prev_30_sales', 0, 'avg_daily', 0,
      'forecast_30', 0, 'forecast_60', 0, 'forecast_90', 0,
      'lower_30', 0, 'upper_30', 0, 'growth_rate_pct', null,
      'confidence', 'low', 'is_actionable', false, 'observed_days', 0,
      'active_days', 0, 'data_as_of', null, 'data_age_days', null,
      'method', 'bounded_recent_run_rate',
      'caveat', 'لا توجد طلبات كافية لبناء توقع.'
    );
  end if;

  v_data_age_days := greatest(0, current_date - v_anchor_date);
  v_observed_days := least(30, greatest(1, v_anchor_date - v_first_date + 1));

  with calendar as (
    select day::date
    from generate_series(v_anchor_date - (v_observed_days - 1), v_anchor_date, interval '1 day') day
  ), daily as (
    select c.day, coalesce(sum(o.total_amount), 0)::numeric as sales
    from calendar c
    left join public.orders o
      on o.merchant_code = p_merchant_code
     and o.order_date::date = c.day
     and o.status not in ('cancelled', 'returned')
    group by c.day
  )
  select coalesce(sum(sales), 0), count(*) filter (where sales > 0)::integer,
         coalesce(avg(sales), 0), coalesce(stddev_pop(sales), 0)
    into v_last_30_sales, v_active_days, v_avg_daily, v_stddev
  from daily;

  select coalesce(sum(total_amount), 0)
    into v_prev_30_sales
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned')
    and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

  v_growth_pct := case when v_prev_30_sales > 0
    then round(((v_last_30_sales - v_prev_30_sales) / v_prev_30_sales) * 100, 1)
    else null end;
  v_bounded_growth := least(50, greatest(-30, coalesce(v_growth_pct, 0)));
  v_cv := case when v_avg_daily > 0 then v_stddev / v_avg_daily else 0 end;

  v_confidence := case
    when (v_anchor_date - v_first_date + 1) >= 60 and v_active_days >= 20 and v_data_age_days <= 2 then 'high'
    when (v_anchor_date - v_first_date + 1) >= 30 and v_active_days >= 10 and v_data_age_days <= 7 then 'medium'
    else 'low' end;

  v_uncertainty_pct := case v_confidence
    when 'high' then greatest(0.15, least(0.30, v_cv * 0.35))
    when 'medium' then greatest(0.25, least(0.40, v_cv * 0.45))
    else 0.45 end;
  v_forecast_30 := round(greatest(0, v_avg_daily * 30 * (1 + v_bounded_growth / 200)), 2);
  v_lower_30 := round(greatest(0, v_forecast_30 * (1 - v_uncertainty_pct)), 2);
  v_upper_30 := round(v_forecast_30 * (1 + v_uncertainty_pct), 2);
  v_caveat := case
    when v_data_age_days > 7 then 'البيانات متأخرة؛ حدّث مصدر الطلبات قبل الاعتماد على التوقع.'
    when v_observed_days < 30 then 'السجل أقصر من 30 يومًا؛ سيضيق النطاق مع تراكم البيانات.'
    when v_active_days < 10 then 'أيام البيع الفعلية قليلة؛ التوقع استرشادي فقط.'
    else 'النطاق يعكس تذبذب المبيعات وحداثة البيانات، ولا يمثل ضمانًا.' end;

  return jsonb_build_object(
    'last_30_sales', round(v_last_30_sales, 2),
    'prev_30_sales', round(v_prev_30_sales, 2),
    'avg_daily', round(v_avg_daily, 2),
    'forecast_30', v_forecast_30,
    'forecast_60', round(v_forecast_30 * 2, 2),
    'forecast_90', round(v_forecast_30 * 3, 2),
    'lower_30', v_lower_30,
    'upper_30', v_upper_30,
    'growth_rate_pct', v_growth_pct,
    'confidence', v_confidence,
    'is_actionable', v_confidence in ('high', 'medium') and v_forecast_30 > 0,
    'observed_days', v_observed_days,
    'active_days', v_active_days,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'method', 'bounded_recent_run_rate',
    'caveat', v_caveat
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.merchant_executive_brief_base(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('2286d4081ed826cc61dfeaafd2827f50', '59952ef2c5a4a85c6a401a5a9b29f92b') THEN
    RAISE EXCEPTION 'Unexpected definition for security.merchant_executive_brief_base; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.merchant_executive_brief_base(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_period_start date;
  v_previous_start date;
  v_data_age_days integer;

  v_sales numeric := 0;
  v_previous_sales numeric := 0;
  v_orders integer := 0;
  v_previous_orders integer := 0;
  v_units numeric := 0;
  v_fees numeric := 0;
  v_shipping numeric := 0;
  v_discounts numeric := 0;
  v_contribution numeric := 0;
  v_previous_contribution numeric := 0;
  v_cancelled_or_returned integer := 0;
  v_previous_cancelled_or_returned integer := 0;
  v_all_orders integer := 0;
  v_previous_all_orders integer := 0;
  v_sales_change_pct numeric;
  v_contribution_change_pct numeric;
  v_exception_rate numeric;
  v_previous_exception_rate numeric;
  v_return_claims integer := 0;
  v_return_claims_amount numeric := 0;

  v_inventory_items integer := 0;
  v_inventory_fresh_items integer := 0;
  v_inventory_costed_items integer := 0;
  v_stockout_skus integer := 0;
  v_stockout_demand_value numeric := 0;
  v_slow_stock_value numeric := 0;
  v_unanalysed_stock_value numeric := 0;
  v_inventory_cost_coverage_pct numeric := 0;

  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_product_cost_coverage_pct numeric := 0;
  v_net_profit numeric;
  v_net_margin_pct numeric;

  v_cash_month date;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_cash_net numeric := 0;

  v_evidence_coverage numeric := 0;
  v_confidence text := 'low';
  v_priority_key text := 'connect_sources';
  v_priority_title text := 'اربط مصدر الطلبات لبدء الملخص التنفيذي';
  v_priority_detail text := 'لا توجد طلبات يمكن بناء قرارات أسبوعية موثوقة عليها.';
  v_priority_path text := '/integrations';
  v_priority_level text := 'high';
  v_priority_category text := 'data_quality';
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  if v_anchor_date is not null then
    v_period_start := v_anchor_date - 6;
    v_previous_start := v_anchor_date - 13;
    v_data_age_days := greatest(0, current_date - v_anchor_date);

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(quantity) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(platform_fee) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(shipping_cost) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(discount_amount) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_sales, v_orders, v_units, v_fees, v_shipping, v_discounts,
         v_contribution, v_cancelled_or_returned, v_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_period_start and v_anchor_date;

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_previous_sales, v_previous_orders, v_previous_contribution,
         v_previous_cancelled_or_returned, v_previous_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_previous_start and v_period_start - 1;

    v_sales_change_pct := case when v_previous_sales > 0
      then round((v_sales - v_previous_sales) / v_previous_sales * 100, 1) end;
    v_contribution_change_pct := case when v_previous_contribution > 0
      then round((v_contribution - v_previous_contribution) / v_previous_contribution * 100, 1) end;
    v_exception_rate := case when v_all_orders > 0
      then round(v_cancelled_or_returned::numeric / v_all_orders * 100, 1) end;
    v_previous_exception_rate := case when v_previous_all_orders > 0
      then round(v_previous_cancelled_or_returned::numeric / v_previous_all_orders * 100, 1) end;

    select count(*)::integer, coalesce(sum(return_amount), 0)
      into v_return_claims, v_return_claims_amount
    from public.returns
    where merchant_code = p_merchant_code
      and return_date between v_period_start and v_anchor_date;
  end if;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and cost_price > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0)::integer,
    coalesce(sum(daily_velocity * 30 * selling_price)
      filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0 and selling_price > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'slow_mover' and stock_value_cost > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'no_sales_data' and stock_value_cost > 0), 0)
  into v_inventory_items, v_inventory_fresh_items, v_inventory_costed_items,
       v_stockout_skus, v_stockout_demand_value, v_slow_stock_value,
       v_unanalysed_stock_value
  from public.inventory_health
  where merchant_code = p_merchant_code;

  v_inventory_cost_coverage_pct := case when v_inventory_fresh_items > 0
    then round(v_inventory_costed_items::numeric / v_inventory_fresh_items * 100, 1)
    else 0 end;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    sum(net_profit) filter (where units_sold > 0 and cost_price > 0),
    case when sum(revenue) filter (where units_sold > 0 and cost_price > 0) > 0
      then round(sum(net_profit) filter (where units_sold > 0 and cost_price > 0)
        / sum(revenue) filter (where units_sold > 0 and cost_price > 0) * 100, 1) end
  into v_sold_products, v_costed_products, v_net_profit, v_net_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_product_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;
  if v_product_cost_coverage_pct < 80 then
    v_net_profit := null;
    v_net_margin_pct := null;
  end if;

  select max(month) into v_cash_month
  from public.monthly_cashflow
  where merchant_code = p_merchant_code;

  if v_cash_month is not null then
    select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0), coalesce(sum(net), 0)
      into v_cash_in, v_cash_out, v_cash_net
    from public.monthly_cashflow
    where merchant_code = p_merchant_code and month = v_cash_month;
  end if;

  v_evidence_coverage :=
    (case when v_anchor_date is not null then 35 else 0 end)
    + (case when v_inventory_fresh_items > 0 then 25 else 0 end)
    + (case when v_cash_month is not null then 20 else 0 end)
    + (case when v_product_cost_coverage_pct >= 80 then 20 else 0 end);
  v_confidence := case
    when v_evidence_coverage >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_evidence_coverage >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;

  if v_anchor_date is null then
    null;
  elsif v_data_age_days > 7 then
    v_priority_key := 'executive_data_stale';
    v_priority_title := 'حدّث بيانات الطلبات قبل اتخاذ قرار أسبوعي';
    v_priority_detail := 'آخر طلب أقدم من 7 أيام، لذلك المقارنة الحالية لا تمثل وضع المتجر الآن.';
    v_priority_path := '/integrations';
    v_priority_level := 'high';
    v_priority_category := 'data_quality';
  elsif v_sold_products > 0 and v_product_cost_coverage_pct < 80 then
    v_priority_key := 'executive_cost_coverage';
    v_priority_title := 'استكمل تكلفة الشراء لاعتماد صافي الربح';
    v_priority_detail := 'التكاليف مكتملة لأقل من 80% من المنتجات المباعة، لذلك أخفى النظام الربح بدل عرض رقم مضلل.';
    v_priority_path := '/products?costs=import';
    v_priority_level := 'urgent';
    v_priority_category := 'profitability';
  elsif coalesce(v_exception_rate, 0) >= 10 then
    v_priority_key := 'executive_order_exceptions';
    v_priority_title := 'راجع ارتفاع الإلغاءات والمرتجعات هذا الأسبوع';
    v_priority_detail := 'تجاوزت الطلبات الملغاة أو المرتجعة 10% من الطلبات المسجلة في الفترة.';
    v_priority_path := '/orders';
    v_priority_level := 'urgent';
    v_priority_category := 'orders';
  elsif v_stockout_skus > 0 then
    v_priority_key := 'executive_stockouts';
    v_priority_title := 'عالج الأصناف النافدة التي لديها طلب سابق';
    v_priority_detail := 'يعرض النظام فقط الأصناف النافدة ذات حركة بيع حديثة وبيانات مخزون محدثة.';
    v_priority_path := '/inventory';
    v_priority_level := 'high';
    v_priority_category := 'inventory';
  elsif v_cash_month is not null and v_cash_net < 0 then
    v_priority_key := 'executive_negative_cashflow';
    v_priority_title := 'راجع صافي التدفق النقدي السلبي';
    v_priority_detail := 'المبالغ الخارجة في آخر شهر مالي متاح تجاوزت المبالغ الداخلة.';
    v_priority_path := '/statement';
    v_priority_level := 'high';
    v_priority_category := 'cashflow';
  elsif coalesce(v_sales_change_pct, 0) <= -15 then
    v_priority_key := 'executive_sales_decline';
    v_priority_title := 'حلّل تراجع المبيعات الأسبوعية';
    v_priority_detail := 'انخفضت المبيعات بأكثر من 15% مقارنة بالأسبوع السابق ضمن آخر بيانات متاحة.';
    v_priority_path := '/orders';
    v_priority_level := 'high';
    v_priority_category := 'demand';
  else
    v_priority_key := 'executive_no_urgent_action';
    v_priority_title := 'لا توجد إشارة تشغيلية عاجلة هذا الأسبوع';
    v_priority_detail := 'استمر في تحديث الطلبات والمخزون والتكاليف للحفاظ على دقة المتابعة.';
    v_priority_path := '/actions';
    v_priority_level := 'medium';
    v_priority_category := 'operations';
  end if;

  return jsonb_build_object(
    'available', v_anchor_date is not null,
    'confidence', v_confidence,
    'evidence_coverage_pct', v_evidence_coverage,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'period', jsonb_build_object(
      'start', v_period_start, 'end', v_anchor_date,
      'previous_start', v_previous_start,
      'previous_end', case when v_period_start is null then null else v_period_start - 1 end
    ),
    'week', jsonb_build_object(
      'sales', round(v_sales, 2), 'previous_sales', round(v_previous_sales, 2),
      'sales_change_pct', v_sales_change_pct,
      'orders', v_orders, 'previous_orders', v_previous_orders,
      'units', v_units,
      'average_order_value', case when v_orders > 0 then round(v_sales / v_orders, 2) else 0 end,
      'contribution_before_product_cost', round(v_contribution, 2),
      'previous_contribution_before_product_cost', round(v_previous_contribution, 2),
      'contribution_change_pct', v_contribution_change_pct,
      'cancelled_or_returned_orders', v_cancelled_or_returned,
      'exception_rate_pct', v_exception_rate,
      'previous_exception_rate_pct', v_previous_exception_rate
    ),
    'confirmed_deductions', jsonb_build_object(
      'platform_fees', round(v_fees, 2),
      'shipping', round(v_shipping, 2),
      'discounts', round(v_discounts, 2),
      'return_claims_count', v_return_claims,
      'return_claims_amount', round(v_return_claims_amount, 2),
      'total_excluding_returns', round(v_fees + v_shipping + v_discounts, 2)
    ),
    'inventory_risk', jsonb_build_object(
      'available', v_inventory_fresh_items > 0,
      'items', v_inventory_items,
      'fresh_items', v_inventory_fresh_items,
      'cost_coverage_pct', v_inventory_cost_coverage_pct,
      'stockout_skus', v_stockout_skus,
      'stockout_historical_30d_demand_value', round(v_stockout_demand_value, 2),
      'slow_stock_value', round(v_slow_stock_value, 2),
      'unanalysed_stock_value', round(v_unanalysed_stock_value, 2)
    ),
    'profitability', jsonb_build_object(
      'available', v_product_cost_coverage_pct >= 80 and v_sold_products > 0,
      'sold_products', v_sold_products,
      'costed_products', v_costed_products,
      'cost_coverage_pct', v_product_cost_coverage_pct,
      'net_profit', v_net_profit,
      'net_margin_pct', v_net_margin_pct,
      'minimum_coverage_pct', 80
    ),
    'cash', jsonb_build_object(
      'available', v_cash_month is not null,
      'month', v_cash_month,
      'cash_in', round(v_cash_in, 2),
      'cash_out', round(v_cash_out, 2),
      'net', round(v_cash_net, 2)
    ),
    'top_priority', jsonb_build_object(
      'source_key', v_priority_key,
      'title', v_priority_title,
      'detail', v_priority_detail,
      'path', v_priority_path,
      'priority', v_priority_level,
      'category', v_priority_category,
      'actionable', v_priority_key <> 'executive_no_urgent_action'
    )
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.admin_ad_performance(text, uuid, text, text, text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('c247d9b553d1bc71209f0d90930ef2db', 'bc9571c936e8c0a85016b510ec608592') THEN
    RAISE EXCEPTION 'Unexpected definition for security.admin_ad_performance; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.admin_ad_performance(p_merchant_code text, p_upload_id uuid DEFAULT NULL::uuid, p_platform text DEFAULT NULL::text, p_group_by text DEFAULT 'campaign'::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT security.has_platform_permission('manage_ads') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE merchant_code = p_merchant_code AND role = 'merchant') THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  IF p_group_by NOT IN ('campaign', 'sku', 'query') THEN
    RAISE EXCEPTION 'invalid advertising group' USING errcode = '22023';
  END IF;

  WITH filtered AS (
    SELECT am.* FROM public.ad_metrics am
    WHERE am.merchant_code = p_merchant_code
      AND (p_upload_id IS NULL OR am.upload_id = p_upload_id)
      AND (p_platform IS NULL OR am.platform = p_platform)
      AND (
        NULLIF(btrim(p_search), '') IS NULL
        OR coalesce(am.campaign_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.sku, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.search_query, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ), totals AS (
    SELECT count(*) rows, coalesce(sum(spend), 0) spend, coalesce(sum(revenue), 0) revenue,
      coalesce(sum(impressions), 0) impressions, coalesce(sum(clicks), 0) clicks,
      coalesce(sum(orders), 0) orders FROM filtered
  ), grouped AS (
    SELECT CASE p_group_by
        WHEN 'campaign' THEN coalesce(nullif(campaign_name, ''), nullif(ad_group_name, ''), 'بلا اسم')
        WHEN 'sku' THEN coalesce(nullif(sku, ''), '—')
        ELSE coalesce(nullif(search_query, ''), '—') END key,
      platform, sum(impressions) impressions, sum(clicks) clicks, sum(orders) orders,
      sum(spend) spend, sum(revenue) revenue, count(*) rows
    FROM filtered GROUP BY 1, platform ORDER BY sum(spend) DESC LIMIT 200
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'groups', coalesce((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(platform ORDER BY platform) FROM (SELECT DISTINCT platform FROM filtered) p), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;$reviewed_sql$;

END
$analytics_compat$;


-- Recover the missing service schema with a draft form, not the historical published seed.
-- Restore the documented service-request schema only when all five tables
-- are absent. Existing tables/data are preserved; partial drift fails closed.
-- This is a new forward migration, not migration-ledger repair. New forms are
-- drafts; publishing a public intake form remains an explicit admin action.
do $recovery$
declare present integer; t text;
begin
 select count(*) into present from information_schema.tables where table_schema='public'
 and table_name=any(array['service_request_forms','service_request_questions','service_request_stages','service_request_submissions','service_request_activities']);
 if present not in (0,5) then raise exception 'Partial service-request schema; reviewed recovery required'; end if;
 if present=0 then
 execute $schema$
-- Configurable public service-request forms and their internal follow-up
-- pipeline. Public traffic is accepted only by the pricing-request Edge
-- Function; authenticated platform administrators manage these tables via RLS.

create table public.service_request_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 2 and 160),
  description text not null default '' check (char_length(description) <= 500),
  is_published boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_request_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null check (char_length(label) between 2 and 200),
  type text not null check (type in ('short_text','long_text','single_choice','multiple_choice','dropdown','url','file')),
  help_text text not null default '' check (char_length(help_text) <= 500),
  placeholder text not null default '' check (char_length(placeholder) <= 160),
  required boolean not null default false,
  position integer not null check (position >= 0),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, key)
);

create table public.service_request_stages (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  color text not null default '#078d92' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null check (position >= 0),
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, name)
);

create table public.service_request_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.service_request_forms(id) on delete restrict,
  reference_code text not null unique,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  contact_email text check (contact_email is null or char_length(contact_email) between 5 and 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) between 9 and 32),
  current_stage_id uuid not null references public.service_request_stages(id) on delete restrict,
  source_hash text not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_request_activities (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_request_submissions(id) on delete cascade,
  stage_id uuid references public.service_request_stages(id) on delete set null,
  activity_type text not null check (activity_type in ('created','stage_changed','note','link','attachment')),
  content text not null default '' check (char_length(content) <= 4000),
  link_url text check (link_url is null or char_length(link_url) <= 1000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index service_request_questions_order_idx on public.service_request_questions(form_id, position);
create index service_request_stages_order_idx on public.service_request_stages(form_id, position);
create index service_request_submissions_pipeline_idx on public.service_request_submissions(form_id, current_stage_id, submitted_at desc);
create index service_request_submissions_rate_idx on public.service_request_submissions(source_hash, submitted_at desc);
create index service_request_activities_timeline_idx on public.service_request_activities(request_id, created_at desc);

create trigger service_request_forms_updated_at before update on public.service_request_forms
for each row execute function public.update_updated_at();
create trigger service_request_questions_updated_at before update on public.service_request_questions
for each row execute function public.update_updated_at();
create trigger service_request_stages_updated_at before update on public.service_request_stages
for each row execute function public.update_updated_at();
create trigger service_request_submissions_updated_at before update on public.service_request_submissions
for each row execute function public.update_updated_at();

alter table public.service_request_forms enable row level security;
alter table public.service_request_questions enable row level security;
alter table public.service_request_stages enable row level security;
alter table public.service_request_submissions enable row level security;
alter table public.service_request_activities enable row level security;

create policy service_request_forms_admin_all on public.service_request_forms for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_questions_admin_all on public.service_request_questions for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_stages_admin_all on public.service_request_stages for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_submissions_admin_all on public.service_request_submissions for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy service_request_activities_admin_select on public.service_request_activities for select to authenticated
using ((select public.is_admin()));
create policy service_request_activities_admin_insert on public.service_request_activities for insert to authenticated
with check ((select public.is_admin()));

grant select, insert, update, delete on public.service_request_forms to authenticated;
grant select, insert, update, delete on public.service_request_questions to authenticated;
grant select, insert, update, delete on public.service_request_stages to authenticated;
grant select, insert, update, delete on public.service_request_submissions to authenticated;
grant select, insert on public.service_request_activities to authenticated;
revoke all on public.service_request_forms, public.service_request_questions,
  public.service_request_stages, public.service_request_submissions,
  public.service_request_activities from anon;


$schema$;
 end if;
 if not exists(select 1 from public.service_request_forms where slug='sellpert-service-request') then
 execute $seed$
-- Seed the initial Sellpert intake form and the requested default pipeline.
with inserted_form as (
  insert into public.service_request_forms (name, slug, title, description, is_published)
  values ('طلب خدمة Sellpert', 'sellpert-service-request', 'طلب عرض سعر',
    'أخبرنا عن نشاطك لنجهّز لك عرضاً يناسب قنوات البيع واحتياجك.', false)
  returning id
)
insert into public.service_request_stages (form_id, name, color, position, is_terminal)
select id, stage.name, stage.color, stage.position, stage.is_terminal
from inserted_form
cross join (values
  ('تسجيل جديد', '#2f80ed', 0, false),
  ('جاري دراسة الطلب', '#d99a17', 1, false),
  ('التنسيق للاجتماع', '#8767c7', 2, false),
  ('تم تحديد الاجتماع', '#178f88', 3, false),
  ('تم إرسال العقد', '#db7b32', 4, false),
  ('تم توقيع العقد', '#2d9b5f', 5, true)
) as stage(name, color, position, is_terminal);

with target_form as (select id from public.service_request_forms where slug = 'sellpert-service-request')
insert into public.service_request_questions
  (form_id, key, label, type, help_text, placeholder, required, position, options, config)
select target_form.id, q.key, q.label, q.type, q.help_text, q.placeholder, q.required, q.position, q.options::jsonb, q.config::jsonb
from target_form
cross join (values
  ('signer_name', 'اسم الشخص المخول بالتوقيع', 'short_text', '', 'أدخل الاسم الكامل', true, 0, '[]', '{"section":"contact","format":"name"}'),
  ('business_email', 'البريد الإلكتروني للعمل', 'short_text', '', 'name@company.com', true, 1, '[]', '{"section":"contact","format":"email"}'),
  ('phone', 'رقم الجوال', 'short_text', '', '5xxxxxxxx', true, 2, '[]', '{"section":"contact","format":"saudi_phone"}'),
  ('store_url', 'رابط المتجر', 'url', 'اختياري', 'https://', false, 3, '[]', '{"section":"contact"}'),
  ('product_count', 'عدد المنتجات التي ترغب في عرضها', 'short_text', '', 'مثال: 120', true, 4, '[]', '{"section":"business","format":"number"}'),
  ('product_category', 'تصنيف المنتجات', 'dropdown', '', '', true, 5, '["العناية والجمال","الأزياء والملابس","الأجهزة والإلكترونيات","المنزل والمطبخ","الأغذية والمشروبات","أخرى"]', '{"section":"business"}'),
  ('existing_channels', 'القنوات التي لديك حساب قائم فيها', 'multiple_choice', '', '', false, 6, '["نون","أمازون","ترنديول"]', '{"section":"business"}'),
  ('desired_channels', 'القنوات التي ترغب في العمل عليها معنا', 'multiple_choice', '', '', true, 7, '["نون","أمازون","ترنديول"]', '{"section":"business","min":1}'),
  ('noon_url', 'رابط متجرك على نون', 'url', 'إن وجد', 'https://', false, 8, '[]', '{"section":"channels"}'),
  ('amazon_url', 'رابط متجرك على أمازون', 'url', 'إن وجد', 'https://', false, 9, '[]', '{"section":"channels"}'),
  ('trendyol_url', 'رابط متجرك على ترنديول', 'url', 'إن وجد', 'https://', false, 10, '[]', '{"section":"channels"}'),
  ('entity_type', 'نوع الكيان', 'single_choice', '', '', true, 11, '["شركة / مؤسسة","وثيقة عمل حر"]', '{"section":"documents"}'),
  ('entity_document', 'السجل التجاري / وثيقة العمل الحر', 'file', '', '', true, 12, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('trademark_status', 'هل لديك علامة تجارية خاصة؟', 'single_choice', '', '', true, 13, '["نعم ومسجلة","نعم لكن غير مسجلة","لا توجد علامة تجارية خاصة"]', '{"section":"documents"}'),
  ('trademark_certificate', 'شهادة العلامة التجارية', 'file', 'إن وجدت', '', false, 14, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('national_address', 'العنوان الوطني للمؤسسة', 'file', 'إن وجد', '', false, 15, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}'),
  ('tax_certificate', 'الشهادة الضريبية', 'file', 'إن وجدت', '', false, 16, '[]', '{"section":"documents","accept":["application/pdf","image/jpeg","image/png"],"max_mb":5}')
) as q(key, label, type, help_text, placeholder, required, position, options, config);

comment on table public.service_request_submissions is
  'Service leads with dynamic answers and a configurable current pipeline stage.';
comment on table public.service_request_activities is
  'Operational timeline for notes, links, attachments, and stage changes.';

$seed$;
 end if;
 foreach t in array array['service_request_forms','service_request_questions','service_request_stages','service_request_submissions','service_request_activities'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('alter table public.%I force row level security',t);
   execute format('grant all on public.%I to service_role',t);
   if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='sellpert_require_mfa_if_enrolled') then
     execute format('create policy sellpert_require_mfa_if_enrolled on public.%I as restrictive for all to authenticated using ((select security.mfa_access_allowed())) with check ((select security.mfa_access_allowed()))',t);
   end if;
 end loop;
end $recovery$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-request-documents', 'service-request-documents', false, 5242880,
  array['application/pdf', 'image/jpeg', 'image/png']::text[])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_select') then execute $ddl$create policy service_request_documents_admin_select on storage.objects for select to authenticated
using (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_insert') then execute $ddl$create policy service_request_documents_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;
do $policy$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='service_request_documents_admin_delete') then execute $ddl$create policy service_request_documents_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'service-request-documents' and (select public.is_admin()))$ddl$; end if; end $policy$;

-- Tables added after the shared boundary migrations need the same restrictive
-- guards. This migration grants no access and preserves every existing
-- permissive policy, server-only grant boundary, and provider write path.
-- Requires the Omniful and 20260828083527_pricing_requests migrations first.

DO $remaining_mfa_boundaries$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'omniful_account_credentials',
    'omniful_channel_assignments',
    'omniful_channels',
    'omniful_provider_accounts'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name
        AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Required RLS table public.% is missing or unprotected', table_name;
    END IF;

    EXECUTE format(
      'CREATE POLICY sellpert_require_mfa_if_enrolled ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.mfa_access_allowed())) WITH CHECK ((SELECT security.mfa_access_allowed()))',
      table_name
    );
  END LOOP;
END
$remaining_mfa_boundaries$;

DO $remaining_tenant_boundaries$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'omniful_account_credentials',
    'omniful_channel_assignments'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.can_access_merchant(merchant_code))) WITH CHECK ((SELECT security.can_access_merchant(merchant_code)))',
      table_name
    );
  END LOOP;
END
$remaining_tenant_boundaries$;

select pg_temp.assert_release_catalog('e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b');
insert into release_verified_snapshot values('e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b');

-- Individual reviewed version 20260801000000: final_effects_and_supersession; immutable source eb9cb19f04d2403ec53d2eb722668478963cd4fe988c17df72915f3d8959d000.
do $entry_20260801000000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260801000000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260801000000') then raise exception 'ENTRY_ALREADY_PRESENT_20260801000000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260801000000','baseline_schema',array[$receipt$-- Reconciled final effects without replay; migration SHA256 eb9cb19f04d2403ec53d2eb722668478963cd4fe988c17df72915f3d8959d000; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260801000000$;

-- Individual reviewed version 20260802190000: final_effects_and_supersession; immutable source 9ba86e8cb5897355ec4030733d43e6ab63091e410f7df458a41c53b0475d748a.
do $entry_20260802190000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260802190000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260802190000') then raise exception 'ENTRY_ALREADY_PRESENT_20260802190000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260802190000','marketplace_oauth_states',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9ba86e8cb5897355ec4030733d43e6ab63091e410f7df458a41c53b0475d748a; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260802190000$;

-- Individual reviewed version 20260802193000: recorded_sql_exact; immutable source a2c9720f52ebb7f1bd2833d9a9b2c7579d20f6f70f28fbb03fd2cd5c5703f35b.
do $entry_20260802193000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260802193000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802192845' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='14d0375a9ff40be6161e7a371065c2cd9ea7cf0774261879a36dad567827ca13') then raise exception 'COUNTERPART_CHANGED_20260802193000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260802193000') then raise exception 'ENTRY_ALREADY_PRESENT_20260802193000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260802193000','fix_queue_worker_cron_auth',array[$receipt$-- Reconciled final effects without replay; migration SHA256 a2c9720f52ebb7f1bd2833d9a9b2c7579d20f6f70f28fbb03fd2cd5c5703f35b; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260802193000$;

-- Individual reviewed version 20260802213000: final_effects_and_supersession; immutable source 5e9e7b28757379a312b6113959688129b97eaf9c8ec9f3b015e7eb93c5605180.
do $entry_20260802213000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260802213000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260802213000') then raise exception 'ENTRY_ALREADY_PRESENT_20260802213000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260802213000','complete_trendyol_api_sync',array[$receipt$-- Reconciled final effects without replay; migration SHA256 5e9e7b28757379a312b6113959688129b97eaf9c8ec9f3b015e7eb93c5605180; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260802213000$;

-- Individual reviewed version 20260802223000: final_effects_and_supersession; immutable source 9ffc16f3c045712f5b5f257d00dad9171e82095469867ab754110183878230db.
do $entry_20260802223000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260802223000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260802223000') then raise exception 'ENTRY_ALREADY_PRESENT_20260802223000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260802223000','trendyol_action_audit',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9ffc16f3c045712f5b5f257d00dad9171e82095469867ab754110183878230db; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260802223000$;

-- Individual reviewed version 20260802233000: final_effects_and_supersession; immutable source 9a76d797c01c21b91d85bf8b08bb49c30c9e58a1c6de02bd762f644866085ba0.
do $entry_20260802233000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260802233000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260802233000') then raise exception 'ENTRY_ALREADY_PRESENT_20260802233000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260802233000','trendyol_order_items',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9a76d797c01c21b91d85bf8b08bb49c30c9e58a1c6de02bd762f644866085ba0; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260802233000$;

-- Individual reviewed version 20260803105830: final_effects_and_supersession; immutable source 6d3a704b902460a899d57e23997d6d59b5131036ef45b5614045db84791f0bf1.
do $entry_20260803105830$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803105830'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803105830') then raise exception 'ENTRY_ALREADY_PRESENT_20260803105830'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803105830','revoke_dangerous_table_privileges',array[$receipt$-- Reconciled final effects without replay; migration SHA256 6d3a704b902460a899d57e23997d6d59b5131036ef45b5614045db84791f0bf1; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803105830$;

-- Individual reviewed version 20260803115000: final_effects_and_supersession; immutable source 771f3962c034cc26b5b3deadd23ef8dce9c246c95df116a1940bc269e5bdfff3.
do $entry_20260803115000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803115000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803115000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803115000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803115000','bootstrap_security_access_context',array[$receipt$-- Reconciled final effects without replay; migration SHA256 771f3962c034cc26b5b3deadd23ef8dce9c246c95df116a1940bc269e5bdfff3; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803115000$;

-- Individual reviewed version 20260803142203: recorded_sql_exact; immutable source 70f1df394056c60ff3dec81edc9417f8606c2154ef8cf3cbbc66cd818db581d6.
do $entry_20260803142203$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803142203'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803142525' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='270a2e4476a44fd25e723b401668d33f94c4bf11fb7b363b37c71926e9e07fa8') then raise exception 'COUNTERPART_CHANGED_20260803142203'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803142203') then raise exception 'ENTRY_ALREADY_PRESENT_20260803142203'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803142203','add_mfa_recovery_codes',array[$receipt$-- Reconciled final effects without replay; migration SHA256 70f1df394056c60ff3dec81edc9417f8606c2154ef8cf3cbbc66cd818db581d6; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803142203$;

-- Individual reviewed version 20260803143000: recorded_sql_exact; immutable source 63ce4054e28f22917a53510e2242f635d7a93d1a2278e8288a98d5770fe26da6.
do $entry_20260803143000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803143000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802212917' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='4535f51f4af8bdf1b3069611b10ea882b562d0227c5f1eb033f16b7418c32ea2') then raise exception 'COUNTERPART_CHANGED_20260803143000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803143000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803143000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803143000','merchant_self_service_and_isolated_imports',array[$receipt$-- Reconciled final effects without replay; migration SHA256 63ce4054e28f22917a53510e2242f635d7a93d1a2278e8288a98d5770fe26da6; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803143000$;

-- Individual reviewed version 20260803143220: recorded_sql_exact; immutable source 8dea1a38cabf27923065e579265bfd7a8b282a2046ea34620f7ea98898505bad.
do $entry_20260803143220$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803143220'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803143236' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='6d66bbd6582440611ccbf22af09b3d1b9ed3f7d0e8356f1cdf837cbe3f611d5d') then raise exception 'COUNTERPART_CHANGED_20260803143220'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803143220') then raise exception 'ENTRY_ALREADY_PRESENT_20260803143220'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803143220','add_mfa_recovery_deny_policies',array[$receipt$-- Reconciled final effects without replay; migration SHA256 8dea1a38cabf27923065e579265bfd7a8b282a2046ea34620f7ea98898505bad; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803143220$;

-- Individual reviewed version 20260803143358: recorded_sql_exact; immutable source 9020261f72ef6438b44112751181de752b5b26fc013eb6ed857f9e5698ee347c.
do $entry_20260803143358$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803143358'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803143429' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='3a1d304886641a108b253e00187a36cf316713dd5a0e48cc228196df2dc240ca') then raise exception 'COUNTERPART_CHANGED_20260803143358'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803143358') then raise exception 'ENTRY_ALREADY_PRESENT_20260803143358'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803143358','enforce_opt_in_mfa_across_data_api',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9020261f72ef6438b44112751181de752b5b26fc013eb6ed857f9e5698ee347c; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803143358$;

-- Individual reviewed version 20260803144500: recorded_sql_exact; immutable source 63a17a9a0644695cba6e78cb020c1726b8b29254fd401a605384cc61868a91b4.
do $entry_20260803144500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803144500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802213400' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='43bb2df4ab039b0af49e6a452fd4ac10dd5da96366514cfb9364f87a8c785267') then raise exception 'COUNTERPART_CHANGED_20260803144500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803144500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803144500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803144500','remove_duplicate_upload_index',array[$receipt$-- Reconciled final effects without replay; migration SHA256 63a17a9a0644695cba6e78cb020c1726b8b29254fd401a605384cc61868a91b4; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803144500$;

-- Individual reviewed version 20260803145000: final_effects_and_supersession; immutable source 8caa1443e759381026a4dc0030a9a4f17ffedd3974acc8745323509829df607c.
do $entry_20260803145000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803145000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803145000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803145000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803145000','prepare_privileged_rpc_move',array[$receipt$-- Reconciled final effects without replay; migration SHA256 8caa1443e759381026a4dc0030a9a4f17ffedd3974acc8745323509829df607c; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803145000$;

-- Individual reviewed version 20260803145656: recorded_sql_exact; immutable source a3654d8a5f35fc0be45f07c783cb627cf4d572d5e2c6195b6a9c21eb409914f2.
do $entry_20260803145656$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803145656'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803150136' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='12447ac7a98f9643a52d868eb1adc10c0806f283181e79b08d269d6e745de815') then raise exception 'COUNTERPART_CHANGED_20260803145656'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803145656') then raise exception 'ENTRY_ALREADY_PRESENT_20260803145656'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803145656','move_privileged_rpcs_to_security',array[$receipt$-- Reconciled final effects without replay; migration SHA256 a3654d8a5f35fc0be45f07c783cb627cf4d572d5e2c6195b6a9c21eb409914f2; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803145656$;

-- Individual reviewed version 20260803150324: recorded_sql_exact; immutable source a63e248f3d5659b0666185dfb2998eddb7b00f21c234126d72c02b82d9b475c6.
do $entry_20260803150324$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803150324'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803150503' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f6efb053578a6b16eb8811e407e3577f64f8a349f4f4bfd668c6e429d73aecad') then raise exception 'COUNTERPART_CHANGED_20260803150324'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803150324') then raise exception 'ENTRY_ALREADY_PRESENT_20260803150324'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803150324','fix_mfa_policy_auth_boundary',array[$receipt$-- Reconciled final effects without replay; migration SHA256 a63e248f3d5659b0666185dfb2998eddb7b00f21c234126d72c02b82d9b475c6; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803150324$;

-- Individual reviewed version 20260803151000: final_effects_and_supersession; immutable source 0bb2d1d9f763d5590a322278a2566c18b33dc80177eb7dbb11a2bdc9fe6002ab.
do $entry_20260803151000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803151000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803151000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803151000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803151000','bootstrap_analytics_authorization',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0bb2d1d9f763d5590a322278a2566c18b33dc80177eb7dbb11a2bdc9fe6002ab; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803151000$;

-- Individual reviewed version 20260803151143: final_effects_and_supersession; immutable source 78242267a7dd34eaefb5bc94643002acc4478cd4b12e7efdafddf09c12051fcb.
do $entry_20260803151143$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803151143'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803151143') then raise exception 'ENTRY_ALREADY_PRESENT_20260803151143'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803151143','secure_merchant_request_creation_and_analytics_inputs',array[$receipt$-- Reconciled final effects without replay; migration SHA256 78242267a7dd34eaefb5bc94643002acc4478cd4b12e7efdafddf09c12051fcb; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803151143$;

-- Individual reviewed version 20260803151441: final_effects_and_supersession; immutable source 314cf7331ecc22e2a5cd6ed433277c9d59e3b45797deb0200f3c43ab5f0fa9d1.
do $entry_20260803151441$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803151441'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803151441') then raise exception 'ENTRY_ALREADY_PRESENT_20260803151441'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803151441','restore_merchant_request_tenant_read',array[$receipt$-- Reconciled final effects without replay; migration SHA256 314cf7331ecc22e2a5cd6ed433277c9d59e3b45797deb0200f3c43ab5f0fa9d1; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803151441$;

-- Individual reviewed version 20260803152500: recorded_sql_exact; immutable source de1b92f7822b865a9fcec1c0018520ee06df23c4824eafb4ea9549a79aee92f6.
do $entry_20260803152500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803152500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803121521' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='926e99f527d6de230a8d085b36bd986474fd0373a430568866f99f08acbf017f') then raise exception 'COUNTERPART_CHANGED_20260803152500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803152500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803152500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803152500','remove_email_authorization_and_seal_credentials',array[$receipt$-- Reconciled final effects without replay; migration SHA256 de1b92f7822b865a9fcec1c0018520ee06df23c4824eafb4ea9549a79aee92f6; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803152500$;

-- Individual reviewed version 20260803153500: recorded_sql_exact; immutable source fd7349a2bde50533107be6c5c41adcb2e51edf4b5fb64878779598980fa2c080.
do $entry_20260803153500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803153500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803122528' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='3182166561d85ad80548b4c6c52b04e2f3d44276e3bcce572156bc8c961e21ce') then raise exception 'COUNTERPART_CHANGED_20260803153500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803153500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803153500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803153500','restore_secured_fee_reference_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 fd7349a2bde50533107be6c5c41adcb2e51edf4b5fb64878779598980fa2c080; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803153500$;

-- Individual reviewed version 20260803154500: final_effects_and_supersession; immutable source cc7b7ad9308764caf9dfb841903fd9ca5635d3095f0a59aac0973eb2211c23fa.
do $entry_20260803154500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803154500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803154500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803154500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803154500','complete_linked_workspace_operations',array[$receipt$-- Reconciled final effects without replay; migration SHA256 cc7b7ad9308764caf9dfb841903fd9ca5635d3095f0a59aac0973eb2211c23fa; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803154500$;

-- Individual reviewed version 20260803154700: final_effects_and_supersession; immutable source f148472d79944868571c0f5fab0ff32b5759406ffed77d81961f822987a1fb4e.
do $entry_20260803154700$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803154700'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803154700') then raise exception 'ENTRY_ALREADY_PRESENT_20260803154700'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803154700','expose_safe_sync_freshness_metric',array[$receipt$-- Reconciled final effects without replay; migration SHA256 f148472d79944868571c0f5fab0ff32b5759406ffed77d81961f822987a1fb4e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803154700$;

-- Individual reviewed version 20260803162500: recorded_sql_exact; immutable source 90d21909d12e27510fafd4811b985d196d19bacf4c2c9cc9da4ad1a047d9d015.
do $entry_20260803162500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803162500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802223158' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='c308fe47a52d53f2794b094c838e82b71e50ac8d472af2707bdf7fc9e166ec6c') then raise exception 'COUNTERPART_CHANGED_20260803162500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803162500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803162500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803162500','product_listing_delivery_status',array[$receipt$-- Reconciled final effects without replay; migration SHA256 90d21909d12e27510fafd4811b985d196d19bacf4c2c9cc9da4ad1a047d9d015; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803162500$;

-- Individual reviewed version 20260803184500: final_effects_and_supersession; immutable source 9a3dd777eaf9a8365ce236d7c6be74366215e32f6f8479b03b157d003dba42f2.
do $entry_20260803184500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803184500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803184500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803184500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803184500','harden_multi_tenant_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9a3dd777eaf9a8365ce236d7c6be74366215e32f6f8479b03b157d003dba42f2; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803184500$;

-- Individual reviewed version 20260803190000: recorded_sql_exact; immutable source 71defa4e6ed3b6727781580fdc3cfdc5b8a6dbeb5eb41c1d897d073dbe6fb16c.
do $entry_20260803190000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803190000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802230413' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f58eb0128abe743f0c8cbe16feb76a25ff639b71cb802f602a2147463284e585') then raise exception 'COUNTERPART_CHANGED_20260803190000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803190000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803190000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803190000','allow_employee_owner_identity',array[$receipt$-- Reconciled final effects without replay; migration SHA256 71defa4e6ed3b6727781580fdc3cfdc5b8a6dbeb5eb41c1d897d073dbe6fb16c; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803190000$;

-- Individual reviewed version 20260803193000: final_effects_and_supersession; immutable source 10a1c07eac5a797c11517b68cad36ab4b7b90e89bdd3d1c85c07b0efaa935ab6.
do $entry_20260803193000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803193000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803193000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803193000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803193000','guard_privileged_rpcs',array[$receipt$-- Reconciled final effects without replay; migration SHA256 10a1c07eac5a797c11517b68cad36ab4b7b90e89bdd3d1c85c07b0efaa935ab6; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803193000$;

-- Individual reviewed version 20260803194500: recorded_sql_exact; immutable source 7766ddb359c02a008d20f080df8abff053442d2083afc8d8ec334e54aaa7e658.
do $entry_20260803194500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803194500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802231147' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f0decbd43dcae03de8941329476700894de10695a8b49ea881c52a2024800180') then raise exception 'COUNTERPART_CHANGED_20260803194500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803194500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803194500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803194500','employee_tenant_read_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 7766ddb359c02a008d20f080df8abff053442d2083afc8d8ec334e54aaa7e658; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803194500$;

-- Individual reviewed version 20260803203000: recorded_sql_exact; immutable source afdb6764f7a3a6b55def24a2e90782d329dddde937df0633f139a2af06df1ee5.
do $entry_20260803203000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803203000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802232151' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='2452395b2c85e4cb9f8c5b3aadb709e502e3c0502dbe6f9e5ebbc254832e40b1') then raise exception 'COUNTERPART_CHANGED_20260803203000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803203000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803203000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803203000','enforce_merchant_employee_permissions',array[$receipt$-- Reconciled final effects without replay; migration SHA256 afdb6764f7a3a6b55def24a2e90782d329dddde937df0633f139a2af06df1ee5; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803203000$;

-- Individual reviewed version 20260803204500: recorded_sql_exact; immutable source 6eda0e13771d65cd5a0de2c533912f1d40293c5713293354ad703da6606fbe50.
do $entry_20260803204500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803204500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802232457' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='ffcfff5c0f87d97a0a0a4a0524d34dafc6fb39ca72b132ff1f6a5ab055c18ff6') then raise exception 'COUNTERPART_CHANGED_20260803204500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803204500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803204500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803204500','secure_store_profile_updates',array[$receipt$-- Reconciled final effects without replay; migration SHA256 6eda0e13771d65cd5a0de2c533912f1d40293c5713293354ad703da6606fbe50; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803204500$;

-- Individual reviewed version 20260803210000: recorded_sql_exact; immutable source 481df21f0a8421423b98999d8c83de463df8902b728f2716ed86b09dc0019bf1.
do $entry_20260803210000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803210000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802232758' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='b8eef979534b7ad0d1dfda639bf509f78754e6829766a403b1b36b5280f8a05d') then raise exception 'COUNTERPART_CHANGED_20260803210000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803210000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803210000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803210000','secure_merchant_logo_storage',array[$receipt$-- Reconciled final effects without replay; migration SHA256 481df21f0a8421423b98999d8c83de463df8902b728f2716ed86b09dc0019bf1; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803210000$;

-- Individual reviewed version 20260803214500: final_effects_and_supersession; immutable source 10621aa57a789fe0a0189243b122c3d2965f9b7279a1bae8ae42f4a1fb43112e.
do $entry_20260803214500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803214500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803214500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803214500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803214500','index_marketplace_foreign_keys',array[$receipt$-- Reconciled final effects without replay; migration SHA256 10621aa57a789fe0a0189243b122c3d2965f9b7279a1bae8ae42f4a1fb43112e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803214500$;

-- Individual reviewed version 20260803223000: recorded_sql_exact; immutable source d6dafbe5ca93ee559ea3b3660221292506b88a6d3993f795ca9ccbcfc893b4c8.
do $entry_20260803223000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803223000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802234321' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='e4880092ac9817d7922e5ea133221dd91f97c6b7b330af88a893f2875d4b3bac') then raise exception 'COUNTERPART_CHANGED_20260803223000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803223000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803223000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803223000','separate_platform_staff_role',array[$receipt$-- Reconciled final effects without replay; migration SHA256 d6dafbe5ca93ee559ea3b3660221292506b88a6d3993f795ca9ccbcfc893b4c8; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803223000$;

-- Individual reviewed version 20260803224000: final_effects_and_supersession; immutable source e03a1f2919fd79f2a129384758dcc29af88acc2630ead9391410df34d2289006.
do $entry_20260803224000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803224000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803224000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803224000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803224000','expand_merchant_roles',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e03a1f2919fd79f2a129384758dcc29af88acc2630ead9391410df34d2289006; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803224000$;

-- Individual reviewed version 20260803230000: recorded_sql_exact; immutable source d8f87da75810608d0cb5ad3e3038ec1fc4fbdca39fffa2c4285f6ab63e3f83a3.
do $entry_20260803230000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803230000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802235000' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='cd0e6dca6c4d7463a635a478a10478d2c62ebb99279eb4aa2a40e3119b9ada24') then raise exception 'COUNTERPART_CHANGED_20260803230000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803230000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803230000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803230000','guard_staff_privileged_rpcs',array[$receipt$-- Reconciled final effects without replay; migration SHA256 d8f87da75810608d0cb5ad3e3038ec1fc4fbdca39fffa2c4285f6ab63e3f83a3; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803230000$;

-- Individual reviewed version 20260803233000: recorded_sql_exact; immutable source 9941005061e35713ecea5b7574dc03b7422f80f1568975210cf21701ef48e04f.
do $entry_20260803233000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803233000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802235559' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='088455582e999e9c253599bcecc35192a86b2d2424592ab35f26366773dfae1d') then raise exception 'COUNTERPART_CHANGED_20260803233000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803233000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803233000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803233000','optimize_rls_access_context',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9941005061e35713ecea5b7574dc03b7422f80f1568975210cf21701ef48e04f; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803233000$;

-- Individual reviewed version 20260803234000: recorded_sql_differs_only_in_leading_comments; immutable source c2099a5643d7f911b31cde472f4a97a1d3a10f66c77c4d8e525481ddbc64d750.
do $entry_20260803234000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803234000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260802235730' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='881944f6cb59078e8998820e279fe3a7b1c38e6a6467507f534ad8746c8e2f48') then raise exception 'COUNTERPART_CHANGED_20260803234000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803234000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803234000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803234000','remove_legacy_amazon_rls_policy',array[$receipt$-- Reconciled final effects without replay; migration SHA256 c2099a5643d7f911b31cde472f4a97a1d3a10f66c77c4d8e525481ddbc64d750; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803234000$;

-- Individual reviewed version 20260803240000: recorded_sql_exact; immutable source b95a0c0b71c409f862ad7d5c64dc958218c566f06d3d6ed4c00800738e2b8d34.
do $entry_20260803240000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803240000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803000347' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='d08d8dd4abe148a28fc316c818e75f277593885bedf3c00aa15bf454c6d0c7bb') then raise exception 'COUNTERPART_CHANGED_20260803240000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803240000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803240000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803240000','enable_immutable_security_audit_log',array[$receipt$-- Reconciled final effects without replay; migration SHA256 b95a0c0b71c409f862ad7d5c64dc958218c566f06d3d6ed4c00800738e2b8d34; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803240000$;

-- Individual reviewed version 20260803241000: recorded_sql_exact; immutable source 7c129472adae088a89b3109d1d54a85210ae11ffe6fc1403fe859f4fa4daf94a.
do $entry_20260803241000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803241000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803001056' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='99a8c2959395703996a2aae2aba3703e8aec8876c30cf2b75d7d3ff85e4966aa') then raise exception 'COUNTERPART_CHANGED_20260803241000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803241000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803241000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803241000','monitor_marketplace_sync_health',array[$receipt$-- Reconciled final effects without replay; migration SHA256 7c129472adae088a89b3109d1d54a85210ae11ffe6fc1403fe859f4fa4daf94a; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803241000$;

-- Individual reviewed version 20260803242000: recorded_sql_exact; immutable source 499d60173a8d53fce2c96ae8747ea4ee74d69cbf22ea4548c876b3bc9566478a.
do $entry_20260803242000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803242000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803002450' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='dd8821aaaa5c91c83af20d19fa5bd405c340d656996459c865bc00ab8d06df6b') then raise exception 'COUNTERPART_CHANGED_20260803242000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803242000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803242000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803242000','model_marketplace_order_packages',array[$receipt$-- Reconciled final effects without replay; migration SHA256 499d60173a8d53fce2c96ae8747ea4ee74d69cbf22ea4548c876b3bc9566478a; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803242000$;

-- Individual reviewed version 20260803243000: recorded_sql_exact; immutable source 259740023472854e17743638a554b919d10bed92b6e6a025732274c426f2f3b3.
do $entry_20260803243000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803243000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803004835' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='112aa9bcdbf97a369b1d49856809b550612b510e7b57add420608e6e7753e2b3') then raise exception 'COUNTERPART_CHANGED_20260803243000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803243000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803243000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803243000','prevent_cross_source_sales_double_count',array[$receipt$-- Reconciled final effects without replay; migration SHA256 259740023472854e17743638a554b919d10bed92b6e6a025732274c426f2f3b3; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803243000$;

-- Individual reviewed version 20260803250000: recorded_sql_differs_only_in_leading_comments; immutable source 2a9bfc35113ab1f01fe2d6a0af03ff4d6c1e516b81a4faf4933cebbb2367c703.
do $entry_20260803250000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803250000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803010053' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='6a809353defa85f28cbe8941dd4d5634beae5df5ced751ebb51f77da26ace55e') then raise exception 'COUNTERPART_CHANGED_20260803250000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803250000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803250000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803250000','hide_zero_pending_payouts',array[$receipt$-- Reconciled final effects without replay; migration SHA256 2a9bfc35113ab1f01fe2d6a0af03ff4d6c1e516b81a4faf4933cebbb2367c703; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803250000$;

-- Individual reviewed version 20260803260000: recorded_sql_exact; immutable source 4fa18382cf3385523848a7c8c4ac6744cbf0f39098c341d98d78973deb3bddf0.
do $entry_20260803260000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803260000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803070139' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='05a58aefaae69c6176ccb244e05f86689caf350d9e2d1beeb42979f9228f3a06') then raise exception 'COUNTERPART_CHANGED_20260803260000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803260000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803260000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803260000','preserve_trendyol_claim_item_identity',array[$receipt$-- Reconciled final effects without replay; migration SHA256 4fa18382cf3385523848a7c8c4ac6744cbf0f39098c341d98d78973deb3bddf0; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803260000$;

-- Individual reviewed version 20260803261000: recorded_sql_exact; immutable source d7632a8aceabc667f5ada99c050461116c849bae87bd1e616239a07e38de2190.
do $entry_20260803261000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803261000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803070951' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='5dc1b7e38fb83ec0c95148dc47471236ce57a11383038e68876e2dcb64a87c71') then raise exception 'COUNTERPART_CHANGED_20260803261000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803261000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803261000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803261000','remove_anonymous_data_plane_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 d7632a8aceabc667f5ada99c050461116c849bae87bd1e616239a07e38de2190; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803261000$;

-- Individual reviewed version 20260803262000: recorded_sql_exact; immutable source 2e3057fee001d47e95521f44655fce115d154a5200230a63eb119ac543e29073.
do $entry_20260803262000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803262000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803071350' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='1fb742e544b6a16f8a174688e61ecd70f353340f03de8d299e9fc4fc56091ccf') then raise exception 'COUNTERPART_CHANGED_20260803262000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803262000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803262000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803262000','consolidate_authenticated_rls_policies',array[$receipt$-- Reconciled final effects without replay; migration SHA256 2e3057fee001d47e95521f44655fce115d154a5200230a63eb119ac543e29073; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803262000$;

-- Individual reviewed version 20260803269000: final_effects_and_supersession; immutable source 62209cf4888876bb12fc0e43a595ef0d72569fd6df339b56db7ee69dc19deb7e.
do $entry_20260803269000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803269000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803269000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803269000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803269000','restore_product_profitability_view',array[$receipt$-- Reconciled final effects without replay; migration SHA256 62209cf4888876bb12fc0e43a595ef0d72569fd6df339b56db7ee69dc19deb7e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803269000$;

-- Individual reviewed version 20260803269100: final_effects_and_supersession; immutable source 3eefbc52606e5045837c7b4e3e47cf98087266c2fc728babb10072016d9443f9.
do $entry_20260803269100$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803269100'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803269100') then raise exception 'ENTRY_ALREADY_PRESENT_20260803269100'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803269100','restore_operating_analytics_views',array[$receipt$-- Reconciled final effects without replay; migration SHA256 3eefbc52606e5045837c7b4e3e47cf98087266c2fc728babb10072016d9443f9; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803269100$;

-- Individual reviewed version 20260803269200: final_effects_and_supersession; immutable source 7e5f21715b9811648250360e44b9ca61e05e74db585126d19ca0ddc53350ee1e.
do $entry_20260803269200$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803269200'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803269200') then raise exception 'ENTRY_ALREADY_PRESENT_20260803269200'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803269200','restore_advertising_analytics_views',array[$receipt$-- Reconciled final effects without replay; migration SHA256 7e5f21715b9811648250360e44b9ca61e05e74db585126d19ca0ddc53350ee1e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803269200$;

-- Individual reviewed version 20260803270000: final_effects_and_supersession; immutable source 811c08903ee751202c3ac7b6bea7f9b9deac3597f7c07ec4fdd27f0ec564e38a.
do $entry_20260803270000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803270000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803270000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803270000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803270000','truthful_merchant_health_and_forecast',array[$receipt$-- Reconciled final effects without replay; migration SHA256 811c08903ee751202c3ac7b6bea7f9b9deac3597f7c07ec4fdd27f0ec564e38a; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803270000$;

-- Individual reviewed version 20260803271000: final_effects_and_supersession; immutable source 70b9ce6413bf064d70370fce7463251259b31b2916f5f1f8bc90252c55bfc400.
do $entry_20260803271000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803271000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803271000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803271000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803271000','fix_health_upload_timestamp',array[$receipt$-- Reconciled final effects without replay; migration SHA256 70b9ce6413bf064d70370fce7463251259b31b2916f5f1f8bc90252c55bfc400; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803271000$;

-- Individual reviewed version 20260803272000: final_effects_and_supersession; immutable source 9d66220de311eb8dad6dd12ba6a886d22d12281b74384ff2e7d956f51f78f788.
do $entry_20260803272000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803272000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803272000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803272000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803272000','require_sufficient_health_coverage',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9d66220de311eb8dad6dd12ba6a886d22d12281b74384ff2e7d956f51f78f788; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803272000$;

-- Individual reviewed version 20260803273000: recorded_sql_exact; immutable source 2ac1622591cb3f52db05dd7b4ca0b672d5db7d6ad35a213799ccd138867ccfcc.
do $entry_20260803273000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803273000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803091205' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f5ef82848e77e5f690feddf99c62a49f587f7eabe09892637652914a3ee72fa3') then raise exception 'COUNTERPART_CHANGED_20260803273000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803273000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803273000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803273000','merchant_executive_brief',array[$receipt$-- Reconciled final effects without replay; migration SHA256 2ac1622591cb3f52db05dd7b4ca0b672d5db7d6ad35a213799ccd138867ccfcc; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803273000$;

-- Individual reviewed version 20260803274000: final_effects_and_supersession; immutable source 4e6bb1b0ced8f0e9cf0a3602551404a8e996dacef05cfa019f77d885a74b048b.
do $entry_20260803274000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803274000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803274000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803274000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803274000','weekly_operating_cycle',array[$receipt$-- Reconciled final effects without replay; migration SHA256 4e6bb1b0ced8f0e9cf0a3602551404a8e996dacef05cfa019f77d885a74b048b; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803274000$;

-- Individual reviewed version 20260803274100: final_effects_and_supersession; immutable source e97f90617d2fa7df597912f8436b5b6c20b0da792d9a5a9848d62722e5ca255c.
do $entry_20260803274100$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803274100'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803274100') then raise exception 'ENTRY_ALREADY_PRESENT_20260803274100'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803274100','index_weekly_brief_captured_by',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e97f90617d2fa7df597912f8436b5b6c20b0da792d9a5a9848d62722e5ca255c; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803274100$;

-- Individual reviewed version 20260803275000: recorded_sql_differs_only_in_leading_comments; immutable source b81e5224d78636810e832c012b8c36e0ac2b55b12d09693f741ba93628746e9f.
do $entry_20260803275000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803275000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803101647' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='b79ee8abf18d3c0ede53d9c260f31bf0307e03a9860f487cef1f61e7ac8acc48') then raise exception 'COUNTERPART_CHANGED_20260803275000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803275000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803275000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803275000','harden_rebuild_authorization',array[$receipt$-- Reconciled final effects without replay; migration SHA256 b81e5224d78636810e832c012b8c36e0ac2b55b12d09693f741ba93628746e9f; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803275000$;

-- Individual reviewed version 20260803275100: recorded_sql_differs_only_in_leading_comments; immutable source 15195965019f9f1685fc71aee5e6f3ac41bb8e5393a7e4449ce2d2830ec349f8.
do $entry_20260803275100$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803275100'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803101912' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='5ac70c7bcdb2bd03e3c57f88b5ca8cb47747ad57206a70f43685d907b558ea2c') then raise exception 'COUNTERPART_CHANGED_20260803275100'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803275100') then raise exception 'ENTRY_ALREADY_PRESENT_20260803275100'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803275100','enforce_workspace_suspension',array[$receipt$-- Reconciled final effects without replay; migration SHA256 15195965019f9f1685fc71aee5e6f3ac41bb8e5393a7e4449ce2d2830ec349f8; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803275100$;

-- Individual reviewed version 20260803280000: final_effects_and_supersession; immutable source a6700749f895c6108cb6d43be565f414e1dd7f48de956810dabf3a5c6a932907.
do $entry_20260803280000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803280000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803280000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803280000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803280000','monitor_and_recover_stalled_operations',array[$receipt$-- Reconciled final effects without replay; migration SHA256 a6700749f895c6108cb6d43be565f414e1dd7f48de956810dabf3a5c6a932907; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803280000$;

-- Individual reviewed version 20260803290000: recorded_sql_exact; immutable source 4ea8ff8ba193a27b9c9ba1607f7ef361be932b1a608e0d4a878f270b6702d61f.
do $entry_20260803290000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803290000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803132107' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='1adbf2518d87a6322150b38ce0cb74cc01abb8fb3a79192f0bc50ffa835ed317') then raise exception 'COUNTERPART_CHANGED_20260803290000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803290000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803290000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803290000','retire_paid_subscription_workflows',array[$receipt$-- Reconciled final effects without replay; migration SHA256 4ea8ff8ba193a27b9c9ba1607f7ef361be932b1a608e0d4a878f270b6702d61f; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803290000$;

-- Individual reviewed version 20260803291000: final_effects_and_supersession; immutable source 497d7278f487db843bff8f2a85f2d71a3e42b538380da6c0c1ce6612e7143ce0.
do $entry_20260803291000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803291000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803291000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803291000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803291000','account_privacy_lifecycle',array[$receipt$-- Reconciled final effects without replay; migration SHA256 497d7278f487db843bff8f2a85f2d71a3e42b538380da6c0c1ce6612e7143ce0; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803291000$;

-- Individual reviewed version 20260803292000: final_effects_and_supersession; immutable source f0178a23381e9d8de6db8a258c9725ebda80cb6953cec77b7945e3bb85c8e237.
do $entry_20260803292000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803292000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803292000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803292000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803292000','harden_account_closure_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 f0178a23381e9d8de6db8a258c9725ebda80cb6953cec77b7945e3bb85c8e237; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803292000$;

-- Individual reviewed version 20260803293000: final_effects_and_supersession; immutable source ded0cceb45be0e5fa88224908a208ba72cea995178765837499fed214bf6c38b.
do $entry_20260803293000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803293000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803293000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803293000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803293000','seal_audit_log_direct_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 ded0cceb45be0e5fa88224908a208ba72cea995178765837499fed214bf6c38b; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803293000$;

-- Individual reviewed version 20260803294000: final_effects_and_supersession; immutable source 016e035551fcae5df2513e677174d42b6c7291d111245f1bbcad50a8fdd3a75e.
do $entry_20260803294000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294000','client_incident_observability',array[$receipt$-- Reconciled final effects without replay; migration SHA256 016e035551fcae5df2513e677174d42b6c7291d111245f1bbcad50a8fdd3a75e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294000$;

-- Individual reviewed version 20260803294100: recorded_sql_differs_only_in_leading_comments; immutable source 1a560cbe86e5d2f45f866a02decc20415f61b8fcdeee65ed97f3d4236ebbea59.
do $entry_20260803294100$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294100'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803160001' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='c80e5b574705853eb24cbbc77469e06ca96bdeb954de3999031d298e28ae9fba') then raise exception 'COUNTERPART_CHANGED_20260803294100'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294100') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294100'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294100','deny_direct_client_incident_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 1a560cbe86e5d2f45f866a02decc20415f61b8fcdeee65ed97f3d4236ebbea59; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294100$;

-- Individual reviewed version 20260803294200: final_effects_and_supersession; immutable source 0612e822adc057a1408f28d651ee8452e0eadec868c2ddd043c42c3fab2b2602.
do $entry_20260803294200$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294200'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294200') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294200'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294200','restore_complete_db_health_feed',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0612e822adc057a1408f28d651ee8452e0eadec868c2ddd043c42c3fab2b2602; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294200$;

-- Individual reviewed version 20260803294300: final_effects_and_supersession; immutable source 36d4ecc6748ae3d9fce31e05145c1588d75c240be68472f8cdfb76682541b310.
do $entry_20260803294300$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294300'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294300') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294300'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294300','restore_linked_workspace_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 36d4ecc6748ae3d9fce31e05145c1588d75c240be68472f8cdfb76682541b310; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294300$;

-- Individual reviewed version 20260803294400: final_effects_and_supersession; immutable source 265f36ce79d5e17f071241c5d0d80e9dff239bad8ce7e2d10ffd453685957d6e.
do $entry_20260803294400$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294400'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294400') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294400'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294400','authorize_linked_workspace_operations',array[$receipt$-- Reconciled final effects without replay; migration SHA256 265f36ce79d5e17f071241c5d0d80e9dff239bad8ce7e2d10ffd453685957d6e; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294400$;

-- Individual reviewed version 20260803294500: final_effects_and_supersession; immutable source fd3ac19efe11d87a16876338c12267a82eaf01b03dc64163ea99b29382aa84de.
do $entry_20260803294500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294500') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294500','restore_linked_workspace_rls',array[$receipt$-- Reconciled final effects without replay; migration SHA256 fd3ac19efe11d87a16876338c12267a82eaf01b03dc64163ea99b29382aa84de; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294500$;

-- Individual reviewed version 20260803294600: final_effects_and_supersession; immutable source a4aa7e28ebc152a09db99b65a23f31ae155594059f1e62fac55a71f02b14f5ab.
do $entry_20260803294600$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294600'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294600') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294600'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294600','secure_linked_workspace_cost_import',array[$receipt$-- Reconciled final effects without replay; migration SHA256 a4aa7e28ebc152a09db99b65a23f31ae155594059f1e62fac55a71f02b14f5ab; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294600$;

-- Individual reviewed version 20260803294700: final_effects_and_supersession; immutable source 0090eb49a207b5532f6f2b5863e0d2ed12fbc3f75c28274a979245025b67b941.
do $entry_20260803294700$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294700'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294700') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294700'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294700','restore_private_rpc_boundary',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0090eb49a207b5532f6f2b5863e0d2ed12fbc3f75c28274a979245025b67b941; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294700$;

-- Individual reviewed version 20260803294800: final_effects_and_supersession; immutable source 2972760fa5d936ab266bb6e590536d7f5afc69692a8c289a94e49d9138b4d391.
do $entry_20260803294800$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294800'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294800') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294800'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294800','enable_scoped_sales_targets',array[$receipt$-- Reconciled final effects without replay; migration SHA256 2972760fa5d936ab266bb6e590536d7f5afc69692a8c289a94e49d9138b4d391; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294800$;

-- Individual reviewed version 20260803294900: recorded_sql_exact; immutable source 8b70945c3e45cada22c15823bef34dd6d8aa615f5bb24c0f02cf841f46efb1be.
do $entry_20260803294900$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803294900'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803192454' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='fcba9254ad433937da9ad9962f1e46b840ea4018664514ace86721c9aa33af79') then raise exception 'COUNTERPART_CHANGED_20260803294900'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803294900') then raise exception 'ENTRY_ALREADY_PRESENT_20260803294900'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803294900','secure_queue_worker_cron',array[$receipt$-- Reconciled final effects without replay; migration SHA256 8b70945c3e45cada22c15823bef34dd6d8aa615f5bb24c0f02cf841f46efb1be; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803294900$;

-- Individual reviewed version 20260803295000: recorded_sql_exact; immutable source 455072db126f7c26bd0e608a57ea4953f36b4b9be22dad4f8b9a39cb39846912.
do $entry_20260803295000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803295000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803203045' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='c46a56fb6109bfa40d4ffa57f355c61459ff78817ea8b4859a81a3374117da29') then raise exception 'COUNTERPART_CHANGED_20260803295000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803295000') then raise exception 'ENTRY_ALREADY_PRESENT_20260803295000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803295000','secure_raw_import_storage',array[$receipt$-- Reconciled final effects without replay; migration SHA256 455072db126f7c26bd0e608a57ea4953f36b4b9be22dad4f8b9a39cb39846912; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803295000$;

-- Individual reviewed version 20260803295100: recorded_sql_exact; immutable source e8a646f13b899b15ed48d206ceb7c93a2e86a677b8b4a16f526a2e6703386118.
do $entry_20260803295100$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260803295100'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803211416' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='cfdf454914fd8098b06ee4de689ae05833aa6d71b62b2229ae3e897fa7766dbb') then raise exception 'COUNTERPART_CHANGED_20260803295100'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260803295100') then raise exception 'ENTRY_ALREADY_PRESENT_20260803295100'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260803295100','correct_trendyol_order_financials',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e8a646f13b899b15ed48d206ceb7c93a2e86a677b8b4a16f526a2e6703386118; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260803295100$;

-- Individual reviewed version 20260804004347: final_effects_and_supersession; immutable source 37d29f0c152415950c6986d0a5cd0f5f3c041ece9b03be990ed9415875f1e2cd.
do $entry_20260804004347$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804004347'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804004347') then raise exception 'ENTRY_ALREADY_PRESENT_20260804004347'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804004347','persist_trendyol_customer_questions',array[$receipt$-- Reconciled final effects without replay; migration SHA256 37d29f0c152415950c6986d0a5cd0f5f3c041ece9b03be990ed9415875f1e2cd; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804004347$;

-- Individual reviewed version 20260804010232: final_effects_and_supersession; immutable source 9b1421184bfd7992b10fb341b991b8c76b4c3746b21cbbdcc1cf6502cf368aa6.
do $entry_20260804010232$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804010232'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804010232') then raise exception 'ENTRY_ALREADY_PRESENT_20260804010232'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804010232','index_trendyol_question_reply_actor',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9b1421184bfd7992b10fb341b991b8c76b4c3746b21cbbdcc1cf6502cf368aa6; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804010232$;

-- Individual reviewed version 20260804015000: recorded_sql_exact; immutable source 5a79b2c2dcd4a353d14125b9fb2f74bc4ce0092503054d42a25c5d2531dd1627.
do $entry_20260804015000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804015000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803225443' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='a4170b19e1a09ec1f2e043b5ce243ff57ebbf82175940685025e9412ed34adf0') then raise exception 'COUNTERPART_CHANGED_20260804015000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804015000') then raise exception 'ENTRY_ALREADY_PRESENT_20260804015000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804015000','auto_enqueue_marketplace_syncs',array[$receipt$-- Reconciled final effects without replay; migration SHA256 5a79b2c2dcd4a353d14125b9fb2f74bc4ce0092503054d42a25c5d2531dd1627; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804015000$;

-- Individual reviewed version 20260804020500: recorded_sql_exact; immutable source 22a580b3826dabd5d544b446593f937cc18a3a95950f49ffd6661d2a20c84734.
do $entry_20260804020500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804020500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260803225638' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='b3f0306bc43d14272057e6065ce3550fa953dcf7f10cc0dd7ad07d4a3faed52c') then raise exception 'COUNTERPART_CHANGED_20260804020500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804020500') then raise exception 'ENTRY_ALREADY_PRESENT_20260804020500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804020500','lag_auto_sync_upper_bound',array[$receipt$-- Reconciled final effects without replay; migration SHA256 22a580b3826dabd5d544b446593f937cc18a3a95950f49ffd6661d2a20c84734; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804020500$;

-- Individual reviewed version 20260804030000: recorded_sql_exact; immutable source 0fb0df2bef205bcbbc5346f3c869f8542e8d1edeb8c325e8cca7b4061225957d.
do $entry_20260804030000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804030000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804001113' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='1f06fb6929ba4a99b6ca3f84d37025c1cddb0c773f1a65dc051e32c21e462e2f') then raise exception 'COUNTERPART_CHANGED_20260804030000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804030000') then raise exception 'ENTRY_ALREADY_PRESENT_20260804030000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804030000','complete_weekly_brief_workspace_isolation',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0fb0df2bef205bcbbc5346f3c869f8542e8d1edeb8c325e8cca7b4061225957d; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804030000$;

-- Individual reviewed version 20260804120000: recorded_sql_exact; immutable source 0cc91b66a500416a26f05d28ec92d141d6e2e4cad03aed6569e5e415b0dcef01.
do $entry_20260804120000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804120000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804182016' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='c17bea676a38296aec3a31ce7f02d5b4469fdca97bf06507ffcd2323f7a81ca6') then raise exception 'COUNTERPART_CHANGED_20260804120000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804120000') then raise exception 'ENTRY_ALREADY_PRESENT_20260804120000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804120000','seal_admin_integration_settings',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0cc91b66a500416a26f05d28ec92d141d6e2e4cad03aed6569e5e415b0dcef01; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804120000$;

-- Individual reviewed version 20260804171343: final_effects_and_supersession; immutable source 19ed0982167a05e262decf49bfd5ee3fad839ec16f24d1f31fddf7a88f62cbb9.
do $entry_20260804171343$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804171343'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804171343') then raise exception 'ENTRY_ALREADY_PRESENT_20260804171343'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804171343','harden_pg_net_access',array[$receipt$-- Reconciled final effects without replay; migration SHA256 19ed0982167a05e262decf49bfd5ee3fad839ec16f24d1f31fddf7a88f62cbb9; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804171343$;

-- Individual reviewed version 20260804183053: recorded_sql_exact; immutable source e1e002ad1dd0dffb612b3efb8d8b0b4505d8f971cd5f5ab599d41ecb84317ca8.
do $entry_20260804183053$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804183053'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804183920' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='43868ac5bf524cd44425db5d442cc6c3f5a5e047d1789bc8d1be9ab89287b6cc') then raise exception 'COUNTERPART_CHANGED_20260804183053'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804183053') then raise exception 'ENTRY_ALREADY_PRESENT_20260804183053'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804183053','seal_salla_oauth_tokens',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e1e002ad1dd0dffb612b3efb8d8b0b4505d8f971cd5f5ab599d41ecb84317ca8; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804183053$;

-- Individual reviewed version 20260804190659: recorded_sql_exact; immutable source d5460239447ef52d4216ebc60ec79acff1fdb0e763fccc7db68e8db9cc8a2486.
do $entry_20260804190659$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804190659'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804161739' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='5bda6af2b46cb17f4bc9b093797fa0b222160b82705dad4d57332edf3898ae82') then raise exception 'COUNTERPART_CHANGED_20260804190659'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804190659') then raise exception 'ENTRY_ALREADY_PRESENT_20260804190659'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804190659','atomic_merchant_file_imports',array[$receipt$-- Reconciled final effects without replay; migration SHA256 d5460239447ef52d4216ebc60ec79acff1fdb0e763fccc7db68e8db9cc8a2486; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804190659$;

-- Individual reviewed version 20260804204219: recorded_sql_exact; immutable source 628228fd90523c81f951bbfbafeb23661a900d696f710d0817a8d8455ccabf12.
do $entry_20260804204219$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804204219'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804204915' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f3d03d1a5ea790b86ec76b3e3838de040c14c12a452a863db2d7654956ff6b2b') then raise exception 'COUNTERPART_CHANGED_20260804204219'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804204219') then raise exception 'ENTRY_ALREADY_PRESENT_20260804204219'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804204219','add_customer_service_permission',array[$receipt$-- Reconciled final effects without replay; migration SHA256 628228fd90523c81f951bbfbafeb23661a900d696f710d0817a8d8455ccabf12; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804204219$;

-- Individual reviewed version 20260804205500: final_effects_and_supersession; immutable source f825421a20615e307d4c2a7ef1550b219b19e8e6afa5151b1d651963a1af2534.
do $entry_20260804205500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804205500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804205500') then raise exception 'ENTRY_ALREADY_PRESENT_20260804205500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804205500','enforce_trendyol_customer_name_privacy',array[$receipt$-- Reconciled final effects without replay; migration SHA256 f825421a20615e307d4c2a7ef1550b219b19e8e6afa5151b1d651963a1af2534; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804205500$;

-- Individual reviewed version 20260804213202: recorded_sql_exact; immutable source b522802e462321b5e06b88676653bc26c5f170210846486924c773f3bf10c3a2.
do $entry_20260804213202$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804213202'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804213922' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='91a0404e012422e873b8c5cab515fe5a9b9e98a588a53823caa46401cee01e23') then raise exception 'COUNTERPART_CHANGED_20260804213202'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804213202') then raise exception 'ENTRY_ALREADY_PRESENT_20260804213202'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804213202','add_bank_statement_reconciliation',array[$receipt$-- Reconciled final effects without replay; migration SHA256 b522802e462321b5e06b88676653bc26c5f170210846486924c773f3bf10c3a2; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804213202$;

-- Individual reviewed version 20260804214008: recorded_sql_exact; immutable source 42d201d46dc9b494771058cbe3e99b8bd19973f1eab03a58788cba1d32d83cb4.
do $entry_20260804214008$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804214008'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804214044' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='094b6f59576f8f1c49cc1e112631a087849c4fba9a5db868c6f1cbff38e6326e') then raise exception 'COUNTERPART_CHANGED_20260804214008'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804214008') then raise exception 'ENTRY_ALREADY_PRESENT_20260804214008'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804214008','optimize_bank_reconciliation_policies',array[$receipt$-- Reconciled final effects without replay; migration SHA256 42d201d46dc9b494771058cbe3e99b8bd19973f1eab03a58788cba1d32d83cb4; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804214008$;

-- Individual reviewed version 20260804214110: recorded_sql_exact; immutable source 167c6ee08847277847a4384a3aea34a6e3894127025949b038fc0e658260f3d6.
do $entry_20260804214110$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804214110'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804214122' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='6ed316e450d84cd8665d050fe590d0816bc055d515aed6577d74f14a0a967f23') then raise exception 'COUNTERPART_CHANGED_20260804214110'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804214110') then raise exception 'ENTRY_ALREADY_PRESENT_20260804214110'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804214110','index_bank_reconciliation_foreign_keys',array[$receipt$-- Reconciled final effects without replay; migration SHA256 167c6ee08847277847a4384a3aea34a6e3894127025949b038fc0e658260f3d6; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804214110$;

-- Individual reviewed version 20260804215429: recorded_sql_exact; immutable source b510cc8b4e695593fa559df9016840035833bf130e400801fe9efd6fd8795ea8.
do $entry_20260804215429$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804215429'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804215755' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='dbfa258fe0737e39d6be72d9eac828d886c059f83f5ffb383820540fdbca6309') then raise exception 'COUNTERPART_CHANGED_20260804215429'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804215429') then raise exception 'ENTRY_ALREADY_PRESENT_20260804215429'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804215429','automate_operational_alerts',array[$receipt$-- Reconciled final effects without replay; migration SHA256 b510cc8b4e695593fa559df9016840035833bf130e400801fe9efd6fd8795ea8; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804215429$;

-- Individual reviewed version 20260804220409: recorded_sql_exact; immutable source 37e8b963cd0163efa1e74dc52dd140b39db15b0e74c977042ee94fb746a6ec57.
do $entry_20260804220409$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804220409'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804220446' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='25b603e304edaacb5d5823a520b7c5b1686d159523d7190e06b8c5a5f37a7c40') then raise exception 'COUNTERPART_CHANGED_20260804220409'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804220409') then raise exception 'ENTRY_ALREADY_PRESENT_20260804220409'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804220409','schedule_operational_alert_refresh',array[$receipt$-- Reconciled final effects without replay; migration SHA256 37e8b963cd0163efa1e74dc52dd140b39db15b0e74c977042ee94fb746a6ec57; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804220409$;

-- Individual reviewed version 20260804221824: final_effects_and_supersession; immutable source 8ab2a28032a510e1c435be195eadb55664e5652e63576027c77fbff36dcc1383.
do $entry_20260804221824$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804221824'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804221824') then raise exception 'ENTRY_ALREADY_PRESENT_20260804221824'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804221824','verify_merchant_email_before_activation',array[$receipt$-- Reconciled final effects without replay; migration SHA256 8ab2a28032a510e1c435be195eadb55664e5652e63576027c77fbff36dcc1383; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804221824$;

-- Individual reviewed version 20260804223236: recorded_sql_differs_only_in_leading_comments; immutable source bd2bf38ec56538dc95454b66d24e8369ea99999ea7c2c4c5c524e0721df97f15.
do $entry_20260804223236$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804223236'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804223348' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='a2e64c8c833c0729e29c8443897d7e166ad44871aa4d4df2ea995ab2996b7564') then raise exception 'COUNTERPART_CHANGED_20260804223236'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804223236') then raise exception 'ENTRY_ALREADY_PRESENT_20260804223236'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804223236','extend_queue_worker_http_timeout',array[$receipt$-- Reconciled final effects without replay; migration SHA256 bd2bf38ec56538dc95454b66d24e8369ea99999ea7c2c4c5c524e0721df97f15; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804223236$;

-- Individual reviewed version 20260804224536: recorded_sql_differs_only_in_leading_comments; immutable source 95bba10dbffeb14b8dae50d87ccc17802ae9994ca65c8898875aac9cc6577977.
do $entry_20260804224536$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804224536'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804224608' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='a3e1a19c94a25aa9835732efe3a5e37d2e37554f18f66494de53437eaee85b97') then raise exception 'COUNTERPART_CHANGED_20260804224536'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804224536') then raise exception 'ENTRY_ALREADY_PRESENT_20260804224536'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804224536','protect_bank_reconciliation_with_mfa',array[$receipt$-- Reconciled final effects without replay; migration SHA256 95bba10dbffeb14b8dae50d87ccc17802ae9994ca65c8898875aac9cc6577977; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804224536$;

-- Individual reviewed version 20260804224913: recorded_sql_differs_only_in_leading_comments; immutable source 6c4ea167a86979b36eed4847d01959da6aaac5c2a873521f7d3dbd7d9a6a5183.
do $entry_20260804224913$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804224913'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804224934' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='e8a57a0301c9ef790ed6764711273a511c3def933bfa6e3a36506d4c2b43374e') then raise exception 'COUNTERPART_CHANGED_20260804224913'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804224913') then raise exception 'ENTRY_ALREADY_PRESENT_20260804224913'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804224913','restore_authorized_operational_alert_refresh',array[$receipt$-- Reconciled final effects without replay; migration SHA256 6c4ea167a86979b36eed4847d01959da6aaac5c2a873521f7d3dbd7d9a6a5183; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804224913$;

-- Individual reviewed version 20260804225200: recorded_sql_differs_only_in_leading_comments; immutable source 2bcdc5fc9572875750390fcb3f1064e3bd3b072f19613d4a6660446eac35543d.
do $entry_20260804225200$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804225200'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804225217' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='72fb259f32c7400e25774c89141792e1f230733cfb20f148a72dc13c4fcee1cc') then raise exception 'COUNTERPART_CHANGED_20260804225200'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804225200') then raise exception 'ENTRY_ALREADY_PRESENT_20260804225200'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804225200','normalize_bank_reconciliation_tenant_boundaries',array[$receipt$-- Reconciled final effects without replay; migration SHA256 2bcdc5fc9572875750390fcb3f1064e3bd3b072f19613d4a6660446eac35543d; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804225200$;

-- Individual reviewed version 20260804230938: recorded_sql_exact; immutable source 80ac32867d0c123d6a751f5e9b7063b7dcded0465226c5bd0afbdc9c1369ffb9.
do $entry_20260804230938$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804230938'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804231658' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='6e5774d4bea2abdcd64f0e94db166894925a43b88222eda23ef203766f1c3044') then raise exception 'COUNTERPART_CHANGED_20260804230938'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804230938') then raise exception 'ENTRY_ALREADY_PRESENT_20260804230938'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804230938','action_effectiveness_analytics',array[$receipt$-- Reconciled final effects without replay; migration SHA256 80ac32867d0c123d6a751f5e9b7063b7dcded0465226c5bd0afbdc9c1369ffb9; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804230938$;

-- Individual reviewed version 20260804232625: recorded_sql_exact; immutable source 0d062bd71ed9f14daffc98c927f544db1e11e9183a4cf2e98734824bdebb776e.
do $entry_20260804232625$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260804232625'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260804233425' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='5b9a8e6883c7ab4a1e11668808d7bbe869bec9640cd4f7be8279361ed31957c9') then raise exception 'COUNTERPART_CHANGED_20260804232625'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260804232625') then raise exception 'ENTRY_ALREADY_PRESENT_20260804232625'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260804232625','purchase_cash_readiness',array[$receipt$-- Reconciled final effects without replay; migration SHA256 0d062bd71ed9f14daffc98c927f544db1e11e9183a4cf2e98734824bdebb776e; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260804232625$;

-- Individual reviewed version 20260805003857: final_effects_and_supersession; immutable source cb5f8f5a383648f1c09ee1573193d2d686c3f52c209db1d466457e052f31c62a.
do $entry_20260805003857$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260805003857'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260805003857') then raise exception 'ENTRY_ALREADY_PRESENT_20260805003857'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260805003857','record_merchant_legal_acceptance',array[$receipt$-- Reconciled final effects without replay; migration SHA256 cb5f8f5a383648f1c09ee1573193d2d686c3f52c209db1d466457e052f31c62a; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260805003857$;

-- Individual reviewed version 20260805005228: recorded_sql_exact; immutable source 881d2af3ed2a61e170a8e8636aed7d3a5b908e5c0ee90a3c4d44279e7824074d.
do $entry_20260805005228$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260805005228'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260805005309' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='f225482b95f9e79e55d3559df0fe0b5e95909a4db4a6b02b99147f5057808256') then raise exception 'COUNTERPART_CHANGED_20260805005228'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260805005228') then raise exception 'ENTRY_ALREADY_PRESENT_20260805005228'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260805005228','seal_merchant_legal_acceptance',array[$receipt$-- Reconciled final effects without replay; migration SHA256 881d2af3ed2a61e170a8e8636aed7d3a5b908e5c0ee90a3c4d44279e7824074d; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260805005228$;

-- Individual reviewed version 20260805020314: recorded_sql_exact; immutable source 3feded91c4706cc4a900695edc98b7ec2415f6434c49ec2f500a9f50e480a3bc.
do $entry_20260805020314$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260805020314'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260805022434' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='1039df6352d051967e805549334c0fde622b3c8f49688af858b9c78991fb6fd0') then raise exception 'COUNTERPART_CHANGED_20260805020314'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260805020314') then raise exception 'ENTRY_ALREADY_PRESENT_20260805020314'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260805020314','explicit_data_api_grants',array[$receipt$-- Reconciled final effects without replay; migration SHA256 3feded91c4706cc4a900695edc98b7ec2415f6434c49ec2f500a9f50e480a3bc; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260805020314$;

-- Individual reviewed version 20260810141500: recorded_sql_exact; immutable source 92ae760dfd9034da6d25ce6c82648e277ad4d7ed6b9c9a9d18be113869f3f349.
do $entry_20260810141500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810141500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260810110658' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='3ac75b0c5fe66ecb21e397896490870d4ca25c93b1bc0142c5c13c85f43df8c0') then raise exception 'COUNTERPART_CHANGED_20260810141500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810141500') then raise exception 'ENTRY_ALREADY_PRESENT_20260810141500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810141500','allow_staff_merchant_import_archives',array[$receipt$-- Reconciled final effects without replay; migration SHA256 92ae760dfd9034da6d25ce6c82648e277ad4d7ed6b9c9a9d18be113869f3f349; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810141500$;

-- Individual reviewed version 20260810162000: final_effects_and_supersession; immutable source f19f5e59d1beaba9716985f9e591873c68a8d673b4fe12f5f4f804ddd1a821b3.
do $entry_20260810162000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810162000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810162000') then raise exception 'ENTRY_ALREADY_PRESENT_20260810162000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810162000','aggregate_admin_ad_performance',array[$receipt$-- Reconciled final effects without replay; migration SHA256 f19f5e59d1beaba9716985f9e591873c68a8d673b4fe12f5f4f804ddd1a821b3; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810162000$;

-- Individual reviewed version 20260810162500: final_effects_and_supersession; immutable source 322b1396ab934d01162dbcf69e501275a0f8f340b6fb4dc6fb5c91be3f7ac109.
do $entry_20260810162500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810162500'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810162500') then raise exception 'ENTRY_ALREADY_PRESENT_20260810162500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810162500','secure_admin_ad_performance',array[$receipt$-- Reconciled final effects without replay; migration SHA256 322b1396ab934d01162dbcf69e501275a0f8f340b6fb4dc6fb5c91be3f7ac109; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810162500$;

-- Individual reviewed version 20260810180331: final_effects_and_supersession; immutable source 1503bce92b7c856d08bd20839a40c64a5b4cf0a00865c58f6e721b5781e18025.
do $entry_20260810180331$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810180331'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810180331') then raise exception 'ENTRY_ALREADY_PRESENT_20260810180331'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810180331','remove_retired_integrations_and_billing',array[$receipt$-- Reconciled final effects without replay; migration SHA256 1503bce92b7c856d08bd20839a40c64a5b4cf0a00865c58f6e721b5781e18025; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810180331$;

-- Individual reviewed version 20260810190000: recorded_sql_exact; immutable source 27d40211a8f51b341f9bd34cefae3da718841e06e35d5008757290d47b94a2a1.
do $entry_20260810190000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810190000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260810132146' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='eeeeb6bcf261aa6b49e3ad9aa40255a5f7d4f8915d1b46dae45da299542eedd4') then raise exception 'COUNTERPART_CHANGED_20260810190000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810190000') then raise exception 'ENTRY_ALREADY_PRESENT_20260810190000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810190000','create_unified_product_catalog',array[$receipt$-- Reconciled final effects without replay; migration SHA256 27d40211a8f51b341f9bd34cefae3da718841e06e35d5008757290d47b94a2a1; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810190000$;

-- Individual reviewed version 20260810193000: recorded_sql_differs_only_in_leading_comments; immutable source fe0ce65896359fef6dcb6c2a9530d4a1a87647c0b89f2bcdbee908f5378d1efc.
do $entry_20260810193000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810193000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260810132403' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='9459dc50678cc86a18bdaf10d9a22cade563a218aae3c93245ee8f72821722e6') then raise exception 'COUNTERPART_CHANGED_20260810193000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810193000') then raise exception 'ENTRY_ALREADY_PRESENT_20260810193000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810193000','expose_safe_catalog_columns',array[$receipt$-- Reconciled final effects without replay; migration SHA256 fe0ce65896359fef6dcb6c2a9530d4a1a87647c0b89f2bcdbee908f5378d1efc; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810193000$;

-- Individual reviewed version 20260810194000: final_effects_and_supersession; immutable source 84ce955724f31a6d381caadd01ea423ef995d767fd21e68d8f287d465f065c94.
do $entry_20260810194000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260810194000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260810194000') then raise exception 'ENTRY_ALREADY_PRESENT_20260810194000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260810194000','guard_product_mapping_actor',array[$receipt$-- Reconciled final effects without replay; migration SHA256 84ce955724f31a6d381caadd01ea423ef995d767fd21e68d8f287d465f065c94; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260810194000$;

-- Individual reviewed version 20260812202758: recorded_sql_exact; immutable source 7812dc79177398b5a86cafab9daebd26bf2952b22ef3f47c28f13f77e3d0613a.
do $entry_20260812202758$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260812202758'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260812203010' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='eba43726ba705a6848b6866524d0889c90a8feff4770c13413cda219baab2b85') then raise exception 'COUNTERPART_CHANGED_20260812202758'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260812202758') then raise exception 'ENTRY_ALREADY_PRESENT_20260812202758'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260812202758','chunk_large_atomic_file_imports',array[$receipt$-- Reconciled final effects without replay; migration SHA256 7812dc79177398b5a86cafab9daebd26bf2952b22ef3f47c28f13f77e3d0613a; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260812202758$;

-- Individual reviewed version 20260813181147: recorded_sql_exact; immutable source db5e33ff8c6456cc291da49026468eacaadc66e2916617714db5f0f245994714.
do $entry_20260813181147$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260813181147'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260813181626' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='86538816653923587a7b35e5f3f99a9a8382428393e320b6f6b322d0c22a052c') then raise exception 'COUNTERPART_CHANGED_20260813181147'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260813181147') then raise exception 'ENTRY_ALREADY_PRESENT_20260813181147'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260813181147','merchant_platform_shipping_costs',array[$receipt$-- Reconciled final effects without replay; migration SHA256 db5e33ff8c6456cc291da49026468eacaadc66e2916617714db5f0f245994714; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260813181147$;

-- Individual reviewed version 20260813193000: recorded_sql_exact; immutable source 639c4b90711381c184f676a8db2436f225110a985e9b6aeab07211d263bbf8c8.
do $entry_20260813193000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260813193000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260813173627' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='25cccbe89297d33ae611d03cd564d5b89ca24fee3aba8f67aaf7d374fff909b3') then raise exception 'COUNTERPART_CHANGED_20260813193000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260813193000') then raise exception 'ENTRY_ALREADY_PRESENT_20260813193000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260813193000','product_category_commissions',array[$receipt$-- Reconciled final effects without replay; migration SHA256 639c4b90711381c184f676a8db2436f225110a985e9b6aeab07211d263bbf8c8; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260813193000$;

-- Individual reviewed version 20260813214000: recorded_sql_exact; immutable source 094cd6a4e136f9b5a106c39ca8415d5cefea3d6babce33367c7de4d6112a4b61.
do $entry_20260813214000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260813214000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260813183123' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='4265b911a66e1b2dc8c0432306facfac9167e956308f700ca5656a8da20768f4') then raise exception 'COUNTERPART_CHANGED_20260813214000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260813214000') then raise exception 'ENTRY_ALREADY_PRESENT_20260813214000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260813214000','add_sellpert_contract_commission',array[$receipt$-- Reconciled final effects without replay; migration SHA256 094cd6a4e136f9b5a106c39ca8415d5cefea3d6babce33367c7de4d6112a4b61; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260813214000$;

-- Individual reviewed version 20260813220000: recorded_sql_exact; immutable source ad2127ef45ec1957c3987fc22c796fe8f963930ba9572ae9d300776e7bb6cd24.
do $entry_20260813220000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260813220000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260813200842' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='06f0afcbeac84ca81c25dc3f52e6a890de12777f95732109b925aa1127bee7fa') then raise exception 'COUNTERPART_CHANGED_20260813220000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260813220000') then raise exception 'ENTRY_ALREADY_PRESENT_20260813220000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260813220000','protect_new_catalog_finance_tables_with_mfa',array[$receipt$-- Reconciled final effects without replay; migration SHA256 ad2127ef45ec1957c3987fc22c796fe8f963930ba9572ae9d300776e7bb6cd24; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260813220000$;

-- Individual reviewed version 20260813221500: recorded_sql_exact; immutable source 35aa6e02267bed6acb794d3cf7844d9f80af61aaa6e07356b20d1d858d06c583.
do $entry_20260813221500$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260813221500'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260813202105' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='8cb998f8ff3c00a30d83280faf761f876a796745ba3ea46ce889786f5e750b38') then raise exception 'COUNTERPART_CHANGED_20260813221500'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260813221500') then raise exception 'ENTRY_ALREADY_PRESENT_20260813221500'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260813221500','enforce_catalog_finance_tenant_boundaries',array[$receipt$-- Reconciled final effects without replay; migration SHA256 35aa6e02267bed6acb794d3cf7844d9f80af61aaa6e07356b20d1d858d06c583; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260813221500$;

-- Individual reviewed version 20260814103000: recorded_sql_differs_only_in_leading_comments; immutable source 4b777a70da55f75ce42220a588e5e42dd93cffda5d965b9ea5cf8334c8ef1554.
do $entry_20260814103000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260814103000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260814120001' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='8593e4a5f3308d79a25a978f4e07dcf139a0001882173f7382a1b9c0226e7bd4') then raise exception 'COUNTERPART_CHANGED_20260814103000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260814103000') then raise exception 'ENTRY_ALREADY_PRESENT_20260814103000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260814103000','secure_admin_overview_metrics',array[$receipt$-- Reconciled final effects without replay; migration SHA256 4b777a70da55f75ce42220a588e5e42dd93cffda5d965b9ea5cf8334c8ef1554; proof recorded_sql_differs_only_in_leading_comments; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260814103000$;

-- Individual reviewed version 20260814110000: final_effects_and_supersession; immutable source 1c4261276662b71c533df34e451213a5aa502d5e6624916601ead7972f99ae44.
do $entry_20260814110000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260814110000'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260814110000') then raise exception 'ENTRY_ALREADY_PRESENT_20260814110000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260814110000','index_admin_overview_performance',array[$receipt$-- Reconciled final effects without replay; migration SHA256 1c4261276662b71c533df34e451213a5aa502d5e6624916601ead7972f99ae44; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260814110000$;

-- Individual reviewed version 20260816123000: recorded_sql_exact; immutable source b7923859593ba20ee0864ccfb44b56a87ca600526ed25119178cd9508fcf05fe.
do $entry_20260816123000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260816123000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260816193743' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='44417e4b038988707bd1123b0a40eda5324fa5601c396f70432f61ded768693a') then raise exception 'COUNTERPART_CHANGED_20260816123000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260816123000') then raise exception 'ENTRY_ALREADY_PRESENT_20260816123000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260816123000','omniful_amazon_shadow_trial',array[$receipt$-- Reconciled final effects without replay; migration SHA256 b7923859593ba20ee0864ccfb44b56a87ca600526ed25119178cd9508fcf05fe; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260816123000$;

-- Individual reviewed version 20260816125000: recorded_sql_exact; immutable source 44a11d6e121c5f08f698ecb58a5a7bb608030f2aa422ea25b21d52adcdc3f5d0.
do $entry_20260816125000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260816125000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260816193842' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='40b1dc568bd734a71c513f744fb87eefabce1ecb0e913b2ad74472e28170f659') then raise exception 'COUNTERPART_CHANGED_20260816125000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260816125000') then raise exception 'ENTRY_ALREADY_PRESENT_20260816125000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260816125000','harden_omniful_shadow_tables',array[$receipt$-- Reconciled final effects without replay; migration SHA256 44a11d6e121c5f08f698ecb58a5a7bb608030f2aa422ea25b21d52adcdc3f5d0; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260816125000$;

-- Individual reviewed version 20260816194539: final_effects_and_supersession; immutable source 938a27de3db79ed656a66a455bfc50d492248cb84fc13f595d18ea7660e062ee.
do $entry_20260816194539$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260816194539'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260816194539') then raise exception 'ENTRY_ALREADY_PRESENT_20260816194539'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260816194539','omniful_noon_trendyol_shadow_trial',array[$receipt$-- Reconciled final effects without replay; migration SHA256 938a27de3db79ed656a66a455bfc50d492248cb84fc13f595d18ea7660e062ee; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260816194539$;

-- Individual reviewed version 20260816213000: recorded_sql_exact; immutable source e313d47869ea1e3a9b74b744fe8a7d834b8682bb06559f038100f4c5f8517a3b.
do $entry_20260816213000$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260816213000'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260816202949' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='5a9f6599254056088656363b7a20bf337c22f3ad223d8eb19e61735a105f6e57') then raise exception 'COUNTERPART_CHANGED_20260816213000'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260816213000') then raise exception 'ENTRY_ALREADY_PRESENT_20260816213000'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260816213000','omniful_unified_merchant_portal',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e313d47869ea1e3a9b74b744fe8a7d834b8682bb06559f038100f4c5f8517a3b; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260816213000$;

-- Individual reviewed version 20260817092059: recorded_sql_exact; immutable source e88a15e207920b8f72020d257a4f4cc5d87e82f62ba8139847f4846a7cd5a8f7.
do $entry_20260817092059$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260817092059'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260817092259' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='cea4e5a0049a0e5307b2f9f27e70126aff5210eab83562daf2824981413a280e') then raise exception 'COUNTERPART_CHANGED_20260817092059'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260817092059') then raise exception 'ENTRY_ALREADY_PRESENT_20260817092059'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260817092059','correct_sellpert_order_commission_semantics',array[$receipt$-- Reconciled final effects without replay; migration SHA256 e88a15e207920b8f72020d257a4f4cc5d87e82f62ba8139847f4846a7cd5a8f7; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260817092059$;

-- Individual reviewed version 20260818160316: final_effects_and_supersession; immutable source 888cb06061097da2d7b8fa9c8aed86300b234480a703a382d864cbd04faa16cc.
do $entry_20260818160316$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260818160316'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260818160316') then raise exception 'ENTRY_ALREADY_PRESENT_20260818160316'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260818160316','omniful_merchant_account_credentials',array[$receipt$-- Reconciled final effects without replay; migration SHA256 888cb06061097da2d7b8fa9c8aed86300b234480a703a382d864cbd04faa16cc; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260818160316$;

-- Individual reviewed version 20260818182242: recorded_sql_exact; immutable source 639faa8d1200cc60ea92f65dd8cc7fee359e9b2d6c72974c32e57a344d72d6dc.
do $entry_20260818182242$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260818182242'; end if;
 perform pg_temp.assert_original_history();
 if not exists(select 1 from supabase_migrations.schema_migrations m where version='20260818183555' and encode(extensions.digest(to_jsonb(m)::text,'sha256'),'hex')='07bae23c0a4db2362b2c9ba1a2ceafdf39bc8603fed1b7c80dbd58e042bcdc03') then raise exception 'COUNTERPART_CHANGED_20260818182242'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260818182242') then raise exception 'ENTRY_ALREADY_PRESENT_20260818182242'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260818182242','omniful_central_channel_assignments',array[$receipt$-- Reconciled final effects without replay; migration SHA256 639faa8d1200cc60ea92f65dd8cc7fee359e9b2d6c72974c32e57a344d72d6dc; proof recorded_sql_exact; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260818182242$;

-- Individual reviewed version 20260818183726: final_effects_and_supersession; immutable source ac9509f39cd3eb4a26e6cc93f5928da14bebfd30c23c80a0089e0bfecbe7ab8a.
do $entry_20260818183726$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260818183726'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260818183726') then raise exception 'ENTRY_ALREADY_PRESENT_20260818183726'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260818183726','index_omniful_assignment_actor',array[$receipt$-- Reconciled final effects without replay; migration SHA256 ac9509f39cd3eb4a26e6cc93f5928da14bebfd30c23c80a0089e0bfecbe7ab8a; proof final_effects_and_supersession; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260818183726$;

-- Individual reviewed version 20260828083527: missing_effect_requires_correction; immutable source 562c8f6bf11b99d64b95084de831a44e036397a3c2694730ada7d3fcb2a3637d.
do $entry_20260828083527$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20260828083527'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20260828083527') then raise exception 'ENTRY_ALREADY_PRESENT_20260828083527'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20260828083527','pricing_requests',array[$receipt$-- Reconciled final effects without replay; migration SHA256 562c8f6bf11b99d64b95084de831a44e036397a3c2694730ada7d3fcb2a3637d; proof missing_effect_requires_correction; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20260828083527$;

-- Individual reviewed version 20261126092428: missing_effect_requires_correction; immutable source 9e5cf1383d1db24a9566abdba3a64bdbef11231efed2f7b6d9e68d3f0587afd9.
do $entry_20261126092428$ begin
 if not exists(select 1 from release_verified_snapshot where digest='e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b') then raise exception 'MISSING_ENTRY_PROOF_20261126092428'; end if;
 perform pg_temp.assert_original_history();

 if exists(select 1 from supabase_migrations.schema_migrations where version='20261126092428') then raise exception 'ENTRY_ALREADY_PRESENT_20261126092428'; end if;
 insert into supabase_migrations.schema_migrations(version,name,statements) values('20261126092428','enforce_remaining_table_boundaries',array[$receipt$-- Reconciled final effects without replay; migration SHA256 9e5cf1383d1db24a9566abdba3a64bdbef11231efed2f7b6d9e68d3f0587afd9; proof missing_effect_requires_correction; corrected catalog SHA256 e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b.$receipt$]);
end $entry_20261126092428$;
do $executed_20261126092419$ begin perform pg_temp.assert_original_history(); if exists(select 1 from supabase_migrations.schema_migrations where version='20261126092419') then raise exception 'CORRECTION_ALREADY_RECORDED'; end if; insert into supabase_migrations.schema_migrations(version,name,statements) values('20261126092419','restore_omitted_analytics_baseline',array[$actual_sql$-- DRAFT: restore 17 analytics views and 8 routines omitted by the baseline.
-- Source: scoped, preflight-screened production catalog snapshot 2026-11-26.
-- No customer rows or credentials were exported. No existing object is replaced.
-- Existing definitions must match the reviewed snapshot; unexpected drift aborts.
-- Existing ACLs remain unchanged. New views receive SELECT only, and routines
-- receive EXECUTE only, for authenticated/service_role; PUBLIC/anon receive none.
-- SECURITY INVOKER preserves underlying tenant/RLS/MFA and column grants.
-- No financial formulas, routing, data, or provider integrations change here.
-- Known existing defect deliberately preserved: return_reasons_breakdown is
-- STABLE but uses a temporary table. Repair requires a separate reviewed change.

DO $restore_analytics$
DECLARE
  object_oid oid;
BEGIN
  PERFORM set_config('search_path', 'public,pg_catalog', true);
  -- public.brand_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.brand_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.brand_performance WITH (security_invoker = true) AS
 WITH from_snap AS (
         SELECT product_performance_snapshots.merchant_code,
            product_performance_snapshots.platform,
            product_performance_snapshots.brand,
            sum(product_performance_snapshots.sold)::integer AS units_sold,
            sum(product_performance_snapshots.returned)::integer AS units_returned,
            sum(product_performance_snapshots.gross_sales) AS revenue,
            sum(product_performance_snapshots.net_revenue) AS net_revenue
           FROM product_performance_snapshots
          WHERE product_performance_snapshots.brand IS NOT NULL AND product_performance_snapshots.brand <> ''::text
          GROUP BY product_performance_snapshots.merchant_code, product_performance_snapshots.platform, product_performance_snapshots.brand
        ), from_orders AS (
         SELECT orders.merchant_code,
            orders.platform,
            orders.brand,
            count(*)::integer AS units_sold,
            0 AS units_returned,
            sum(orders.total_amount) AS revenue,
            sum(orders.total_amount - COALESCE(orders.platform_fee, 0::numeric)) AS net_revenue
           FROM orders
          WHERE orders.brand IS NOT NULL AND orders.brand <> ''::text AND orders.status <> 'cancelled'::text
          GROUP BY orders.merchant_code, orders.platform, orders.brand
        ), combined AS (
         SELECT from_snap.merchant_code,
            from_snap.platform,
            from_snap.brand,
            from_snap.units_sold,
            from_snap.units_returned,
            from_snap.revenue,
            from_snap.net_revenue
           FROM from_snap
        UNION ALL
         SELECT from_orders.merchant_code,
            from_orders.platform,
            from_orders.brand,
            from_orders.units_sold,
            from_orders.units_returned,
            from_orders.revenue,
            from_orders.net_revenue
           FROM from_orders
        )
 SELECT merchant_code,
    platform,
    brand,
    sum(units_sold)::integer AS units_sold,
    sum(units_returned)::integer AS units_returned,
    sum(revenue) AS revenue,
    sum(net_revenue) AS net_revenue,
        CASE
            WHEN sum(units_sold) > 0 THEN round(sum(units_returned)::numeric / sum(units_sold)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS return_rate_pct
   FROM combined
  GROUP BY merchant_code, platform, brand;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.brand_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.brand_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.brand_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '81758e66a6706b2cf538514f018001cf' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.brand_performance; review required';
  END IF;

  -- public.buybox_warnings: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.buybox_warnings');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.buybox_warnings WITH (security_invoker = true) AS
 SELECT merchant_code,
    id AS product_id,
    name,
    sku,
    barcode,
    sale_price AS my_price,
    buybox_price,
    round((sale_price - buybox_price) / NULLIF(buybox_price, 0::numeric) * 100::numeric, 1) AS overprice_pct,
        CASE
            WHEN sale_price > (buybox_price * 1.05) THEN 'losing'::text
            WHEN sale_price > buybox_price THEN 'at_risk'::text
            ELSE 'winning'::text
        END AS buybox_status
   FROM products p
  WHERE buybox_price IS NOT NULL AND buybox_price > 0::numeric AND sale_price IS NOT NULL AND sale_price > 0::numeric;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.buybox_warnings FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.buybox_warnings TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.buybox_warnings; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2152f38a7b99a41d364a5b516424f119' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.buybox_warnings; review required';
  END IF;

  -- public.cross_platform_product_perf: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.cross_platform_product_perf');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.cross_platform_product_perf WITH (security_invoker = true) AS
 WITH o AS (
         SELECT o_1.merchant_code,
            o_1.platform,
            COALESCE(o_1.partner_sku, o_1.sku) AS sku_norm,
            p.barcode,
            o_1.product_name,
            COALESCE(p.cost_price, 0::numeric) AS cost_price,
            count(*)::integer AS orders,
            sum(o_1.quantity) AS units,
            sum(o_1.total_amount) AS revenue,
            avg(o_1.total_amount / NULLIF(o_1.quantity, 0)::numeric) AS avg_price,
            sum(
                CASE
                    WHEN o_1.platform = 'noon'::text AND COALESCE(o_1.platform_fee, 0::numeric) = 0::numeric THEN o_1.total_amount * (COALESCE(cr.rate, 0::numeric) / 100.0) * (1::numeric + COALESCE(cr.vat_rate, 0::numeric) / 100.0)
                    ELSE COALESCE(o_1.platform_fee, 0::numeric)
                END) AS fees
           FROM orders o_1
             LEFT JOIN products p ON p.merchant_code = o_1.merchant_code AND (p.sku = o_1.sku OR p.sku = o_1.partner_sku)
             LEFT JOIN platform_commission_rates cr ON cr.platform = o_1.platform AND cr.category = 'default'::text
          WHERE o_1.status <> 'cancelled'::text
          GROUP BY o_1.merchant_code, o_1.platform, (COALESCE(o_1.partner_sku, o_1.sku)), p.barcode, o_1.product_name, (COALESCE(p.cost_price, 0::numeric))
        ), ad AS (
         SELECT am.merchant_code,
            am.platform,
            COALESCE(pp.sku, am.sku) AS sku_join,
            sum(am.spend) AS ad_spend
           FROM ad_metrics am
             LEFT JOIN products pp ON pp.merchant_code = am.merchant_code AND (pp.sku = am.sku OR pp.noon_sku_child = am.sku)
          WHERE am.sku IS NOT NULL AND am.sku <> ''::text
          GROUP BY am.merchant_code, am.platform, (COALESCE(pp.sku, am.sku))
        )
 SELECT o.merchant_code,
    COALESCE(o.barcode, o.sku_norm) AS product_key,
    max(o.product_name) AS product_name,
    jsonb_object_agg(o.platform, jsonb_build_object('orders', o.orders, 'units', o.units, 'revenue', round(o.revenue, 2), 'avg_price', round(o.avg_price, 2), 'fees', round(o.fees, 2), 'ad_spend', round(COALESCE(a.ad_spend, 0::numeric), 2), 'net', round(o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric), 2), 'margin',
        CASE
            WHEN o.revenue > 0::numeric THEN round((o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric)) / o.revenue * 100::numeric, 1)
            ELSE NULL::numeric
        END)) AS by_platform,
    count(DISTINCT o.platform) AS platforms_count,
    sum(o.revenue) AS total_revenue
   FROM o
     LEFT JOIN ad a ON a.merchant_code = o.merchant_code AND a.platform = o.platform AND a.sku_join = o.sku_norm
  GROUP BY o.merchant_code, (COALESCE(o.barcode, o.sku_norm))
 HAVING count(DISTINCT o.platform) > 1;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.cross_platform_product_perf FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.cross_platform_product_perf TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.cross_platform_product_perf; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'dd3951ebcfb881b1669e7b4c36ed2aa2' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.cross_platform_product_perf; review required';
  END IF;

  -- public.fulfillment_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.fulfillment_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.fulfillment_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(fulfillment_model, ''::text), 'Unknown'::text) AS fulfillment_model,
    count(*)::integer AS orders,
    sum(total_amount) AS revenue,
    sum(platform_fee) AS fees,
    avg(total_amount) AS avg_order_value,
    count(*) FILTER (WHERE status = 'cancelled'::text)::integer AS cancelled,
    count(*) FILTER (WHERE status = 'returned'::text)::integer AS returned,
    avg(EXTRACT(epoch FROM shipment_date - order_date) / 3600.0) AS avg_ship_hours,
    avg(EXTRACT(epoch FROM delivered_date - shipment_date) / 3600.0) AS avg_delivery_hours
   FROM orders
  WHERE order_date >= (now() - '180 days'::interval)
  GROUP BY merchant_code, platform, fulfillment_model;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.fulfillment_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.fulfillment_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.fulfillment_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '08a03fa77adc3fda2534be18f92c7b5c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.fulfillment_performance; review required';
  END IF;

  -- public.inventory_ageing: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_ageing');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_ageing WITH (security_invoker = true) AS
 WITH last_movement AS (
         SELECT o.merchant_code,
            o.platform,
            o.sku,
            max(o.order_date) AS last_sold
           FROM orders o
          WHERE o.status <> 'cancelled'::text
          GROUP BY o.merchant_code, o.platform, o.sku
        )
 SELECT i.id,
    i.merchant_code,
    i.platform,
    i.sku,
    i.product_name,
    i.quantity,
    COALESCE(i.cost_price, 0::numeric) AS cost_price,
    i.quantity::numeric * COALESCE(i.cost_price, 0::numeric) AS tied_capital,
    lm.last_sold,
    COALESCE(EXTRACT(day FROM now() - lm.last_sold)::integer, EXTRACT(day FROM now() - i.created_at)::integer) AS age_days,
        CASE
            WHEN lm.last_sold IS NULL THEN 'never_sold'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 90::numeric THEN 'dead_stock'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 60::numeric THEN 'aging'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 30::numeric THEN 'slow'::text
            ELSE 'fresh'::text
        END AS ageing_class
   FROM inventory i
     LEFT JOIN last_movement lm ON lm.merchant_code = i.merchant_code AND lm.platform = i.platform AND lm.sku = i.sku
  WHERE i.is_active AND i.quantity > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_ageing FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_ageing TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_ageing; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '7f9c56a12fba577f79f5c78117497003' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_ageing; review required';
  END IF;

  -- public.inventory_pipeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_pipeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_pipeline WITH (security_invoker = true) AS
 WITH asn AS (
         SELECT s.merchant_code,
            s.platform,
            s.asn_number,
            s.expected_qty,
            s.delivered_qty,
            s.expected_qty - s.delivered_qty AS lost_qty,
            s.delivery_date,
            s.created_at AS asn_sent_at,
            s.warehouse_code
           FROM inbound_shipments s
        ), grn_per_asn AS (
         SELECT g.merchant_code,
            g.asn_number,
            sum(g.grn_quantity) AS grn_total,
            sum(g.grn_quantity) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_qty,
            count(*) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_lines,
            min(g.grn_date) AS grn_date
           FROM goods_received g
          GROUP BY g.merchant_code, g.asn_number
        ), sales_per_asn AS (
         SELECT a.merchant_code,
            a.asn_number,
            count(o.id) AS orders_after,
            COALESCE(sum(o.quantity), 0::bigint) AS units_sold_after,
            COALESCE(sum(o.total_amount), 0::numeric) AS revenue_after
           FROM asn a
             LEFT JOIN orders o ON o.merchant_code = a.merchant_code AND o.platform = a.platform AND o.order_date::date >= COALESCE(a.delivery_date, a.asn_sent_at::date) AND o.status <> 'cancelled'::text
          GROUP BY a.merchant_code, a.asn_number
        )
 SELECT asn.merchant_code,
    asn.platform,
    asn.asn_number,
    asn.warehouse_code,
    asn.asn_sent_at,
    asn.delivery_date,
    asn.expected_qty,
    asn.delivered_qty,
    asn.lost_qty,
    COALESCE(grn.grn_total, 0::bigint) AS grn_total,
    COALESCE(grn.qc_failed_qty, 0::bigint) AS qc_failed_qty,
    COALESCE(grn.qc_failed_lines, 0::bigint) AS qc_failed_lines,
    COALESCE(sa.orders_after, 0::bigint) AS orders_after_receive,
    COALESCE(sa.units_sold_after, 0::bigint) AS units_sold_after_receive,
    COALESCE(sa.revenue_after, 0::numeric) AS revenue_after_receive,
        CASE
            WHEN asn.delivery_date IS NOT NULL AND asn.asn_sent_at IS NOT NULL THEN EXTRACT(day FROM asn.delivery_date::timestamp without time zone::timestamp with time zone - asn.asn_sent_at)::integer
            ELSE NULL::integer
        END AS days_to_receive
   FROM asn
     LEFT JOIN grn_per_asn grn USING (merchant_code, asn_number)
     LEFT JOIN sales_per_asn sa USING (merchant_code, asn_number);$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_pipeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_pipeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_pipeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '801d93ee41a9f47e0206e4eaab261911' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_pipeline; review required';
  END IF;

  -- public.merchant_timeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.merchant_timeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.merchant_timeline WITH (security_invoker = true) AS
 SELECT merchant_notes.merchant_code,
    'note'::text AS kind,
    merchant_notes.id::text AS ref_id,
    merchant_notes.type AS sub_type,
    merchant_notes.body AS title,
    NULL::text AS body,
    merchant_notes.author_email,
    merchant_notes.created_at
   FROM merchant_notes
UNION ALL
 SELECT merchant_requests.merchant_code,
    'task'::text AS kind,
    merchant_requests.id::text AS ref_id,
    COALESCE(merchant_requests.category, merchant_requests.type) AS sub_type,
    merchant_requests.title,
    merchant_requests.note AS body,
    merchant_requests.created_by AS author_email,
    merchant_requests.created_at
   FROM merchant_requests
UNION ALL
 SELECT platform_file_uploads.merchant_code,
    'upload'::text AS kind,
    platform_file_uploads.id::text AS ref_id,
    platform_file_uploads.file_type AS sub_type,
    platform_file_uploads.file_name AS title,
    NULL::text AS body,
    platform_file_uploads.uploaded_by AS author_email,
    platform_file_uploads.uploaded_at AS created_at
   FROM platform_file_uploads
UNION ALL
 SELECT notifications.merchant_code,
    'notify'::text AS kind,
    notifications.id::text AS ref_id,
    notifications.type AS sub_type,
    notifications.title,
    notifications.body,
    NULL::text AS author_email,
    notifications.created_at
   FROM notifications;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.merchant_timeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.merchant_timeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.merchant_timeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'e202d55cbba76ebae198ea832c7187d8' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.merchant_timeline; review required';
  END IF;

  -- public.product_abc_analysis: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.product_abc_analysis');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.product_abc_analysis WITH (security_invoker = true) AS
 WITH ranked AS (
         SELECT pp.merchant_code,
            pp.product_id,
            pp.product_name,
            pp.sku,
            pp.brand,
            pp.revenue,
            pp.units_sold,
            pp.net_profit,
            sum(pp.revenue) OVER (PARTITION BY pp.merchant_code) AS total_revenue,
            row_number() OVER (PARTITION BY pp.merchant_code ORDER BY pp.revenue DESC) AS rank
           FROM product_profitability pp
          WHERE pp.units_sold > 0
        ), cumulative AS (
         SELECT ranked.merchant_code,
            ranked.product_id,
            ranked.product_name,
            ranked.sku,
            ranked.brand,
            ranked.revenue,
            ranked.units_sold,
            ranked.net_profit,
            ranked.total_revenue,
            ranked.rank,
            sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_revenue,
                CASE
                    WHEN ranked.total_revenue > 0::numeric THEN sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / ranked.total_revenue * 100::numeric
                    ELSE 0::numeric
                END AS cum_pct
           FROM ranked
        )
 SELECT merchant_code,
    product_id,
    product_name,
    sku,
    brand,
    revenue,
    units_sold,
    net_profit,
    rank,
    round(cum_pct, 1) AS cumulative_pct,
        CASE
            WHEN cum_pct <= 80::numeric THEN 'A'::text
            WHEN cum_pct <= 95::numeric THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class
   FROM cumulative;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.product_abc_analysis FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.product_abc_analysis TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.product_abc_analysis; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'aadec7721b77a1698b38dc1a4425251c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.product_abc_analysis; review required';
  END IF;

  -- public.receiving_accuracy: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.receiving_accuracy');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.receiving_accuracy WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    COALESCE(NULLIF(barcode, ''::text), partner_sku) AS barcode,
    count(DISTINCT asn_number) AS shipments,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'passed'::text), 0::bigint) AS received_ok,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint) AS rejected,
    sum(grn_quantity) AS total_received,
        CASE
            WHEN sum(grn_quantity) > 0 THEN round(COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint)::numeric / sum(grn_quantity)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS rejection_rate_pct,
    array_agg(DISTINCT reject_reason) FILTER (WHERE qc_status = 'failed'::text AND reject_reason <> ''::text) AS reject_reasons
   FROM goods_received gr
  GROUP BY merchant_code, platform, sku, (COALESCE(NULLIF(barcode, ''::text), partner_sku));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.receiving_accuracy FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.receiving_accuracy TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.receiving_accuracy; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8df9a9af71320e7c822479b5fdf2e7a3' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.receiving_accuracy; review required';
  END IF;

  -- public.search_query_insights: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.search_query_insights');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.search_query_insights WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    search_query,
    count(*)::integer AS occurrences,
    sum(impressions) AS impressions,
    sum(clicks) AS clicks,
    sum(orders)::integer AS orders,
    sum(spend) AS spend,
    sum(revenue) AS revenue,
        CASE
            WHEN sum(impressions) > 0 THEN round(sum(clicks)::numeric / sum(impressions)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS ctr,
        CASE
            WHEN sum(spend) > 0::numeric THEN round(sum(revenue) / sum(spend), 2)
            ELSE NULL::numeric
        END AS roas,
        CASE
            WHEN sum(clicks) > 0 THEN round(sum(orders)::numeric / sum(clicks)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS cvr
   FROM ad_metrics
  WHERE search_query IS NOT NULL AND search_query <> ''::text
  GROUP BY merchant_code, platform, search_query;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.search_query_insights FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.search_query_insights TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.search_query_insights; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '6ac302dd43cd56e22134d126f4c26ee6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.search_query_insights; review required';
  END IF;

  -- public.sku_lifecycle: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sku_lifecycle');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sku_lifecycle WITH (security_invoker = true) AS
 WITH stats AS (
         SELECT p.merchant_code,
            p.id,
            p.name,
            p.sku,
            p.created_at,
            EXTRACT(day FROM now() - p.created_at)::integer AS age_days,
            COALESCE(pp.units_sold, 0::bigint) AS units_sold,
            COALESCE(pp.revenue, 0::numeric) AS revenue,
            COALESCE(pp.profit_margin_pct, 0::numeric) AS margin
           FROM products p
             LEFT JOIN product_profitability pp ON pp.product_id = p.id
        )
 SELECT merchant_code,
    id,
    name,
    sku,
    created_at,
    age_days,
    units_sold,
    revenue,
    margin,
        CASE
            WHEN age_days < 30 AND units_sold > 0 THEN 'launching'::text
            WHEN age_days < 30 AND units_sold = 0 THEN 'new_no_sales'::text
            WHEN units_sold > 0 AND age_days >= 30 AND age_days <= 180 THEN 'growing'::text
            WHEN units_sold > 0 AND age_days > 180 THEN 'mature'::text
            WHEN units_sold = 0 AND age_days > 60 THEN 'dormant'::text
            ELSE 'unknown'::text
        END AS lifecycle_stage
   FROM stats;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sku_lifecycle FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sku_lifecycle TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sku_lifecycle; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'f047c391d25cd08ea9fc184eac5725b1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sku_lifecycle; review required';
  END IF;

  -- public.supplier_quality_over_time: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supplier_quality_over_time');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supplier_quality_over_time WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    date_trunc('month'::text, grn_date::timestamp with time zone)::date AS month,
    count(*) AS total_lines,
    count(*) FILTER (WHERE qc_status = 'failed'::text) AS failed_lines,
    sum(grn_quantity) AS total_qty,
    sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text) AS failed_qty,
    round(count(*) FILTER (WHERE qc_status = 'failed'::text)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 2) AS failure_rate_pct
   FROM goods_received
  WHERE grn_date IS NOT NULL
  GROUP BY merchant_code, platform, (date_trunc('month'::text, grn_date::timestamp with time zone));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supplier_quality_over_time FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supplier_quality_over_time TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supplier_quality_over_time; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2951f5f88032aab39cc13106fe700cd0' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supplier_quality_over_time; review required';
  END IF;

  -- public.supply_chain_health: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supply_chain_health');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supply_chain_health WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    count(*) AS shipments,
    sum(expected_qty) AS total_expected,
    sum(delivered_qty) AS total_delivered,
    sum(variance) AS total_variance,
    round(sum(abs(LEAST(variance, 0)))::numeric / NULLIF(sum(expected_qty), 0)::numeric * 100::numeric, 2) AS loss_rate_pct,
    ( SELECT count(*) AS count
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failures,
    ( SELECT COALESCE(sum(g.grn_quantity), 0::bigint) AS "coalesce"
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failed_qty
   FROM inbound_shipments s
  GROUP BY merchant_code, platform;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supply_chain_health FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supply_chain_health TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supply_chain_health; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '85a18521d6f27e65b6b0318a307eafa1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supply_chain_health; review required';
  END IF;

  -- public.sync_queue_stats: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sync_queue_stats');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sync_queue_stats WITH (security_invoker = true) AS
 SELECT platform,
    job_type,
    status,
    count(*) AS job_count,
    avg(EXTRACT(epoch FROM finished_at - started_at))::integer AS avg_duration_sec,
    max(created_at) AS latest_job
   FROM sync_queue
  WHERE created_at > (now() - '24:00:00'::interval)
  GROUP BY platform, job_type, status
  ORDER BY platform, job_type, status;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sync_queue_stats FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sync_queue_stats TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sync_queue_stats; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'a55c4a57f9c6538e52814385cc301b8c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sync_queue_stats; review required';
  END IF;

  -- public.top_failing_skus: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.top_failing_skus');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.top_failing_skus WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    partner_sku,
    barcode,
    count(*) AS reject_events,
    sum(grn_quantity) AS total_rejected_qty,
    array_agg(DISTINCT reject_reason) FILTER (WHERE reject_reason IS NOT NULL) AS reasons
   FROM goods_received
  WHERE qc_status = 'failed'::text
  GROUP BY merchant_code, platform, sku, partner_sku, barcode;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.top_failing_skus FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.top_failing_skus TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.top_failing_skus; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '926aa4df787ee90df821b95d9cfd3f75' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.top_failing_skus; review required';
  END IF;

  -- public.true_ad_effectiveness: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.true_ad_effectiveness');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.true_ad_effectiveness WITH (security_invoker = true) AS
 SELECT am.merchant_code,
    am.platform,
    NULLIF(am.sku, ''::text) AS sku,
    am.campaign_name,
    sum(am.spend) AS spend,
    sum(am.revenue) AS gross_revenue,
    sum(am.orders) AS orders,
    round(sum(am.revenue) * COALESCE(fp.fee_rate, 0::numeric), 2) AS est_fees,
    round(sum(am.revenue) * COALESCE(rp.return_rate, 0::numeric), 2) AS est_returns,
    fp.fee_rate,
    rp.return_rate,
    round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)), 2) AS net_revenue,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS gross_roas,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS net_roas,
    fp.commission,
    fp.fba_fee,
    fp.withheld_vat,
    max(pr.name) AS product_name
   FROM ad_metrics am
     LEFT JOIN platform_fee_profile fp ON fp.merchant_code = am.merchant_code AND fp.platform = am.platform
     LEFT JOIN platform_return_profile rp ON rp.merchant_code = am.merchant_code AND rp.platform = am.platform
     LEFT JOIN products pr ON pr.merchant_code = am.merchant_code AND (pr.sku = am.sku OR pr.noon_sku_child = am.sku)
  WHERE am.spend > 0::numeric
  GROUP BY am.merchant_code, am.platform, (NULLIF(am.sku, ''::text)), am.campaign_name, fp.fee_rate, rp.return_rate, fp.commission, fp.fba_fee, fp.withheld_vat;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.true_ad_effectiveness FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.true_ad_effectiveness TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.true_ad_effectiveness; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8dfaab5984388d078e12f9b637dc314d' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.true_ad_effectiveness; review required';
  END IF;

  -- public.variant_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.variant_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.variant_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(brand, ''::text), 'بلا ماركة'::text) AS brand,
    COALESCE(NULLIF(color, ''::text), 'بلا لون'::text) AS color,
    COALESCE(NULLIF(size, ''::text), 'بلا مقاس'::text) AS size,
    sum(sold)::integer AS units_sold,
    sum(returned)::integer AS units_returned,
    sum(gross_sales) AS revenue,
    sum(net_revenue) AS net_revenue,
    round(sum(returned)::numeric / NULLIF(sum(sold), 0)::numeric * 100::numeric, 1) AS return_rate_pct
   FROM product_performance_snapshots
  WHERE color IS NOT NULL OR size IS NOT NULL
  GROUP BY merchant_code, platform, brand, color, size
 HAVING sum(sold) > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.variant_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.variant_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.variant_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '25ad00592dd52bc01b231bfacda22f00' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.variant_performance; review required';
  END IF;

  object_oid := to_regprocedure('public.inventory_turnover(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cogs AS (
    SELECT COALESCE(SUM(o.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs,
           COALESCE(SUM(o.total_amount), 0) AS total_revenue
    FROM public.orders o
    LEFT JOIN public.products p ON p.merchant_code = o.merchant_code AND p.sku = o.sku
    WHERE o.merchant_code = p_merchant_code
      AND o.order_date >= NOW() - p_days * INTERVAL '1 day'
      AND o.status NOT IN ('cancelled')
  ),
  inv AS (
    SELECT COALESCE(SUM(quantity * COALESCE(cost_price, 0)), 0) AS avg_inv_value,
           COALESCE(SUM(quantity), 0) AS total_units
    FROM public.inventory
    WHERE merchant_code = p_merchant_code AND is_active
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'cogs',          cogs.total_cogs,
    'revenue',       cogs.total_revenue,
    'avg_inv_value', inv.avg_inv_value,
    'total_units',   inv.total_units,
    'turnover_ratio', CASE WHEN inv.avg_inv_value > 0 THEN ROUND((cogs.total_cogs / inv.avg_inv_value)::numeric * (365.0 / p_days), 2) ELSE NULL END,
    'days_to_sell_all', CASE WHEN cogs.total_cogs > 0 THEN ROUND((inv.avg_inv_value / cogs.total_cogs * p_days)::numeric, 0) ELSE NULL END
  )
  FROM cogs, inv;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.inventory_turnover; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f86cda032fe06b2d38d3dc6feb1c5ab6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_turnover; review required';
  END IF;

  object_oid := to_regprocedure('public.period_comparison(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.period_comparison(p_merchant_code text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH curr AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - p_days * INTERVAL '1 day')
      AND data_date <= CURRENT_DATE
  ),
  prev AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - 2 * p_days * INTERVAL '1 day')
      AND data_date <= (CURRENT_DATE - p_days * INTERVAL '1 day')
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'current',  jsonb_build_object('sales', curr.sales, 'orders', curr.orders, 'ad_spend', curr.ad_spend, 'fees', curr.fees),
    'previous', jsonb_build_object('sales', prev.sales, 'orders', prev.orders, 'ad_spend', prev.ad_spend, 'fees', prev.fees),
    'delta_pct', jsonb_build_object(
      'sales',    CASE WHEN prev.sales    > 0 THEN ROUND(((curr.sales - prev.sales) / prev.sales * 100)::numeric, 1) ELSE NULL END,
      'orders',   CASE WHEN prev.orders   > 0 THEN ROUND(((curr.orders - prev.orders)::numeric / prev.orders * 100), 1) ELSE NULL END,
      'ad_spend', CASE WHEN prev.ad_spend > 0 THEN ROUND(((curr.ad_spend - prev.ad_spend) / prev.ad_spend * 100)::numeric, 1) ELSE NULL END,
      'fees',     CASE WHEN prev.fees     > 0 THEN ROUND(((curr.fees - prev.fees) / prev.fees * 100)::numeric, 1) ELSE NULL END
    )
  )
  FROM curr, prev;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.period_comparison; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '72571f4b98ed76ef4d6281bd88f6c15c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.period_comparison; review required';
  END IF;

  object_oid := to_regprocedure('public.restock_recommendations(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer DEFAULT 14)
 RETURNS TABLE(sku text, product_name text, platform text, current_qty integer, daily_velocity numeric, days_of_stock numeric, suggested_order_qty integer, urgency text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT
      sku, product_name, platform,
      quantity AS current_qty,
      daily_velocity,
      days_of_stock,
      GREATEST(CEIL(daily_velocity * (p_lead_time_days + 30))::int - quantity, 0) AS suggested_order_qty,
      CASE
        WHEN quantity = 0 THEN 'urgent'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < p_lead_time_days THEN 'high'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < (p_lead_time_days + 7) THEN 'medium'
        ELSE 'low'
      END AS urgency
    FROM public.inventory_health
    WHERE merchant_code = p_merchant_code
      AND daily_velocity > 0
      AND (days_of_stock IS NULL OR days_of_stock < (p_lead_time_days + 14))
  ) t
  ORDER BY
    (CASE t.urgency WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END),
    t.days_of_stock NULLS FIRST;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.restock_recommendations; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '640cc7bef99e0560c1dac28b705fe0a7' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.restock_recommendations; review required';
  END IF;

  object_oid := to_regprocedure('public.return_reasons_breakdown(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.return_reasons_breakdown(p_merchant_code text)
 RETURNS TABLE(reason text, count integer, percentage numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE total int;
BEGIN
  CREATE TEMP TABLE _rr (reason text, cnt int) ON COMMIT DROP;
  INSERT INTO _rr
    SELECT key, SUM(value::int)::int AS cnt
    FROM public.product_performance_snapshots,
         jsonb_each_text(return_reasons) AS r(key, value)
    WHERE merchant_code = p_merchant_code
      AND value::int > 0
    GROUP BY key;
  SELECT SUM(cnt) INTO total FROM _rr;
  RETURN QUERY
    SELECT _rr.reason, _rr.cnt, CASE WHEN total > 0 THEN ROUND((_rr.cnt::numeric / total * 100)::numeric, 1) ELSE 0 END
    FROM _rr ORDER BY _rr.cnt DESC;
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.return_reasons_breakdown; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '41ded9e99be0b950291d81e512bf2d21' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.return_reasons_breakdown; review required';
  END IF;

  object_oid := to_regprocedure('public.sales_heatmap(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS TABLE(day_of_week integer, hour_of_day integer, orders integer, sales numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    EXTRACT(DOW FROM order_date)::int  AS day_of_week,
    EXTRACT(HOUR FROM order_date)::int AS hour_of_day,
    COUNT(*)::int AS orders,
    COALESCE(SUM(total_amount), 0)::numeric AS sales
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - p_days * INTERVAL '1 day'
    AND status NOT IN ('cancelled')
    AND order_date::time <> '00:00:00'
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.sales_heatmap; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'c7e0158141ca857ff124c87fe0885ea4' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sales_heatmap; review required';
  END IF;

  object_oid := to_regprocedure('public.shipping_analytics(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.shipping_analytics(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ship AS (
    SELECT
      EXTRACT(EPOCH FROM (shipment_date - order_date)) / 3600.0 AS ship_hours,
      EXTRACT(EPOCH FROM (delivered_date - shipment_date)) / 3600.0 AS delivery_hours,
      EXTRACT(EPOCH FROM (delivered_date - order_date)) / 86400.0 AS total_days,
      status, platform
    FROM public.orders
    WHERE merchant_code = p_merchant_code
      AND order_date >= NOW() - INTERVAL '90 days'
      AND shipment_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'total_orders', COUNT(*),
    'avg_ship_hours', ROUND(AVG(ship_hours)::numeric, 1),
    'avg_delivery_hours', ROUND(AVG(delivery_hours)::numeric, 1),
    'avg_total_days', ROUND(AVG(total_days)::numeric, 1),
    'late_shipments', COUNT(*) FILTER (WHERE ship_hours > 48),
    'fastest_hours', ROUND(MIN(ship_hours)::numeric, 1),
    'slowest_hours', ROUND(MAX(ship_hours)::numeric, 1)
  )
  FROM ship;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.shipping_analytics(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.shipping_analytics(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.shipping_analytics; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '0bafae1e3e1b44c87f378f2d68277b28' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.shipping_analytics; review required';
  END IF;

  object_oid := to_regprocedure('public.tasks_summary(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.tasks_summary(p_assigned text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',       COUNT(*),
    'pending',     COUNT(*) FILTER (WHERE status = 'pending'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'done',        COUNT(*) FILTER (WHERE status = 'done'),
    'blocked',     COUNT(*) FILTER (WHERE status = 'blocked'),
    'urgent',      COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('done','rejected')),
    'overdue',     COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('done','rejected'))
  )
  FROM public.merchant_requests
  WHERE p_assigned IS NULL OR assigned_to = p_assigned;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_summary(p_assigned text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tasks_summary(p_assigned text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.tasks_summary; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'd5724bc1469042a78608406328af4c7a' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.tasks_summary; review required';
  END IF;

  object_oid := to_regprocedure('public.weekly_digest(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.weekly_digest(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curr jsonb; v_prev jsonb;
  v_top_product text; v_alerts text;
BEGIN
  -- مقارنة 7 يوم مع 7 السابقة
  SELECT public.period_comparison(p_merchant_code, 7) INTO v_curr;

  -- أعلى منتج بيع آخر 7 أيام
  SELECT product_name INTO v_top_product
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - INTERVAL '7 days'
    AND status NOT IN ('cancelled')
    AND product_name IS NOT NULL
  GROUP BY product_name
  ORDER BY SUM(total_amount) DESC
  LIMIT 1;

  -- التنبيهات
  SELECT string_agg(title, E'\n') INTO v_alerts
  FROM (
    SELECT title FROM public.notifications
    WHERE merchant_code = p_merchant_code AND created_at >= NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'merchant_code', p_merchant_code,
    'period', '7 أيام',
    'sales',     v_curr->'current'->>'sales',
    'orders',    v_curr->'current'->>'orders',
    'ad_spend',  v_curr->'current'->>'ad_spend',
    'sales_delta_pct',  v_curr->'delta_pct'->>'sales',
    'orders_delta_pct', v_curr->'delta_pct'->>'orders',
    'top_product', COALESCE(v_top_product, 'لا يوجد'),
    'alerts',      COALESCE(v_alerts, 'لا تنبيهات جديدة')
  );
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.weekly_digest(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.weekly_digest(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.weekly_digest; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f8e4d63929905515b18012b2b6caaefc' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.weekly_digest; review required';
  END IF;

END
$restore_analytics$;
$actual_sql$]); end $executed_20261126092419$;
do $executed_20261126092426$ begin perform pg_temp.assert_original_history(); if exists(select 1 from supabase_migrations.schema_migrations where version='20261126092426') then raise exception 'CORRECTION_ALREADY_RECORDED'; end if; insert into supabase_migrations.schema_migrations(version,name,statements) values('20261126092426','reconcile_confirmed_security_schema_gaps',array[$actual_sql$-- REVIEW DRAFT ONLY: confirmed schema gaps; not approved for production.
-- Exact private implementation/public wrapper from the rebuilt committed history.
-- Does not execute cost imports, clear names, replay baseline or repair history.
CREATE OR REPLACE FUNCTION security.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_merchant_code text := COALESCE(NULLIF(btrim(p_merchant_code), ''), public.current_merchant_code());
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR v_merchant_code IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  IF NOT security.has_merchant_permission(v_merchant_code, 'products') THEN
    RAISE EXCEPTION 'PRODUCT_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COST_UPDATE_PAYLOAD';
  END IF;

  v_rows := jsonb_array_length(p_updates);
  IF v_rows = 0 OR v_rows > 5000 THEN
    RAISE EXCEPTION 'COST_UPDATE_ROW_LIMIT';
  END IF;

  RETURN QUERY
  WITH raw_input AS (
    SELECT trim(COALESCE(row_data ->> 'identifier', '')) AS identifier,
           trim(COALESCE(row_data ->> 'cost_price', '')) AS cost_text,
           ordinality
    FROM jsonb_array_elements(p_updates) WITH ORDINALITY AS input(row_data, ordinality)
  ), parsed AS (
    SELECT identifier, lower(identifier) AS normalized_identifier,
           CASE WHEN replace(cost_text, ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
             THEN replace(cost_text, ',', '.')::numeric ELSE NULL END AS cost_price,
           ordinality
    FROM raw_input
  ), valid_input AS (
    SELECT DISTINCT ON (normalized_identifier) identifier, normalized_identifier, cost_price
    FROM parsed
    WHERE normalized_identifier <> '' AND cost_price > 0
    ORDER BY normalized_identifier, ordinality DESC
  ), matches AS (
    SELECT input.identifier, input.normalized_identifier, input.cost_price,
           product.id AS product_id,
           count(*) OVER (PARTITION BY input.normalized_identifier) AS match_count
    FROM valid_input input
    JOIN public.products product
      ON product.merchant_code = v_merchant_code
     AND input.normalized_identifier IN (
       lower(trim(COALESCE(product.sku, ''))), lower(trim(COALESCE(product.barcode, ''))),
       lower(trim(COALESCE(product.external_id, ''))), lower(trim(COALESCE(product.model_code, ''))),
       lower(trim(COALESCE(product.supplier_sku, ''))), lower(trim(COALESCE(product.psku_code, ''))),
       lower(trim(COALESCE(product.noon_sku_child, ''))), lower(trim(COALESCE(product.asin, '')))
     )
  ), updated AS (
    UPDATE public.products product
       SET cost_price = match.cost_price, updated_at = now()
      FROM matches match
     WHERE match.match_count = 1
       AND product.id = match.product_id
       AND product.merchant_code = v_merchant_code
    RETURNING product.id
  )
  SELECT
    (SELECT count(*)::integer FROM updated),
    COALESCE((SELECT array_agg(input.identifier ORDER BY input.identifier)
      FROM valid_input input WHERE NOT EXISTS (
        SELECT 1 FROM matches match WHERE match.normalized_identifier = input.normalized_identifier
      )), '{}'::text[]),
    COALESCE((SELECT array_agg(DISTINCT match.identifier ORDER BY match.identifier)
      FROM matches match WHERE match.match_count > 1), '{}'::text[]),
    (SELECT count(*)::integer FROM parsed
      WHERE normalized_identifier = '' OR cost_price IS NULL OR cost_price <= 0);
END
$function$
;
CREATE OR REPLACE FUNCTION public.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT * FROM security.bulk_update_product_costs(p_updates, p_merchant_code) $function$
;

REVOKE ALL ON FUNCTION security.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;

-- Restrictive tenant/permission boundaries do not grant access by themselves;
-- sales_targets also needs a permissive write policy for the merchant goal RPC.
-- The restrictive policies remain the final tenant and section guard.
DROP POLICY IF EXISTS merchant_sales_targets_insert ON public.sales_targets;
CREATE POLICY merchant_sales_targets_insert
ON public.sales_targets
FOR INSERT TO authenticated
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));

DROP POLICY IF EXISTS merchant_sales_targets_update ON public.sales_targets;
CREATE POLICY merchant_sales_targets_update
ON public.sales_targets
FOR UPDATE TO authenticated
USING (security.has_merchant_permission(merchant_code, 'dashboard'))
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));


-- Validate the original privacy predicate without rewriting any customer rows.
-- A bounded production aggregate found zero violations during review.
-- If a concurrent violation exists at application time this migration must abort;
-- no automatic cleanup is authorized.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.trendyol_customer_questions'::regclass
      AND conname='trendyol_customer_questions_hidden_name_check'
  ) THEN
    ALTER TABLE public.trendyol_customer_questions
      ADD CONSTRAINT trendyol_customer_questions_hidden_name_check
      CHECK (show_customer_name OR customer_name IS NULL);
  END IF;
END
$migration$;
$actual_sql$]); end $executed_20261126092426$;
do $executed_20261126092919$ begin perform pg_temp.assert_original_history(); if exists(select 1 from supabase_migrations.schema_migrations where version='20261126092919') then raise exception 'CORRECTION_ALREADY_RECORDED'; end if; insert into supabase_migrations.schema_migrations(version,name,statements) values('20261126092919','preserve_production_rpc_and_audit_behavior',array[$actual_sql$-- REVIEW DRAFT ONLY. Preserve correct production behavior in fresh rebuilds.
-- Changes function definitions only; does not delete uploads, modify audit rows,
-- close imports/accounts, or rewrite existing merchant names.

CREATE OR REPLACE FUNCTION public.delete_upload_cascade_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_cascade_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION public.delete_upload_with_data_internal(p_upload_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select security.delete_upload_with_data_internal(p_upload_id) $function$

;

CREATE OR REPLACE FUNCTION security.write_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := COALESCE(v_new, v_old, '{}'::jsonb);
  v_actor text;
  v_record_id text;
  v_merchant_code text;
BEGIN
  v_actor := COALESCE(
    (SELECT auth.uid())::text,
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    current_user
  );
  v_record_id := COALESCE(v_row ->> 'id', v_row ->> 'merchant_code', v_row ->> 'key');
  v_merchant_code := COALESCE(v_row ->> 'merchant_code', v_row ->> 'owner_merchant_code');

  INSERT INTO public.audit_log (
    merchant_code, action, table_name, record_id,
    old_values, new_values, performed_by, performed_at
  ) VALUES (
    v_merchant_code, lower(TG_OP), TG_TABLE_NAME, v_record_id,
    security.redact_audit_values(v_old),
    security.redact_audit_values(v_new),
    v_actor, now()
  );

  RETURN COALESCE(NEW, OLD);
END
$function$

;

CREATE OR REPLACE FUNCTION security.close_stale_imports()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  affected integer;
BEGIN
  UPDATE public.platform_file_uploads
  SET status = 'failed',
      finished_at = now(),
      error_message = COALESCE(
        NULLIF(error_message, ''),
        'توقفت المعالجة لأكثر من 30 دقيقة — أغلقها النظام تلقائياً ويمكن إعادة رفع الملف'
      )
  WHERE status = 'processing'
    AND uploaded_at < now() - interval '30 minutes';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$function$

;

CREATE OR REPLACE FUNCTION security.handle_self_service_merchant_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text;
  v_name text;
  v_phone text;
  v_legal_version text;
  v_accepted boolean;
  v_attempt integer := 0;
begin
  if coalesce(new.raw_user_meta_data->>'signup_source', '') <> 'self_service' then
    return new;
  end if;

  v_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, ''), '@', 1), 'متجر جديد'), 120);
  v_phone := nullif(left(btrim(new.raw_user_meta_data->>'whatsapp_phone'), 32), '');
  v_legal_version := nullif(left(btrim(new.raw_user_meta_data->>'legal_version'), 10), '');
  v_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
    and coalesce((new.raw_user_meta_data->>'privacy_accepted')::boolean, false)
    and v_legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  loop
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 16));
    begin
      insert into public.merchants (
        id, merchant_code, name, email, currency, role,
        workspace_status, signup_source, whatsapp_phone, is_active
      ) values (
        new.id, v_code, v_name, lower(new.email), 'SAR', 'merchant',
        'active', 'self_service', v_phone, new.email_confirmed_at is not null
      );
      exit;
    exception when unique_violation then
      if exists (select 1 from public.merchants where id = new.id) then return new; end if;
      if v_attempt >= 3 then raise; end if;
    end;
  end loop;

  if v_accepted then
    insert into public.merchant_legal_acceptances (merchant_code, user_id, terms_version, privacy_version)
    values (v_code, new.id, v_legal_version, v_legal_version);
  end if;
  return new;
end
$function$

;

-- Preserve private browser execution boundaries. Internal wrappers are service-only.
REVOKE ALL ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade_internal(uuid), public.delete_upload_with_data_internal(uuid) TO service_role;
$actual_sql$]); end $executed_20261126092919$;
do $executed_20261126094647$ begin perform pg_temp.assert_original_history(); if exists(select 1 from supabase_migrations.schema_migrations where version='20261126094647') then raise exception 'CORRECTION_ALREADY_RECORDED'; end if; insert into supabase_migrations.schema_migrations(version,name,statements) values('20261126094647','reconcile_analytics_validation_and_arabic_labels',array[$actual_sql$-- DRAFT: preserve three production validation guards and repair two fallback labels.
-- Scoped catalog source passed credential/network/settings preflight.
-- No financial formulas, actor checks, signatures, function options or grants change.
-- Abort if either reviewed source version no longer matches the target.
DO $analytics_compat$
DECLARE object_oid oid;
BEGIN
  object_oid := to_regprocedure('public.merchant_health_score(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('4756fbbf9af85b758d608995c6bdd85f', 'fd5def43ee5918e71a626137f189bb93') THEN
    RAISE EXCEPTION 'Unexpected definition for public.merchant_health_score; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.merchant_health_score(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_data_as_of timestamptz;
  v_data_age_days integer;
  v_anchor_date date;
  v_orders_30d integer := 0;
  v_orders_prev_30d integer := 0;
  v_active_days integer := 0;
  v_sales_30d numeric := 0;
  v_sales_prev_30d numeric := 0;
  v_growth_pct numeric;
  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_profitable_products integer := 0;
  v_cost_coverage_pct numeric := 0;
  v_avg_margin_pct numeric;
  v_inventory_total integer := 0;
  v_inventory_fresh integer := 0;
  v_inventory_velocity integer := 0;
  v_inventory_stockouts integer := 0;
  v_inventory_reorder integer := 0;
  v_ad_spend numeric := 0;
  v_ad_net numeric := 0;
  v_net_roas numeric;
  v_readiness_indicators integer := 0;
  v_readiness_total numeric := 0;
  v_readiness_score numeric;
  v_profitability_score numeric;
  v_inventory_score numeric;
  v_demand_score numeric;
  v_marketing_score numeric;
  v_available_weight numeric := 0;
  v_weighted_points numeric := 0;
  v_score numeric;
  v_coverage_pct numeric := 0;
  v_confidence text := 'low';
  v_rating text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  v_data_as_of := greatest(
    (select max(created_at) from public.orders where merchant_code = p_merchant_code),
    (select max(last_updated) from public.inventory where merchant_code = p_merchant_code),
    (select max(uploaded_at) from public.platform_file_uploads where merchant_code = p_merchant_code),
    (select security.latest_platform_sync_at(p_merchant_code))
  );
  v_data_age_days := case when v_data_as_of is null then null
    else greatest(0, current_date - v_data_as_of::date) end;

  if v_anchor_date is not null then
    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      count(distinct order_date::date) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_30d, v_active_days, v_sales_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 29 and v_anchor_date;

    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_prev_30d, v_sales_prev_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

    v_growth_pct := case when v_sales_prev_30d > 0
      then round(((v_sales_30d - v_sales_prev_30d) / v_sales_prev_30d) * 100, 1)
      else null end;
  end if;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0 and net_profit > 0)::integer,
    avg(profit_margin_pct) filter (where units_sold > 0 and cost_price > 0)
  into v_sold_products, v_costed_products, v_profitable_products, v_avg_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'out_of_stock')::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'reorder_soon')::integer
  into v_inventory_total, v_inventory_fresh, v_inventory_velocity, v_inventory_stockouts, v_inventory_reorder
  from public.inventory_health
  where merchant_code = p_merchant_code;

  select coalesce(sum(total_spend), 0), coalesce(sum(total_net), 0)
    into v_ad_spend, v_ad_net
  from public.ad_net_summary
  where merchant_code = p_merchant_code;
  v_net_roas := case when v_ad_spend > 0 then v_ad_net / v_ad_spend else null end;

  -- Readiness (25%): only score evidence that actually exists.
  if v_sold_products > 0 then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + v_cost_coverage_pct;
  end if;
  if v_data_as_of is not null then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + case
      when v_data_age_days <= 2 then 100
      when v_data_age_days <= 7 then 70
      when v_data_age_days <= 14 then 40
      else 10 end;
  end if;
  if v_readiness_indicators > 0 then
    v_readiness_score := round(v_readiness_total / v_readiness_indicators, 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_readiness_score * 0.25;
  end if;

  -- Profitability (25%): unavailable until at least 80% of sold products have cost.
  if v_costed_products > 0 and v_cost_coverage_pct >= 80 then
    v_profitability_score := round(least(100, greatest(0,
      (v_profitable_products::numeric / v_costed_products * 70)
      + (least(30, greatest(-10, coalesce(v_avg_margin_pct, -10))) + 10) / 40 * 30
    )), 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_profitability_score * 0.25;
  end if;

  -- Inventory (20%): stale or velocity-free inventory is not scored.
  if v_inventory_velocity > 0 then
    v_inventory_score := round(least(100, greatest(0,
      100
      - (v_inventory_stockouts::numeric / v_inventory_velocity * 70)
      - (v_inventory_reorder::numeric / v_inventory_velocity * 30)
    )), 1);
    v_available_weight := v_available_weight + 20;
    v_weighted_points := v_weighted_points + v_inventory_score * 0.20;
  end if;

  -- Demand (15%): combine continuity with bounded period growth.
  if v_orders_30d > 0 then
    v_demand_score := round(least(100, greatest(0,
      (least(100, v_active_days::numeric / 30 * 100) * 0.45)
      + (case when v_growth_pct is null then 45
              else least(100, greatest(0, 50 + least(50, greatest(-50, v_growth_pct)))) end * 0.55)
    )), 1);
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_demand_score * 0.15;
  end if;

  -- Marketing (15%): no advertising data means unavailable, never free points.
  if v_ad_spend > 0 then
    v_marketing_score := case
      when v_net_roas < 1 then 10
      when v_net_roas < 2 then 40
      when v_net_roas < 3 then 65
      when v_net_roas < 5 then 85
      else 100 end;
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_marketing_score * 0.15;
  end if;

  v_coverage_pct := v_available_weight;
  v_score := case when v_available_weight >= 60
    then round(v_weighted_points / v_available_weight * 100, 0)
    else null end;
  v_confidence := case
    when v_coverage_pct >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_coverage_pct >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;
  v_rating := case
    when v_score is null then 'insufficient'
    when v_score >= 80 then 'excellent'
    when v_score >= 65 then 'good'
    when v_score >= 45 then 'watch'
    else 'critical' end;

  return jsonb_build_object(
    'score', v_score,
    'rating', v_rating,
    'confidence', v_confidence,
    'coverage_pct', v_coverage_pct,
    'data_as_of', v_data_as_of,
    'data_age_days', v_data_age_days,
    'breakdown', jsonb_build_object(
      'readiness', jsonb_build_object('available', v_readiness_score is not null, 'score', v_readiness_score, 'weight', 25, 'cost_coverage_pct', v_cost_coverage_pct, 'data_age_days', v_data_age_days),
      'profitability', jsonb_build_object('available', v_profitability_score is not null, 'score', v_profitability_score, 'weight', 25, 'sold_products', v_sold_products, 'costed_products', v_costed_products, 'profitable_products', v_profitable_products, 'avg_margin_pct', round(coalesce(v_avg_margin_pct, 0), 1)),
      'inventory', jsonb_build_object('available', v_inventory_score is not null, 'score', v_inventory_score, 'weight', 20, 'total_items', v_inventory_total, 'fresh_items', v_inventory_fresh, 'velocity_items', v_inventory_velocity, 'stockouts', v_inventory_stockouts, 'reorder_soon', v_inventory_reorder),
      'demand', jsonb_build_object('available', v_demand_score is not null, 'score', v_demand_score, 'weight', 15, 'orders_30d', v_orders_30d, 'active_days', v_active_days, 'sales_30d', v_sales_30d, 'growth_pct', v_growth_pct),
      'marketing', jsonb_build_object('available', v_marketing_score is not null, 'score', v_marketing_score, 'weight', 15, 'spend', v_ad_spend, 'net_revenue', v_ad_net, 'net_roas', round(coalesce(v_net_roas, 0), 2))
    )
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('public.revenue_forecast(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('657e01d64fb9785f70b7e997a05c04cc', 'a44ca5b9208e9378093d352eae66305a') THEN
    RAISE EXCEPTION 'Unexpected definition for public.revenue_forecast; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.revenue_forecast(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_first_date date;
  v_observed_days integer := 0;
  v_active_days integer := 0;
  v_data_age_days integer;
  v_last_30_sales numeric := 0;
  v_prev_30_sales numeric := 0;
  v_avg_daily numeric := 0;
  v_stddev numeric := 0;
  v_cv numeric := 0;
  v_growth_pct numeric;
  v_bounded_growth numeric := 0;
  v_forecast_30 numeric := 0;
  v_uncertainty_pct numeric := 0.45;
  v_lower_30 numeric := 0;
  v_upper_30 numeric := 0;
  v_confidence text := 'low';
  v_caveat text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date, min(order_date)::date
    into v_anchor_date, v_first_date
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned');

  if v_anchor_date is null then
    return jsonb_build_object(
      'last_30_sales', 0, 'prev_30_sales', 0, 'avg_daily', 0,
      'forecast_30', 0, 'forecast_60', 0, 'forecast_90', 0,
      'lower_30', 0, 'upper_30', 0, 'growth_rate_pct', null,
      'confidence', 'low', 'is_actionable', false, 'observed_days', 0,
      'active_days', 0, 'data_as_of', null, 'data_age_days', null,
      'method', 'bounded_recent_run_rate',
      'caveat', 'لا توجد طلبات كافية لبناء توقع.'
    );
  end if;

  v_data_age_days := greatest(0, current_date - v_anchor_date);
  v_observed_days := least(30, greatest(1, v_anchor_date - v_first_date + 1));

  with calendar as (
    select day::date
    from generate_series(v_anchor_date - (v_observed_days - 1), v_anchor_date, interval '1 day') day
  ), daily as (
    select c.day, coalesce(sum(o.total_amount), 0)::numeric as sales
    from calendar c
    left join public.orders o
      on o.merchant_code = p_merchant_code
     and o.order_date::date = c.day
     and o.status not in ('cancelled', 'returned')
    group by c.day
  )
  select coalesce(sum(sales), 0), count(*) filter (where sales > 0)::integer,
         coalesce(avg(sales), 0), coalesce(stddev_pop(sales), 0)
    into v_last_30_sales, v_active_days, v_avg_daily, v_stddev
  from daily;

  select coalesce(sum(total_amount), 0)
    into v_prev_30_sales
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned')
    and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

  v_growth_pct := case when v_prev_30_sales > 0
    then round(((v_last_30_sales - v_prev_30_sales) / v_prev_30_sales) * 100, 1)
    else null end;
  v_bounded_growth := least(50, greatest(-30, coalesce(v_growth_pct, 0)));
  v_cv := case when v_avg_daily > 0 then v_stddev / v_avg_daily else 0 end;

  v_confidence := case
    when (v_anchor_date - v_first_date + 1) >= 60 and v_active_days >= 20 and v_data_age_days <= 2 then 'high'
    when (v_anchor_date - v_first_date + 1) >= 30 and v_active_days >= 10 and v_data_age_days <= 7 then 'medium'
    else 'low' end;

  v_uncertainty_pct := case v_confidence
    when 'high' then greatest(0.15, least(0.30, v_cv * 0.35))
    when 'medium' then greatest(0.25, least(0.40, v_cv * 0.45))
    else 0.45 end;
  v_forecast_30 := round(greatest(0, v_avg_daily * 30 * (1 + v_bounded_growth / 200)), 2);
  v_lower_30 := round(greatest(0, v_forecast_30 * (1 - v_uncertainty_pct)), 2);
  v_upper_30 := round(v_forecast_30 * (1 + v_uncertainty_pct), 2);
  v_caveat := case
    when v_data_age_days > 7 then 'البيانات متأخرة؛ حدّث مصدر الطلبات قبل الاعتماد على التوقع.'
    when v_observed_days < 30 then 'السجل أقصر من 30 يومًا؛ سيضيق النطاق مع تراكم البيانات.'
    when v_active_days < 10 then 'أيام البيع الفعلية قليلة؛ التوقع استرشادي فقط.'
    else 'النطاق يعكس تذبذب المبيعات وحداثة البيانات، ولا يمثل ضمانًا.' end;

  return jsonb_build_object(
    'last_30_sales', round(v_last_30_sales, 2),
    'prev_30_sales', round(v_prev_30_sales, 2),
    'avg_daily', round(v_avg_daily, 2),
    'forecast_30', v_forecast_30,
    'forecast_60', round(v_forecast_30 * 2, 2),
    'forecast_90', round(v_forecast_30 * 3, 2),
    'lower_30', v_lower_30,
    'upper_30', v_upper_30,
    'growth_rate_pct', v_growth_pct,
    'confidence', v_confidence,
    'is_actionable', v_confidence in ('high', 'medium') and v_forecast_30 > 0,
    'observed_days', v_observed_days,
    'active_days', v_active_days,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'method', 'bounded_recent_run_rate',
    'caveat', v_caveat
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.merchant_executive_brief_base(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('2286d4081ed826cc61dfeaafd2827f50', '59952ef2c5a4a85c6a401a5a9b29f92b') THEN
    RAISE EXCEPTION 'Unexpected definition for security.merchant_executive_brief_base; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.merchant_executive_brief_base(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_period_start date;
  v_previous_start date;
  v_data_age_days integer;

  v_sales numeric := 0;
  v_previous_sales numeric := 0;
  v_orders integer := 0;
  v_previous_orders integer := 0;
  v_units numeric := 0;
  v_fees numeric := 0;
  v_shipping numeric := 0;
  v_discounts numeric := 0;
  v_contribution numeric := 0;
  v_previous_contribution numeric := 0;
  v_cancelled_or_returned integer := 0;
  v_previous_cancelled_or_returned integer := 0;
  v_all_orders integer := 0;
  v_previous_all_orders integer := 0;
  v_sales_change_pct numeric;
  v_contribution_change_pct numeric;
  v_exception_rate numeric;
  v_previous_exception_rate numeric;
  v_return_claims integer := 0;
  v_return_claims_amount numeric := 0;

  v_inventory_items integer := 0;
  v_inventory_fresh_items integer := 0;
  v_inventory_costed_items integer := 0;
  v_stockout_skus integer := 0;
  v_stockout_demand_value numeric := 0;
  v_slow_stock_value numeric := 0;
  v_unanalysed_stock_value numeric := 0;
  v_inventory_cost_coverage_pct numeric := 0;

  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_product_cost_coverage_pct numeric := 0;
  v_net_profit numeric;
  v_net_margin_pct numeric;

  v_cash_month date;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_cash_net numeric := 0;

  v_evidence_coverage numeric := 0;
  v_confidence text := 'low';
  v_priority_key text := 'connect_sources';
  v_priority_title text := 'اربط مصدر الطلبات لبدء الملخص التنفيذي';
  v_priority_detail text := 'لا توجد طلبات يمكن بناء قرارات أسبوعية موثوقة عليها.';
  v_priority_path text := '/integrations';
  v_priority_level text := 'high';
  v_priority_category text := 'data_quality';
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  if v_anchor_date is not null then
    v_period_start := v_anchor_date - 6;
    v_previous_start := v_anchor_date - 13;
    v_data_age_days := greatest(0, current_date - v_anchor_date);

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(quantity) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(platform_fee) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(shipping_cost) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(discount_amount) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_sales, v_orders, v_units, v_fees, v_shipping, v_discounts,
         v_contribution, v_cancelled_or_returned, v_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_period_start and v_anchor_date;

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_previous_sales, v_previous_orders, v_previous_contribution,
         v_previous_cancelled_or_returned, v_previous_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_previous_start and v_period_start - 1;

    v_sales_change_pct := case when v_previous_sales > 0
      then round((v_sales - v_previous_sales) / v_previous_sales * 100, 1) end;
    v_contribution_change_pct := case when v_previous_contribution > 0
      then round((v_contribution - v_previous_contribution) / v_previous_contribution * 100, 1) end;
    v_exception_rate := case when v_all_orders > 0
      then round(v_cancelled_or_returned::numeric / v_all_orders * 100, 1) end;
    v_previous_exception_rate := case when v_previous_all_orders > 0
      then round(v_previous_cancelled_or_returned::numeric / v_previous_all_orders * 100, 1) end;

    select count(*)::integer, coalesce(sum(return_amount), 0)
      into v_return_claims, v_return_claims_amount
    from public.returns
    where merchant_code = p_merchant_code
      and return_date between v_period_start and v_anchor_date;
  end if;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and cost_price > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0)::integer,
    coalesce(sum(daily_velocity * 30 * selling_price)
      filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0 and selling_price > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'slow_mover' and stock_value_cost > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'no_sales_data' and stock_value_cost > 0), 0)
  into v_inventory_items, v_inventory_fresh_items, v_inventory_costed_items,
       v_stockout_skus, v_stockout_demand_value, v_slow_stock_value,
       v_unanalysed_stock_value
  from public.inventory_health
  where merchant_code = p_merchant_code;

  v_inventory_cost_coverage_pct := case when v_inventory_fresh_items > 0
    then round(v_inventory_costed_items::numeric / v_inventory_fresh_items * 100, 1)
    else 0 end;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    sum(net_profit) filter (where units_sold > 0 and cost_price > 0),
    case when sum(revenue) filter (where units_sold > 0 and cost_price > 0) > 0
      then round(sum(net_profit) filter (where units_sold > 0 and cost_price > 0)
        / sum(revenue) filter (where units_sold > 0 and cost_price > 0) * 100, 1) end
  into v_sold_products, v_costed_products, v_net_profit, v_net_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_product_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;
  if v_product_cost_coverage_pct < 80 then
    v_net_profit := null;
    v_net_margin_pct := null;
  end if;

  select max(month) into v_cash_month
  from public.monthly_cashflow
  where merchant_code = p_merchant_code;

  if v_cash_month is not null then
    select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0), coalesce(sum(net), 0)
      into v_cash_in, v_cash_out, v_cash_net
    from public.monthly_cashflow
    where merchant_code = p_merchant_code and month = v_cash_month;
  end if;

  v_evidence_coverage :=
    (case when v_anchor_date is not null then 35 else 0 end)
    + (case when v_inventory_fresh_items > 0 then 25 else 0 end)
    + (case when v_cash_month is not null then 20 else 0 end)
    + (case when v_product_cost_coverage_pct >= 80 then 20 else 0 end);
  v_confidence := case
    when v_evidence_coverage >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_evidence_coverage >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;

  if v_anchor_date is null then
    null;
  elsif v_data_age_days > 7 then
    v_priority_key := 'executive_data_stale';
    v_priority_title := 'حدّث بيانات الطلبات قبل اتخاذ قرار أسبوعي';
    v_priority_detail := 'آخر طلب أقدم من 7 أيام، لذلك المقارنة الحالية لا تمثل وضع المتجر الآن.';
    v_priority_path := '/integrations';
    v_priority_level := 'high';
    v_priority_category := 'data_quality';
  elsif v_sold_products > 0 and v_product_cost_coverage_pct < 80 then
    v_priority_key := 'executive_cost_coverage';
    v_priority_title := 'استكمل تكلفة الشراء لاعتماد صافي الربح';
    v_priority_detail := 'التكاليف مكتملة لأقل من 80% من المنتجات المباعة، لذلك أخفى النظام الربح بدل عرض رقم مضلل.';
    v_priority_path := '/products?costs=import';
    v_priority_level := 'urgent';
    v_priority_category := 'profitability';
  elsif coalesce(v_exception_rate, 0) >= 10 then
    v_priority_key := 'executive_order_exceptions';
    v_priority_title := 'راجع ارتفاع الإلغاءات والمرتجعات هذا الأسبوع';
    v_priority_detail := 'تجاوزت الطلبات الملغاة أو المرتجعة 10% من الطلبات المسجلة في الفترة.';
    v_priority_path := '/orders';
    v_priority_level := 'urgent';
    v_priority_category := 'orders';
  elsif v_stockout_skus > 0 then
    v_priority_key := 'executive_stockouts';
    v_priority_title := 'عالج الأصناف النافدة التي لديها طلب سابق';
    v_priority_detail := 'يعرض النظام فقط الأصناف النافدة ذات حركة بيع حديثة وبيانات مخزون محدثة.';
    v_priority_path := '/inventory';
    v_priority_level := 'high';
    v_priority_category := 'inventory';
  elsif v_cash_month is not null and v_cash_net < 0 then
    v_priority_key := 'executive_negative_cashflow';
    v_priority_title := 'راجع صافي التدفق النقدي السلبي';
    v_priority_detail := 'المبالغ الخارجة في آخر شهر مالي متاح تجاوزت المبالغ الداخلة.';
    v_priority_path := '/statement';
    v_priority_level := 'high';
    v_priority_category := 'cashflow';
  elsif coalesce(v_sales_change_pct, 0) <= -15 then
    v_priority_key := 'executive_sales_decline';
    v_priority_title := 'حلّل تراجع المبيعات الأسبوعية';
    v_priority_detail := 'انخفضت المبيعات بأكثر من 15% مقارنة بالأسبوع السابق ضمن آخر بيانات متاحة.';
    v_priority_path := '/orders';
    v_priority_level := 'high';
    v_priority_category := 'demand';
  else
    v_priority_key := 'executive_no_urgent_action';
    v_priority_title := 'لا توجد إشارة تشغيلية عاجلة هذا الأسبوع';
    v_priority_detail := 'استمر في تحديث الطلبات والمخزون والتكاليف للحفاظ على دقة المتابعة.';
    v_priority_path := '/actions';
    v_priority_level := 'medium';
    v_priority_category := 'operations';
  end if;

  return jsonb_build_object(
    'available', v_anchor_date is not null,
    'confidence', v_confidence,
    'evidence_coverage_pct', v_evidence_coverage,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'period', jsonb_build_object(
      'start', v_period_start, 'end', v_anchor_date,
      'previous_start', v_previous_start,
      'previous_end', case when v_period_start is null then null else v_period_start - 1 end
    ),
    'week', jsonb_build_object(
      'sales', round(v_sales, 2), 'previous_sales', round(v_previous_sales, 2),
      'sales_change_pct', v_sales_change_pct,
      'orders', v_orders, 'previous_orders', v_previous_orders,
      'units', v_units,
      'average_order_value', case when v_orders > 0 then round(v_sales / v_orders, 2) else 0 end,
      'contribution_before_product_cost', round(v_contribution, 2),
      'previous_contribution_before_product_cost', round(v_previous_contribution, 2),
      'contribution_change_pct', v_contribution_change_pct,
      'cancelled_or_returned_orders', v_cancelled_or_returned,
      'exception_rate_pct', v_exception_rate,
      'previous_exception_rate_pct', v_previous_exception_rate
    ),
    'confirmed_deductions', jsonb_build_object(
      'platform_fees', round(v_fees, 2),
      'shipping', round(v_shipping, 2),
      'discounts', round(v_discounts, 2),
      'return_claims_count', v_return_claims,
      'return_claims_amount', round(v_return_claims_amount, 2),
      'total_excluding_returns', round(v_fees + v_shipping + v_discounts, 2)
    ),
    'inventory_risk', jsonb_build_object(
      'available', v_inventory_fresh_items > 0,
      'items', v_inventory_items,
      'fresh_items', v_inventory_fresh_items,
      'cost_coverage_pct', v_inventory_cost_coverage_pct,
      'stockout_skus', v_stockout_skus,
      'stockout_historical_30d_demand_value', round(v_stockout_demand_value, 2),
      'slow_stock_value', round(v_slow_stock_value, 2),
      'unanalysed_stock_value', round(v_unanalysed_stock_value, 2)
    ),
    'profitability', jsonb_build_object(
      'available', v_product_cost_coverage_pct >= 80 and v_sold_products > 0,
      'sold_products', v_sold_products,
      'costed_products', v_costed_products,
      'cost_coverage_pct', v_product_cost_coverage_pct,
      'net_profit', v_net_profit,
      'net_margin_pct', v_net_margin_pct,
      'minimum_coverage_pct', 80
    ),
    'cash', jsonb_build_object(
      'available', v_cash_month is not null,
      'month', v_cash_month,
      'cash_in', round(v_cash_in, 2),
      'cash_out', round(v_cash_out, 2),
      'net', round(v_cash_net, 2)
    ),
    'top_priority', jsonb_build_object(
      'source_key', v_priority_key,
      'title', v_priority_title,
      'detail', v_priority_detail,
      'path', v_priority_path,
      'priority', v_priority_level,
      'category', v_priority_category,
      'actionable', v_priority_key <> 'executive_no_urgent_action'
    )
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.admin_ad_performance(text, uuid, text, text, text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('c247d9b553d1bc71209f0d90930ef2db', 'bc9571c936e8c0a85016b510ec608592') THEN
    RAISE EXCEPTION 'Unexpected definition for security.admin_ad_performance; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.admin_ad_performance(p_merchant_code text, p_upload_id uuid DEFAULT NULL::uuid, p_platform text DEFAULT NULL::text, p_group_by text DEFAULT 'campaign'::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT security.has_platform_permission('manage_ads') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE merchant_code = p_merchant_code AND role = 'merchant') THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  IF p_group_by NOT IN ('campaign', 'sku', 'query') THEN
    RAISE EXCEPTION 'invalid advertising group' USING errcode = '22023';
  END IF;

  WITH filtered AS (
    SELECT am.* FROM public.ad_metrics am
    WHERE am.merchant_code = p_merchant_code
      AND (p_upload_id IS NULL OR am.upload_id = p_upload_id)
      AND (p_platform IS NULL OR am.platform = p_platform)
      AND (
        NULLIF(btrim(p_search), '') IS NULL
        OR coalesce(am.campaign_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.sku, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.search_query, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ), totals AS (
    SELECT count(*) rows, coalesce(sum(spend), 0) spend, coalesce(sum(revenue), 0) revenue,
      coalesce(sum(impressions), 0) impressions, coalesce(sum(clicks), 0) clicks,
      coalesce(sum(orders), 0) orders FROM filtered
  ), grouped AS (
    SELECT CASE p_group_by
        WHEN 'campaign' THEN coalesce(nullif(campaign_name, ''), nullif(ad_group_name, ''), 'بلا اسم')
        WHEN 'sku' THEN coalesce(nullif(sku, ''), '—')
        ELSE coalesce(nullif(search_query, ''), '—') END key,
      platform, sum(impressions) impressions, sum(clicks) clicks, sum(orders) orders,
      sum(spend) spend, sum(revenue) revenue, count(*) rows
    FROM filtered GROUP BY 1, platform ORDER BY sum(spend) DESC LIMIT 200
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'groups', coalesce((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(platform ORDER BY platform) FROM (SELECT DISTINCT platform FROM filtered) p), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;$reviewed_sql$;

END
$analytics_compat$;
$actual_sql$]); end $executed_20261126094647$;
select pg_temp.assert_original_history(); select pg_temp.assert_release_catalog('e562dafc5b7338a30a483c6381a529ad998bd21f8862775d9c7df7fbeb73e33b');
DO $$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>355 THEN RAISE EXCEPTION 'RECOVERY_LEDGER_COUNT_MISMATCH'; END IF; END $$;
notify pgrst,'reload schema';
commit;
