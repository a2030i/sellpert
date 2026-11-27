-- Additive identity foundation. Existing facts are deliberately NOT assigned to
-- the first connection: their historical seller identity needs source evidence.
-- Account-aware uniqueness and writers are introduced by the following migration.
create table public.marketplace_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code),
  platform text not null check (platform in ('amazon','salla','trendyol','noon','zid','shopify','other')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  external_seller_id text,
  status text not null default 'pending' check (status in ('pending','active','disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_code, platform, id),
  unique (merchant_code, id)
);
create unique index marketplace_accounts_verified_seller_key
  on public.marketplace_accounts(platform, external_seller_id)
  where external_seller_id is not null and status = 'active';
create index marketplace_accounts_tenant_idx on public.marketplace_accounts(merchant_code, platform, status);

insert into public.marketplace_accounts(id,merchant_code,platform,label,external_seller_id,status)
select id,merchant_code,platform,platform || ' — ' || coalesce(nullif(seller_id,''),'حساب موجود'),nullif(seller_id,''),
  case when is_active then 'active' else 'disconnected' end
from public.platform_credentials where platform in ('amazon','salla','trendyol','noon','zid','shopify','other');
insert into public.marketplace_accounts(id,merchant_code,platform,label,external_seller_id,status)
select id,merchant_code,'salla',coalesce(nullif(store_name,''),'متجر سلة'),salla_store_id::text,
  case when sync_status = 'disconnected' then 'disconnected' else 'active' end
from public.salla_connections;

alter table public.platform_credentials add column marketplace_account_id uuid;
update public.platform_credentials set marketplace_account_id=id
where exists (select 1 from public.marketplace_accounts a where a.id=platform_credentials.id);
alter table public.platform_credentials add constraint platform_credentials_account_tenant_fk
  foreign key (merchant_code,platform,marketplace_account_id)
  references public.marketplace_accounts(merchant_code,platform,id);
alter table public.salla_connections add column marketplace_account_id uuid;
update public.salla_connections set marketplace_account_id=id;
alter table public.salla_connections add constraint salla_connections_account_tenant_fk
  foreign key (merchant_code,marketplace_account_id) references public.marketplace_accounts(merchant_code,id);
alter table public.amazon_oauth_states add column marketplace_account_id uuid;
alter table public.amazon_oauth_states add constraint amazon_oauth_account_tenant_fk
  foreign key (merchant_code,marketplace_account_id) references public.marketplace_accounts(merchant_code,id);

do $account_columns$
declare t text;
begin
  foreach t in array array['orders','order_items','order_packages','returns','account_transactions',
    'inventory','platform_file_uploads','sync_queue','sync_logs','product_channel_mappings',
    'product_platform_prices','product_platform_listings','ad_metrics','performance_data',
    'product_performance_snapshots','amazon_daily_sales','marketplace_action_logs','inbound_shipments','inbound_shipment_items','goods_received','platform_deals','trendyol_customer_questions','trendyol_question_reply_attempts'] loop
    if to_regclass('public.' || t) is null then raise exception 'Missing prerequisite table %',t; end if;
    execute format('alter table public.%I add column marketplace_account_id uuid',t);
    execute format('alter table public.%I add constraint %I foreign key (merchant_code,marketplace_account_id) references public.marketplace_accounts(merchant_code,id)',t,t || '_account_tenant_fk');
    execute format('create index %I on public.%I(merchant_code,marketplace_account_id)',t || '_account_idx',t);
    execute format('grant select (marketplace_account_id) on public.%I to authenticated',t);
  end loop;
end
$account_columns$;

create table public.product_families (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (merchant_code,id)
);
alter table public.products add column family_id uuid;
alter table public.products add column product_kind text not null default 'variant'
  check (product_kind in ('variant','virtual_bundle'));
alter table public.products add constraint products_family_tenant_fk
  foreign key (merchant_code,family_id) references public.product_families(merchant_code,id);
create index products_family_idx on public.products(merchant_code,family_id);

-- Immutable recipe versions: changing a bundle never reprices historical sales.
create table public.product_bundle_versions (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null,
  product_id uuid not null,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  foreign key (merchant_code,product_id) references public.products(merchant_code,id),
  unique (merchant_code,id), unique (merchant_code,product_id,version)
);
create table public.product_bundle_components (
  merchant_code text not null,
  recipe_id uuid not null,
  component_product_id uuid not null,
  units integer not null check (units > 0),
  primary key (recipe_id,component_product_id),
  foreign key (merchant_code,recipe_id) references public.product_bundle_versions(merchant_code,id),
  foreign key (merchant_code,component_product_id) references public.products(merchant_code,id)
);
create index product_bundle_components_tenant_idx on public.product_bundle_components(merchant_code,component_product_id);
alter table public.products add column current_bundle_version_id uuid;
alter table public.products add constraint products_current_bundle_tenant_fk
  foreign key (merchant_code,current_bundle_version_id) references public.product_bundle_versions(merchant_code,id);

-- A pool identifies physical stock; listings are observations, not extra stock.
create table public.inventory_pools (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  location_type text not null check (location_type in ('warehouse','provider','other')),
  created_at timestamptz not null default now(),
  unique (merchant_code,id)
);
create table public.inventory_pool_links (
  merchant_code text not null,
  inventory_id uuid primary key,
  pool_id uuid not null,
  product_id uuid not null,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid not null default auth.uid() references auth.users(id),
  foreign key (merchant_code,pool_id) references public.inventory_pools(merchant_code,id),
  foreign key (merchant_code,product_id) references public.products(merchant_code,id)
);
create unique index inventory_merchant_id_key on public.inventory(merchant_code,id);
alter table public.inventory_pool_links add constraint inventory_pool_links_inventory_tenant_fk
  foreign key (merchant_code,inventory_id) references public.inventory(merchant_code,id);
create index inventory_pool_links_pool_idx on public.inventory_pool_links(merchant_code,pool_id,product_id);

do $policies$
declare t text; permission text;
begin
  foreach t in array array['marketplace_accounts','product_families','product_bundle_versions','product_bundle_components','inventory_pools','inventory_pool_links'] loop
    permission := case when t='marketplace_accounts' then 'integrations' when t like 'inventory_%' then 'inventory' else 'products' end;
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('create policy tenant_boundary on public.%I as restrictive for all to authenticated using ((select security.can_access_merchant(merchant_code))) with check ((select security.can_access_merchant(merchant_code)))',t);
    execute format('create policy sellpert_require_mfa_if_enrolled on public.%I as restrictive for all to authenticated using ((select security.mfa_access_allowed())) with check ((select security.mfa_access_allowed()))',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using ((select security.can_access_merchant(merchant_code)) and (select security.mfa_access_allowed()))',t);
    -- Only metadata and manual physical-pool links can be directly edited.
    -- Verified account identities and immutable recipes use actor-checked RPCs.
    if t in ('product_families','inventory_pools','inventory_pool_links') then
      execute format('grant insert,update on public.%I to authenticated',t);
      execute format('create policy tenant_insert on public.%I for insert to authenticated with check ((select security.can_access_merchant(merchant_code)) and (select security.has_merchant_permission(merchant_code,%L)) and (select security.mfa_access_allowed()))',t,permission);
      execute format('create policy tenant_update on public.%I for update to authenticated using ((select security.can_access_merchant(merchant_code)) and (select security.has_merchant_permission(merchant_code,%L)) and (select security.mfa_access_allowed())) with check ((select security.can_access_merchant(merchant_code)) and (select security.has_merchant_permission(merchant_code,%L)) and (select security.mfa_access_allowed()))',t,permission,permission);
    end if;
    execute format('create trigger security_audit_mutation after insert or update or delete on public.%I for each row execute function security.write_audit_log()',t);
  end loop;
end
$policies$;

grant select (family_id,product_kind,current_bundle_version_id) on public.products to authenticated;
