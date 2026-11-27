alter table public.product_bundle_versions add constraint product_bundle_versions_product_identity_key
  unique (merchant_code,id,product_id);
alter table public.products drop constraint products_current_bundle_tenant_fk;
alter table public.products add constraint products_current_bundle_tenant_fk
  foreign key (merchant_code,current_bundle_version_id,id)
  references public.product_bundle_versions(merchant_code,id,product_id);
alter table public.products add column variant_attributes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(variant_attributes)='object');

create function security.validate_product_bundle_kind() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.product_kind='virtual_bundle' then
    if new.current_bundle_version_id is null then raise exception 'A virtual bundle requires a saved recipe'; end if;
    if exists (select 1 from public.product_bundle_components where component_product_id=new.id) then
      raise exception 'A component cannot become a virtual bundle; nested recipes are not supported';
    end if;
  elsif new.current_bundle_version_id is not null then
    raise exception 'A physical variant cannot reference a virtual recipe';
  end if;
  return new;
end $$;
revoke all on function security.validate_product_bundle_kind() from public,anon,authenticated;
create trigger validate_product_bundle_kind before insert or update of product_kind,current_bundle_version_id on public.products
  for each row execute function security.validate_product_bundle_kind();

create function security.save_product_bundle(p_merchant_code text,p_product_id uuid,p_components jsonb,p_expected_version_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_recipe uuid; v_version integer; v_current uuid; v_count integer;
begin
  if auth.uid() is null or not security.can_access_merchant(p_merchant_code)
    or not security.has_merchant_permission(p_merchant_code,'products') or not security.mfa_access_allowed() then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  -- Serialize recipe changes within the workspace, including shared components.
  perform pg_advisory_xact_lock(hashtextextended('bundle:'||p_merchant_code,0));
  select current_bundle_version_id into v_current from public.products
    where merchant_code=p_merchant_code and id=p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_current is distinct from p_expected_version_id then raise exception 'Recipe changed; reload before saving'; end if;
  if jsonb_typeof(p_components) is distinct from 'array' or jsonb_array_length(p_components) not between 1 and 100 then
    raise exception 'Provide 1 to 100 components';
  end if;
  if exists (select 1 from jsonb_array_elements(p_components) c
    where jsonb_typeof(c->'units') is distinct from 'number' or (c->>'units') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(c->>'product_id','') !~ '^[0-9a-fA-F-]{36}$') then raise exception 'Invalid component'; end if;
  if exists (select 1 from jsonb_array_elements(p_components) c group by c->>'product_id' having count(*)>1) then
    raise exception 'Duplicate component';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_components) c
    join public.products p on p.id=(c->>'product_id')::uuid and p.merchant_code=p_merchant_code
    where p.id<>p_product_id and p.product_kind='variant';
  if v_count<>jsonb_array_length(p_components) then raise exception 'Components must be physical variants in the same workspace'; end if;
  select coalesce(max(version),0)+1 into v_version from public.product_bundle_versions
    where merchant_code=p_merchant_code and product_id=p_product_id;
  insert into public.product_bundle_versions(merchant_code,product_id,version,created_by)
    values(p_merchant_code,p_product_id,v_version,auth.uid()) returning id into v_recipe;
  insert into public.product_bundle_components(merchant_code,recipe_id,component_product_id,units)
    select p_merchant_code,v_recipe,(c->>'product_id')::uuid,(c->>'units')::integer from jsonb_array_elements(p_components) c;
  update public.products set product_kind='virtual_bundle',current_bundle_version_id=v_recipe
    where merchant_code=p_merchant_code and id=p_product_id;
  return v_recipe;
end $$;
revoke all on function security.save_product_bundle(text,uuid,jsonb,uuid) from public,anon;
grant execute on function security.save_product_bundle(text,uuid,jsonb,uuid) to authenticated;
create function public.save_product_bundle(p_merchant_code text,p_product_id uuid,p_components jsonb,p_expected_version_id uuid default null)
returns uuid language sql security invoker set search_path='' as $$
  select security.save_product_bundle(p_merchant_code,p_product_id,p_components,p_expected_version_id)
$$;
revoke all on function public.save_product_bundle(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.save_product_bundle(text,uuid,jsonb,uuid) to authenticated;

-- Record the recipe used on new line facts. Existing sales are not rewritten.
alter table public.order_items add column bundle_version_id uuid;
alter table public.order_items add constraint order_items_bundle_tenant_fk foreign key (merchant_code,bundle_version_id)
  references public.product_bundle_versions(merchant_code,id);
create index order_items_bundle_version_idx on public.order_items(merchant_code,bundle_version_id) where bundle_version_id is not null;

grant select (variant_attributes) on public.products to authenticated;
grant select (bundle_version_id) on public.order_items to authenticated;
