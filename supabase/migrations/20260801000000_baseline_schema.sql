-- Baseline captured from the production schema so a new environment can be
-- rebuilt before applying the dated hardening and feature migrations.
create schema if not exists security;

create sequence public.mfa_recovery_attempts_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
create sequence public.sync_queue_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
create sequence public.webhook_events_id_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

create table public.account_closure_requests (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  requested_by uuid not null,
  status text default 'pending'::text not null,
  reason text,
  requested_at timestamp with time zone default now() not null,
  scheduled_for timestamp with time zone default (now() + '30 days'::interval) not null,
  cancelled_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public."account_closure_requests" enable row level security;

create table public.account_transactions (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  transaction_no text,
  transaction_date timestamp with time zone,
  posted_date timestamp with time zone,
  transaction_type text,
  order_id text,
  description text,
  product_name text,
  product_sku text,
  product_barcode text,
  amount_type text,
  amount_description text,
  debit numeric default 0,
  credit numeric default 0,
  net_amount numeric,
  currency text default 'SAR'::text,
  marketplace text,
  settlement_id text,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  promotion_id text,
  quantity_purchased integer,
  shipment_id text,
  settlement_period_start date,
  settlement_period_end date,
  deposit_date date,
  upload_id uuid
);
alter table public."account_transactions" enable row level security;

create table public.ad_metrics (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  report_date date not null,
  campaign_name text default ''::text,
  ad_group_name text default ''::text,
  ad_status text,
  sku text default ''::text,
  asin text,
  search_query text default ''::text,
  impressions integer default 0,
  clicks integer default 0,
  orders integer default 0,
  add_to_cart integer default 0,
  spend numeric default 0,
  revenue numeric default 0,
  ctr numeric,
  roas numeric,
  cpc numeric,
  cps numeric,
  cvr numeric,
  acos numeric,
  budget_total numeric,
  budget_daily numeric,
  budget_remaining numeric,
  start_date date,
  end_date date,
  currency text default 'SAR'::text,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  default_bid numeric,
  suggested_bid_low numeric,
  suggested_bid_med numeric,
  suggested_bid_high numeric,
  keywords_count integer,
  products_count integer,
  upload_id uuid
);
alter table public."ad_metrics" enable row level security;

create table public.ai_insights (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  insight_type text default 'full'::text not null,
  content jsonb not null,
  model_used text,
  created_at timestamp with time zone default now() not null
);
alter table public."ai_insights" enable row level security;

create table public.amazon_daily_sales (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  data_date date not null,
  total_sales numeric default 0,
  units integer default 0,
  upload_id uuid,
  created_at timestamp with time zone default now()
);
alter table public."amazon_daily_sales" enable row level security;

create table public.app_settings (
  key text not null,
  value text,
  is_secret boolean default false,
  description text,
  updated_at timestamp with time zone default now(),
  updated_by text
);
alter table public."app_settings" enable row level security;

create table public.audit_log (
  id uuid default gen_random_uuid() not null,
  merchant_code text,
  action text not null,
  table_name text,
  record_id text,
  old_values jsonb,
  new_values jsonb,
  performed_by text,
  performed_at timestamp with time zone default now()
);
alter table public."audit_log" enable row level security;

create table public.budget_alerts (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text,
  monthly_limit numeric not null,
  alert_at_pct integer default 80,
  is_active boolean default true,
  last_alerted_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table public."budget_alerts" enable row level security;

create table public.entry_sessions (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  data_date date not null,
  entered_by text not null,
  record_count integer default 0,
  total_sales numeric default 0,
  platform_fees numeric default 0,
  ad_spend numeric default 0,
  created_at timestamp with time zone default now()
);
alter table public."entry_sessions" enable row level security;

create table public.goods_received (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  asn_number text,
  warehouse_code text,
  grn_date date,
  sku text default ''::text,
  partner_sku text,
  barcode text,
  grn_quantity integer default 0,
  qc_status text default 'passed'::text,
  reject_reason text default ''::text,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  upload_id uuid
);
alter table public."goods_received" enable row level security;

create table public.import_diagnostics (
  id uuid default gen_random_uuid() not null,
  merchant_code text,
  file_name text,
  detected_kind text,
  reason text,
  diagnostic text,
  created_at timestamp with time zone default now()
);
alter table public."import_diagnostics" enable row level security;

create table public.inbound_shipment_items (
  id uuid default gen_random_uuid() not null,
  shipment_id uuid not null,
  merchant_code text not null,
  platform text not null,
  sku text,
  partner_sku text,
  barcode text,
  qty integer default 0,
  cubic_feet numeric,
  storage_type text,
  brand_code text,
  category_code text,
  created_at timestamp with time zone default now(),
  upload_id uuid
);
alter table public."inbound_shipment_items" enable row level security;

create table public.inbound_shipments (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  asn_number text not null,
  warehouse_code text,
  expected_qty integer default 0,
  delivered_qty integer default 0,
  variance integer default 0,
  status text default 'pending'::text,
  delivery_date date,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  upload_id uuid
);
alter table public."inbound_shipments" enable row level security;

create table public.inventory (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  sku text not null,
  product_name text,
  platform text not null,
  quantity integer default 0 not null,
  reserved_quantity integer default 0 not null,
  low_stock_threshold integer default 10 not null,
  cost_price numeric(12,2) default 0,
  image_url text,
  is_active boolean default true not null,
  last_updated timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  asin text,
  fulfillment_channel text,
  condition_type text,
  stock_xdock_gross integer default 0,
  stock_xdock_net integer default 0,
  partner_sku text,
  upload_id uuid,
  raw jsonb
);
alter table public."inventory" enable row level security;

create table public.invoices (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  subscription_id uuid,
  invoice_number text,
  type text default 'subscription'::text not null,
  amount numeric(10,2) not null,
  tax_amount numeric(10,2) default 0 not null,
  total_amount numeric(10,2) not null,
  status text default 'pending'::text not null,
  due_date date,
  paid_at timestamp with time zone,
  payment_ref text,
  period_start date,
  period_end date,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table public."invoices" enable row level security;

create table public.marketplace_action_logs (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  action text not null,
  risk_level text not null,
  idempotency_key text,
  status text not null,
  request jsonb default '{}'::jsonb not null,
  response jsonb,
  external_batch_id text,
  error_message text,
  created_by uuid,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone
);
alter table public."marketplace_action_logs" enable row level security;

create table public.marketplace_oauth_states (
  state text not null,
  user_id uuid not null,
  merchant_code text not null,
  platform text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);
alter table public."marketplace_oauth_states" enable row level security;

create table public.merchant_account_links (
  id uuid default gen_random_uuid() not null,
  email text not null,
  merchant_code text not null,
  is_default boolean default false,
  created_at timestamp with time zone default now(),
  user_id uuid
);
alter table public."merchant_account_links" enable row level security;

create table public.merchant_notes (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  body text not null,
  type text default 'note'::text,
  pinned boolean default false,
  author_email text,
  author_name text,
  created_at timestamp with time zone default now()
);
alter table public."merchant_notes" enable row level security;

create table public.merchant_payout_schedule (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  payout_date date not null,
  amount numeric not null,
  status text default 'expected'::text not null,
  note text,
  created_by text,
  created_at timestamp with time zone default now()
);
alter table public."merchant_payout_schedule" enable row level security;

create table public.merchant_platform_mappings (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  connection_id uuid not null,
  platform text not null,
  seller_id text not null,
  is_active boolean default true not null,
  last_sync_at timestamp with time zone,
  last_sync_status text,
  last_sync_error text,
  records_synced integer default 0,
  created_at timestamp with time zone default now() not null
);
alter table public."merchant_platform_mappings" enable row level security;

create table public.merchant_requests (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  type text not null,
  product_id uuid,
  details jsonb default '{}'::jsonb not null,
  status text default 'pending'::text not null,
  note text,
  admin_note text,
  created_at timestamp with time zone default now(),
  resolved_at timestamp with time zone,
  resolved_by text,
  title text,
  category text,
  platform text,
  priority text default 'medium'::text,
  assigned_to text,
  created_by text,
  created_by_role text,
  due_date date,
  tags text[],
  updated_at timestamp with time zone default now(),
  request_kind text default 'support'::text not null,
  source_key text,
  expected_impact text,
  completion_result text,
  completion_note text,
  completion_recorded_at timestamp with time zone
);
alter table public."merchant_requests" enable row level security;

create table public.merchant_weekly_briefs (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  week_start date not null,
  week_end date not null,
  source_data_as_of date not null,
  brief jsonb not null,
  actual_sales numeric(16,2) default 0 not null,
  monthly_target numeric(16,2),
  target_attainment_pct numeric(8,2),
  target_pace_pct numeric(8,2),
  target_status text default 'not_set'::text not null,
  captured_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public."merchant_weekly_briefs" enable row level security;

create table public.merchants (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  name text not null,
  email text not null,
  currency text default 'SAR'::text,
  logo_url text,
  role text default 'merchant'::text,
  subscription_plan text default 'free'::text,
  created_at timestamp with time zone default now(),
  whatsapp_phone text,
  sellpert_commission_rate numeric default 5,
  subscription_status text default 'active'::text not null,
  salla_store_id text,
  onboarding_done boolean default false not null,
  signup_source text default 'manual'::text not null,
  fixed_fee_per_order numeric(10,2) default 0,
  subscription_monthly_amount numeric(10,2) default 0,
  sector text,
  sub_sector text,
  owner_merchant_code text,
  permissions jsonb default '{}'::jsonb,
  is_active boolean default true,
  job_title text,
  department text
);
alter table public."merchants" enable row level security;

create table public.mfa_recovery_attempts (
  id bigint generated always as identity not null,
  user_id uuid not null,
  attempted_at timestamp with time zone default now() not null
);
alter table public."mfa_recovery_attempts" enable row level security;

create table public.mfa_recovery_codes (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  batch_id uuid not null,
  code_hash text not null,
  created_at timestamp with time zone default now() not null,
  used_at timestamp with time zone
);
alter table public."mfa_recovery_codes" enable row level security;

create table public.notifications (
  id uuid default gen_random_uuid() not null,
  merchant_code text,
  type text default 'info'::text not null,
  title text not null,
  body text,
  is_read boolean default false,
  action_path text,
  created_at timestamp with time zone default now()
);
alter table public."notifications" enable row level security;

create table public.nps_responses (
  id uuid default gen_random_uuid() not null,
  merchant_code text,
  score integer,
  feedback text,
  category text,
  responded_at timestamp with time zone default now()
);
alter table public."nps_responses" enable row level security;

create table public.order_items (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  order_id text not null,
  line_id text not null,
  content_id text,
  barcode text,
  sku text,
  product_name text,
  quantity integer default 1 not null,
  unit_price numeric default 0 not null,
  line_total numeric default 0 not null,
  discount_amount numeric default 0 not null,
  commission_amount numeric default 0 not null,
  commission_rate numeric,
  vat_rate numeric,
  image_url text,
  images jsonb,
  product_url text,
  raw jsonb,
  catalog_raw jsonb,
  last_synced_at timestamp with time zone default now() not null,
  product_name_ar text,
  translation_source text,
  shipment_package_id text
);
alter table public."order_items" enable row level security;

create table public.order_packages (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  order_id text not null,
  shipment_package_id text not null,
  status text default 'pending'::text not null,
  cargo_tracking_number text,
  cargo_tracking_link text,
  cargo_sender_number text,
  cargo_provider text,
  delivery_type text,
  delivery_address_type text,
  invoice_number text,
  invoice_status text,
  invoice_rejected_reasons jsonb,
  line_count integer default 0 not null,
  quantity integer default 0 not null,
  total_amount numeric default 0 not null,
  currency text default 'SAR'::text not null,
  modified_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  last_synced_at timestamp with time zone default now() not null,
  raw jsonb
);
alter table public."order_packages" enable row level security;

create table public.orders (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  order_id text not null,
  status text default 'pending'::text not null,
  product_name text,
  sku text,
  quantity integer default 1 not null,
  unit_price numeric(12,2) default 0 not null,
  total_amount numeric(12,2) default 0 not null,
  platform_fee numeric(12,2) default 0,
  shipping_cost numeric(12,2) default 0,
  currency text default 'SAR'::text not null,
  customer_city text,
  order_date timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  noon_sku text,
  partner_sku text,
  fulfillment_model text,
  shipment_date timestamp with time zone,
  delivered_date timestamp with time zone,
  brand text,
  family text,
  gross_amount numeric default 0,
  discount_amount numeric default 0,
  upload_id uuid,
  shipment_package_id text,
  cargo_tracking_number text,
  cargo_provider text,
  shipment_address jsonb,
  invoice_address jsonb,
  commission_rate numeric,
  vat_rate numeric,
  raw jsonb,
  last_synced_at timestamp with time zone
);
alter table public."orders" enable row level security;

create table public.payment_requests (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  type text default 'new_subscription'::text not null,
  plan text not null,
  period_months smallint default 1 not null,
  amount numeric(10,2) not null,
  vat_amount numeric(10,2) generated always as (round((amount * 0.15), 2)) stored,
  total_amount numeric(10,2) generated always as (round((amount * 1.15), 2)) stored,
  currency text default 'SAR'::text not null,
  bank_reference text,
  transfer_date date,
  notes text,
  status text default 'pending'::text not null,
  admin_note text,
  confirmed_by text,
  confirmed_at timestamp with time zone,
  rejected_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table public."payment_requests" enable row level security;

create table public.performance_data (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  created_at timestamp with time zone default now(),
  platform text default 'other'::text,
  total_sales numeric default 0,
  order_count integer default 0,
  margin numeric default 0,
  ad_spend numeric default 0,
  platform_fees numeric default 0,
  product_name text,
  data_date date,
  product_id uuid,
  entry_by text,
  notes text,
  is_edited boolean default false,
  edited_at timestamp with time zone,
  edited_by text
);
alter table public."performance_data" enable row level security;

create table public.platform_commission_rates (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  category text default 'default'::text not null,
  rate numeric default 0 not null,
  vat_rate numeric default 15 not null,
  shipping_fee numeric default 0 not null,
  other_fees numeric default 0 not null,
  notes text,
  updated_at timestamp with time zone default now()
);
alter table public."platform_commission_rates" enable row level security;

create table public.platform_connections (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  label text not null,
  api_key text,
  api_secret text,
  extra jsonb default '{}'::jsonb,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public."platform_connections" enable row level security;

create table public.platform_credentials (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  seller_id text,
  api_key text,
  api_secret text,
  extra jsonb default '{}'::jsonb,
  is_active boolean default false,
  last_sync_at timestamp with time zone,
  records_synced integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  test_status text,
  last_tested_at timestamp with time zone
);
alter table public."platform_credentials" enable row level security;

create table public.platform_deals (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  product_name text,
  model_code text,
  barcode text default ''::text,
  category text,
  brand text,
  current_stock integer,
  current_price numeric,
  super_deal_upper_price numeric,
  mega_deal_upper_price numeric,
  super_deal_commission numeric,
  mega_deal_commission numeric,
  current_commission numeric,
  applied_commission numeric,
  end_date timestamp with time zone,
  content_id text default ''::text,
  external_id text,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  upload_id uuid
);
alter table public."platform_deals" enable row level security;

create table public.platform_fee_categories (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  category_key text not null,
  category_ar text not null,
  category_en text not null,
  commission_rate numeric default 0 not null,
  commission_fbn_fba numeric,
  min_fee_sar numeric default 1,
  notes text,
  updated_at timestamp with time zone default now()
);
alter table public."platform_fee_categories" enable row level security;

create table public.platform_file_uploads (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  file_name text,
  file_type text,
  file_size integer,
  uploaded_by text,
  rows_processed integer default 0,
  rows_inserted integer default 0,
  rows_updated integer default 0,
  status text default 'processing'::text,
  error_message text,
  detected_report text,
  uploaded_at timestamp with time zone default now(),
  finished_at timestamp with time zone,
  fingerprint text
);
alter table public."platform_file_uploads" enable row level security;

create table public.platform_fulfillment_models (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  model_key text not null,
  model_label text not null,
  is_default boolean default false,
  notes text
);
alter table public."platform_fulfillment_models" enable row level security;

create table public.platform_other_fees (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  fee_type text not null,
  fee_label_ar text not null,
  fee_label_en text,
  amount numeric default 0 not null,
  unit text default 'SAR/CBF/month'::text not null,
  notes text,
  updated_at timestamp with time zone default now()
);
alter table public."platform_other_fees" enable row level security;

create table public.platform_shipping_tiers (
  id uuid default gen_random_uuid() not null,
  platform text not null,
  model_key text not null,
  size_tier text not null,
  size_label_ar text not null,
  weight_min_kg numeric default 0 not null,
  weight_max_kg numeric,
  asp_threshold numeric default 25,
  fee_below_asp numeric default 0 not null,
  fee_above_asp numeric default 0 not null,
  extra_per_kg numeric default 0,
  sort_order integer default 0
);
alter table public."platform_shipping_tiers" enable row level security;

create table public.price_change_log (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  merchant_code text not null,
  platform text,
  old_price numeric,
  new_price numeric,
  changed_by text,
  reason text,
  created_at timestamp with time zone default now()
);
alter table public."price_change_log" enable row level security;

create table public.product_performance_snapshots (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  snapshot_date date not null,
  sku text,
  barcode text,
  product_name text,
  brand text,
  category text,
  color text,
  size text,
  total_orders integer default 0,
  sold integer default 0,
  cancelled integer default 0,
  cancel_rate numeric,
  returned integer default 0,
  return_rate numeric,
  net_sold integer default 0,
  gross_sales numeric default 0,
  discount numeric default 0,
  net_revenue numeric default 0,
  avg_price numeric,
  current_price numeric,
  current_stock integer,
  cancel_reasons jsonb default '{}'::jsonb,
  return_reasons jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  upload_id uuid,
  asin text,
  parent_asin text,
  seller_sku text,
  sessions integer,
  session_percentage numeric,
  page_views integer,
  page_views_percentage numeric,
  buy_box_percentage numeric,
  unit_session_percentage numeric
);
alter table public."product_performance_snapshots" enable row level security;

create table public.product_platform_listings (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  product_id uuid not null,
  platform text not null,
  title text,
  description text,
  bullet_points jsonb default '[]'::jsonb,
  keywords jsonb default '[]'::jsonb,
  images jsonb default '[]'::jsonb,
  notes text,
  updated_at timestamp with time zone default now(),
  delivery_status text default 'draft'::text not null,
  external_batch_id text,
  last_submitted_at timestamp with time zone,
  last_verified_at timestamp with time zone,
  delivery_error text
);
alter table public."product_platform_listings" enable row level security;

create table public.product_platform_prices (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  merchant_code text not null,
  platform text not null,
  selling_price numeric default 0 not null,
  commission_rate numeric default 0 not null,
  is_active boolean default true not null,
  override_price numeric,
  notes text,
  updated_at timestamp with time zone default now(),
  updated_by text
);
alter table public."product_platform_prices" enable row level security;

create table public.products (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  name text not null,
  sku text,
  barcode text,
  category text,
  description text,
  image_url text,
  cost_price numeric default 0 not null,
  target_net_price numeric default 0 not null,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  psku_code text,
  noon_sku_child text,
  asin text,
  external_id text,
  model_code text,
  brand text,
  msrp numeric,
  sale_price numeric,
  sale_start_date date,
  sale_end_date date,
  external_url text,
  color text,
  size text,
  images jsonb default '[]'::jsonb,
  noon_price_min numeric,
  noon_price_max numeric,
  seller_price_min numeric,
  seller_price_max numeric,
  warranty text,
  commission_rate numeric,
  buybox_price numeric,
  vat_rate numeric,
  gender text,
  supplier_sku text,
  upload_id uuid,
  platform_source text,
  raw jsonb,
  last_synced_at timestamp with time zone
);
alter table public."products" enable row level security;

create table public.returns (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  order_id text,
  product_name text,
  sku text,
  quantity integer default 1,
  return_amount numeric default 0,
  reason text,
  return_date date,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  upload_id uuid,
  claim_id text,
  claim_line_id text,
  raw jsonb,
  last_synced_at timestamp with time zone,
  provider_claim_item_id text
);
alter table public."returns" enable row level security;

create table public.sales_targets (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  year integer not null,
  month integer not null,
  platform text default 'all'::text not null,
  target_amount numeric default 0 not null,
  updated_at timestamp with time zone default now()
);
alter table public."sales_targets" enable row level security;

create table public.salla_connections (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  salla_store_id text not null,
  salla_merchant_id text,
  store_name text,
  store_domain text,
  store_currency text default 'SAR'::text,
  store_country text default 'SA'::text,
  store_logo text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamp with time zone,
  scope text,
  installed_at timestamp with time zone default now(),
  uninstalled_at timestamp with time zone,
  last_sync_at timestamp with time zone,
  sync_status text default 'idle'::text not null,
  orders_synced integer default 0,
  products_synced integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table public."salla_connections" enable row level security;

create table public.subscriptions (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  plan text default 'salla'::text not null,
  status text default 'active'::text not null,
  billing_source text default 'salla'::text not null,
  salla_subscription_id text,
  salla_store_id text,
  amount numeric(10,2) default 99,
  currency text default 'SAR'::text,
  trial_ends_at timestamp with time zone,
  current_period_start timestamp with time zone default now(),
  current_period_end timestamp with time zone default (now() + '1 mon'::interval),
  cancelled_at timestamp with time zone,
  cancel_reason text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  payment_method text default 'salla'::text,
  billing_cycle text default 'monthly'::text,
  grace_period_end timestamp with time zone,
  next_billing_date timestamp with time zone,
  payment_request_id uuid
);
alter table public."subscriptions" enable row level security;

create table public.sync_logs (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  status text default 'running'::text,
  records_synced integer default 0,
  error_message text,
  started_at timestamp with time zone default now(),
  finished_at timestamp with time zone,
  details jsonb
);
alter table public."sync_logs" enable row level security;

create table public.sync_queue (
  id bigint default nextval('sync_queue_id_seq'::regclass) not null,
  merchant_code text not null,
  platform text not null,
  job_type text not null,
  payload jsonb default '{}'::jsonb not null,
  status text default 'pending'::text not null,
  priority smallint default 3 not null,
  attempts smallint default 0 not null,
  max_attempts smallint default 3 not null,
  error_message text,
  error_detail jsonb,
  scheduled_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  health_alerted_at timestamp with time zone
);
alter table public."sync_queue" enable row level security;

create table public.sync_requests (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  platform text not null,
  note text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  resolved_at timestamp with time zone
);
alter table public."sync_requests" enable row level security;

create table public.task_comments (
  id uuid default gen_random_uuid() not null,
  task_id uuid not null,
  author_code text not null,
  author_role text,
  body text not null,
  is_internal boolean default false,
  created_at timestamp with time zone default now()
);
alter table public."task_comments" enable row level security;

create table public.webhook_events (
  id bigint default nextval('webhook_events_id_seq'::regclass) not null,
  source text not null,
  event_type text not null,
  store_id text,
  merchant_code text,
  payload jsonb,
  status text default 'received'::text not null,
  error text,
  received_at timestamp with time zone default now(),
  processed_at timestamp with time zone,
  event_key text
);
alter table public."webhook_events" enable row level security;

create table security.client_incidents (
  id uuid default gen_random_uuid() not null,
  merchant_code text not null,
  user_id uuid not null,
  fingerprint text not null,
  category text not null,
  severity text not null,
  page_path text not null,
  component text not null,
  action text,
  error_code text not null,
  http_status smallint,
  release text default 'web'::text not null,
  status text default 'open'::text not null,
  occurrence_count integer default 1 not null,
  first_seen_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  resolved_by uuid
);
alter table security."client_incidents" enable row level security;

alter table public.account_closure_requests add constraint account_closure_requests_pkey PRIMARY KEY (id);
alter table public.account_transactions add constraint account_transactions_pkey PRIMARY KEY (id);
alter table public.ad_metrics add constraint ad_metrics_pkey PRIMARY KEY (id);
alter table public.ai_insights add constraint ai_insights_pkey PRIMARY KEY (id);
alter table public.amazon_daily_sales add constraint amazon_daily_sales_pkey PRIMARY KEY (id);
alter table public.app_settings add constraint app_settings_pkey PRIMARY KEY (key);
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.budget_alerts add constraint budget_alerts_pkey PRIMARY KEY (id);
alter table public.entry_sessions add constraint entry_sessions_pkey PRIMARY KEY (id);
alter table public.goods_received add constraint goods_received_pkey PRIMARY KEY (id);
alter table public.import_diagnostics add constraint import_diagnostics_pkey PRIMARY KEY (id);
alter table public.inbound_shipment_items add constraint inbound_shipment_items_pkey PRIMARY KEY (id);
alter table public.inbound_shipments add constraint inbound_shipments_pkey PRIMARY KEY (id);
alter table public.inventory add constraint inventory_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.marketplace_action_logs add constraint marketplace_action_logs_pkey PRIMARY KEY (id);
alter table public.marketplace_oauth_states add constraint marketplace_oauth_states_pkey PRIMARY KEY (state);
alter table public.merchant_account_links add constraint merchant_account_links_pkey PRIMARY KEY (id);
alter table public.merchant_notes add constraint merchant_notes_pkey PRIMARY KEY (id);
alter table public.merchant_payout_schedule add constraint merchant_payout_schedule_pkey PRIMARY KEY (id);
alter table public.merchant_platform_mappings add constraint merchant_platform_mappings_pkey PRIMARY KEY (id);
alter table public.merchant_requests add constraint merchant_requests_pkey PRIMARY KEY (id);
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_pkey PRIMARY KEY (id);
alter table public.merchants add constraint merchants_pkey PRIMARY KEY (id);
alter table public.mfa_recovery_attempts add constraint mfa_recovery_attempts_pkey PRIMARY KEY (id);
alter table public.mfa_recovery_codes add constraint mfa_recovery_codes_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.nps_responses add constraint nps_responses_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_packages add constraint order_packages_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.payment_requests add constraint payment_requests_pkey PRIMARY KEY (id);
alter table public.performance_data add constraint performance_data_pkey PRIMARY KEY (id);
alter table public.platform_commission_rates add constraint platform_commission_rates_pkey PRIMARY KEY (id);
alter table public.platform_connections add constraint platform_connections_pkey PRIMARY KEY (id);
alter table public.platform_credentials add constraint platform_credentials_pkey PRIMARY KEY (id);
alter table public.platform_deals add constraint platform_deals_pkey PRIMARY KEY (id);
alter table public.platform_fee_categories add constraint platform_fee_categories_pkey PRIMARY KEY (id);
alter table public.platform_file_uploads add constraint platform_file_uploads_pkey PRIMARY KEY (id);
alter table public.platform_fulfillment_models add constraint platform_fulfillment_models_pkey PRIMARY KEY (id);
alter table public.platform_other_fees add constraint platform_other_fees_pkey PRIMARY KEY (id);
alter table public.platform_shipping_tiers add constraint platform_shipping_tiers_pkey PRIMARY KEY (id);
alter table public.price_change_log add constraint price_change_log_pkey PRIMARY KEY (id);
alter table public.product_performance_snapshots add constraint product_performance_snapshots_pkey PRIMARY KEY (id);
alter table public.product_platform_listings add constraint product_platform_listings_pkey PRIMARY KEY (id);
alter table public.product_platform_prices add constraint product_platform_prices_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.returns add constraint returns_pkey PRIMARY KEY (id);
alter table public.sales_targets add constraint sales_targets_pkey PRIMARY KEY (id);
alter table public.salla_connections add constraint salla_connections_pkey PRIMARY KEY (id);
alter table public.subscriptions add constraint subscriptions_pkey PRIMARY KEY (id);
alter table public.sync_logs add constraint sync_logs_pkey PRIMARY KEY (id);
alter table public.sync_queue add constraint sync_queue_pkey PRIMARY KEY (id);
alter table public.sync_requests add constraint sync_requests_pkey PRIMARY KEY (id);
alter table public.task_comments add constraint task_comments_pkey PRIMARY KEY (id);
alter table public.webhook_events add constraint webhook_events_pkey PRIMARY KEY (id);
alter table security.client_incidents add constraint client_incidents_pkey PRIMARY KEY (id);
alter table public.budget_alerts add constraint budget_alerts_merchant_code_platform_key UNIQUE (merchant_code, platform);
alter table public.entry_sessions add constraint entry_sessions_merchant_code_platform_data_date_key UNIQUE (merchant_code, platform, data_date);
alter table public.inbound_shipments add constraint inbound_shipments_merchant_code_platform_asn_number_key UNIQUE (merchant_code, platform, asn_number);
alter table public.inventory add constraint inventory_merchant_code_sku_platform_key UNIQUE (merchant_code, sku, platform);
alter table public.invoices add constraint invoices_invoice_number_key UNIQUE (invoice_number);
alter table public.merchant_account_links add constraint merchant_account_links_email_merchant_code_key UNIQUE (email, merchant_code);
alter table public.merchant_platform_mappings add constraint merchant_platform_mappings_merchant_code_platform_key UNIQUE (merchant_code, platform);
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_merchant_code_week_start_key UNIQUE (merchant_code, week_start);
alter table public.merchants add constraint merchants_email_key UNIQUE (email);
alter table public.merchants add constraint merchants_merchant_code_key UNIQUE (merchant_code);
alter table public.mfa_recovery_codes add constraint mfa_recovery_codes_user_id_code_hash_key UNIQUE (user_id, code_hash);
alter table public.order_items add constraint order_items_merchant_code_platform_order_id_line_id_key UNIQUE (merchant_code, platform, order_id, line_id);
alter table public.order_packages add constraint order_packages_tenant_unique UNIQUE (merchant_code, platform, shipment_package_id);
alter table public.orders add constraint orders_merchant_code_platform_order_id_key UNIQUE (merchant_code, platform, order_id);
alter table public.platform_commission_rates add constraint platform_commission_rates_platform_category_key UNIQUE (platform, category);
alter table public.platform_credentials add constraint platform_credentials_merchant_code_platform_key UNIQUE (merchant_code, platform);
alter table public.platform_fee_categories add constraint platform_fee_categories_platform_category_key_key UNIQUE (platform, category_key);
alter table public.platform_fulfillment_models add constraint platform_fulfillment_models_platform_model_key_key UNIQUE (platform, model_key);
alter table public.product_platform_listings add constraint product_platform_listings_product_id_platform_key UNIQUE (product_id, platform);
alter table public.product_platform_prices add constraint product_platform_prices_product_id_platform_key UNIQUE (product_id, platform);
alter table public.products add constraint products_merchant_sku_unique UNIQUE (merchant_code, sku);
alter table public.sales_targets add constraint sales_targets_merchant_code_year_month_platform_key UNIQUE (merchant_code, year, month, platform);
alter table public.salla_connections add constraint salla_connections_salla_store_id_key UNIQUE (salla_store_id);
alter table public.account_closure_requests add constraint account_closure_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'cancelled'::text, 'closed'::text]));
alter table public.account_closure_requests add constraint account_closure_schedule_check CHECK (scheduled_for >= (requested_at + '30 days'::interval));
alter table public.account_closure_requests add constraint account_closure_state_check CHECK (status = 'pending'::text AND cancelled_at IS NULL AND closed_at IS NULL OR status = 'cancelled'::text AND cancelled_at IS NOT NULL AND closed_at IS NULL OR status = 'closed'::text AND closed_at IS NOT NULL);
alter table public.account_transactions add constraint account_transactions_platform_check CHECK (platform = ANY (ARRAY['noon'::text, 'amazon'::text, 'trendyol'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.ad_metrics add constraint ad_metrics_platform_check CHECK (platform = ANY (ARRAY['noon'::text, 'amazon'::text, 'trendyol'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.goods_received add constraint goods_received_platform_check CHECK (platform = ANY (ARRAY['noon'::text, 'amazon'::text, 'trendyol'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.goods_received add constraint goods_received_qc_status_check CHECK (qc_status = ANY (ARRAY['passed'::text, 'failed'::text]));
alter table public.inbound_shipments add constraint inbound_shipments_platform_check CHECK (platform = ANY (ARRAY['noon'::text, 'amazon'::text, 'trendyol'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.inventory add constraint inventory_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'warehouse'::text]));
alter table public.marketplace_action_logs add constraint marketplace_action_logs_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'amazon'::text, 'noon'::text]));
alter table public.marketplace_action_logs add constraint marketplace_action_logs_risk_level_check CHECK (risk_level = ANY (ARRAY['read'::text, 'write'::text, 'destructive'::text]));
alter table public.marketplace_action_logs add constraint marketplace_action_logs_status_check CHECK (status = ANY (ARRAY['running'::text, 'accepted'::text, 'processing'::text, 'success'::text, 'partial'::text, 'failed'::text]));
alter table public.marketplace_oauth_states add constraint marketplace_oauth_states_platform_check CHECK (platform = ANY (ARRAY['amazon'::text, 'noon'::text]));
alter table public.merchant_notes add constraint merchant_notes_type_check CHECK (type = ANY (ARRAY['note'::text, 'call'::text, 'email'::text, 'whatsapp'::text, 'meeting'::text, 'issue'::text, 'win'::text]));
alter table public.merchant_platform_mappings add constraint merchant_platform_mappings_last_sync_status_check CHECK (last_sync_status = ANY (ARRAY['success'::text, 'partial'::text, 'error'::text, 'running'::text]));
alter table public.merchant_requests add constraint merchant_requests_completion_result_check CHECK (completion_result IS NULL OR (completion_result = ANY (ARRAY['achieved'::text, 'partial'::text, 'not_achieved'::text, 'unknown'::text])));
alter table public.merchant_requests add constraint merchant_requests_priority_check CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]));
alter table public.merchant_requests add constraint merchant_requests_request_kind_check CHECK (request_kind = ANY (ARRAY['support'::text, 'action'::text]));
alter table public.merchant_requests add constraint merchant_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'done'::text, 'rejected'::text, 'blocked'::text, 'review'::text]));
alter table public.merchant_requests add constraint merchant_requests_type_check CHECK (type = ANY (ARRAY['price_change'::text, 'add_product'::text, 'remove_product'::text, 'update_info'::text, 'other'::text, 'ad_budget_increase'::text, 'ad_budget_decrease'::text, 'shipping_change'::text, 'inventory_update'::text, 'inquiry'::text, 'task'::text, 'complaint'::text]));
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_brief_check CHECK (jsonb_typeof(brief) = 'object'::text);
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_check CHECK (week_end = (week_start + 6));
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_check1 CHECK (source_data_as_of >= week_start AND source_data_as_of <= week_end);
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_target_status_check CHECK (target_status = ANY (ARRAY['not_set'::text, 'ahead'::text, 'on_track'::text, 'behind'::text]));
alter table public.merchants add constraint merchants_role_check CHECK (role = ANY (ARRAY['merchant'::text, 'employee'::text, 'staff'::text, 'admin'::text, 'super_admin'::text]));
alter table public.merchants add constraint merchants_single_free_plan_check CHECK (subscription_plan = 'free'::text AND COALESCE(subscription_monthly_amount, 0::numeric) = 0::numeric);
alter table public.merchants add constraint merchants_subscription_plan_check CHECK (subscription_plan = ANY (ARRAY['free'::text, 'salla'::text, 'growth'::text, 'pro'::text, 'elite'::text, 'enterprise'::text]));
alter table public.mfa_recovery_codes add constraint mfa_recovery_codes_code_hash_check CHECK (length(code_hash) = 64);
alter table public.nps_responses add constraint nps_responses_score_check CHECK (score >= 0 AND score <= 10);
alter table public.order_packages add constraint order_packages_line_count_check CHECK (line_count >= 0);
alter table public.order_packages add constraint order_packages_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.order_packages add constraint order_packages_quantity_check CHECK (quantity >= 0);
alter table public.orders add constraint orders_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.orders add constraint orders_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'shipped'::text, 'delivered'::text, 'cancelled'::text, 'returned'::text]));
alter table public.performance_data add constraint performance_data_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.platform_commission_rates add constraint platform_commission_rates_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text]));
alter table public.platform_connections add constraint platform_connections_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'respondly'::text, 'openrouter'::text]));
alter table public.platform_credentials add constraint platform_credentials_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text]));
alter table public.platform_fee_categories add constraint platform_fee_categories_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text]));
alter table public.product_performance_snapshots add constraint product_performance_snapshots_page_views_nonnegative CHECK (page_views IS NULL OR page_views >= 0);
alter table public.product_performance_snapshots add constraint product_performance_snapshots_percentages_valid CHECK ((session_percentage IS NULL OR session_percentage >= 0::numeric AND session_percentage <= 100.5) AND (page_views_percentage IS NULL OR page_views_percentage >= 0::numeric AND page_views_percentage <= 100.5) AND (buy_box_percentage IS NULL OR buy_box_percentage >= 0::numeric AND buy_box_percentage <= 100.5) AND (unit_session_percentage IS NULL OR unit_session_percentage >= 0::numeric AND unit_session_percentage <= 100.5));
alter table public.product_performance_snapshots add constraint product_performance_snapshots_platform_check CHECK (platform = ANY (ARRAY['noon'::text, 'amazon'::text, 'trendyol'::text, 'salla'::text, 'zid'::text, 'shopify'::text, 'other'::text]));
alter table public.product_performance_snapshots add constraint product_performance_snapshots_sessions_nonnegative CHECK (sessions IS NULL OR sessions >= 0);
alter table public.product_platform_listings add constraint product_platform_listings_delivery_status_check CHECK (delivery_status = ANY (ARRAY['draft'::text, 'accepted'::text, 'processing'::text, 'success'::text, 'partial'::text, 'failed'::text]));
alter table public.product_platform_prices add constraint product_platform_prices_platform_check CHECK (platform = ANY (ARRAY['trendyol'::text, 'noon'::text, 'amazon'::text, 'salla'::text, 'zid'::text, 'shopify'::text]));
alter table public.products add constraint products_status_check CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'out_of_stock'::text]));
alter table public.sales_targets add constraint sales_targets_amount_check CHECK (target_amount > 0::numeric AND target_amount <= 1000000000::numeric);
alter table public.sales_targets add constraint sales_targets_month_check CHECK (month >= 1 AND month <= 12);
alter table public.sync_logs add constraint sync_logs_status_check CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'partial'::text, 'error'::text]));
alter table security.client_incidents add constraint client_incidents_action_check CHECK (action IS NULL OR length(action) >= 1 AND length(action) <= 80);
alter table security.client_incidents add constraint client_incidents_category_check CHECK (category = ANY (ARRAY['render'::text, 'unhandled'::text, 'network'::text, 'api'::text, 'journey'::text]));
alter table security.client_incidents add constraint client_incidents_component_check CHECK (length(component) >= 1 AND length(component) <= 80);
alter table security.client_incidents add constraint client_incidents_error_code_check CHECK (length(error_code) >= 1 AND length(error_code) <= 80);
alter table security.client_incidents add constraint client_incidents_fingerprint_check CHECK (fingerprint ~ '^[a-f0-9]{64}$'::text);
alter table security.client_incidents add constraint client_incidents_http_status_check CHECK (http_status IS NULL OR http_status >= 100 AND http_status <= 599);
alter table security.client_incidents add constraint client_incidents_occurrence_count_check CHECK (occurrence_count > 0);
alter table security.client_incidents add constraint client_incidents_page_path_check CHECK (length(page_path) >= 1 AND length(page_path) <= 160 AND page_path ~~ '/%'::text AND page_path !~~ '%?%'::text AND page_path !~~ '%#%'::text);
alter table security.client_incidents add constraint client_incidents_release_check CHECK (length(release) >= 1 AND length(release) <= 64);
alter table security.client_incidents add constraint client_incidents_severity_check CHECK (severity = ANY (ARRAY['warning'::text, 'error'::text, 'fatal'::text]));
alter table security.client_incidents add constraint client_incidents_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text]));
alter table public.account_closure_requests add constraint account_closure_requests_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table public.account_closure_requests add constraint account_closure_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.account_transactions add constraint account_transactions_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.account_transactions add constraint account_transactions_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.ad_metrics add constraint ad_metrics_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.ad_metrics add constraint ad_metrics_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.budget_alerts add constraint budget_alerts_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.goods_received add constraint goods_received_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.goods_received add constraint goods_received_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.inbound_shipment_items add constraint inbound_shipment_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES inbound_shipments(id) ON DELETE CASCADE;
alter table public.inbound_shipment_items add constraint inbound_shipment_items_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.inbound_shipments add constraint inbound_shipments_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.inbound_shipments add constraint inbound_shipments_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.inventory add constraint inventory_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
alter table public.marketplace_action_logs add constraint marketplace_action_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.marketplace_action_logs add constraint marketplace_action_logs_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.marketplace_oauth_states add constraint marketplace_oauth_states_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.marketplace_oauth_states add constraint marketplace_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.merchant_account_links add constraint merchant_account_links_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.merchant_account_links add constraint merchant_account_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.merchant_notes add constraint merchant_notes_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.merchant_platform_mappings add constraint merchant_platform_mappings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES platform_connections(id) ON DELETE CASCADE;
alter table public.merchant_requests add constraint merchant_requests_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.merchant_requests add constraint merchant_requests_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_captured_by_fkey FOREIGN KEY (captured_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.merchant_weekly_briefs add constraint merchant_weekly_briefs_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.mfa_recovery_attempts add constraint mfa_recovery_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.mfa_recovery_codes add constraint mfa_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.nps_responses add constraint nps_responses_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.order_items add constraint order_items_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.order_packages add constraint order_packages_order_fkey FOREIGN KEY (merchant_code, platform, order_id) REFERENCES orders(merchant_code, platform, order_id) ON DELETE CASCADE;
alter table public.orders add constraint orders_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.payment_requests add constraint payment_requests_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.performance_data add constraint performance_data_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.performance_data add constraint performance_data_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.platform_credentials add constraint platform_credentials_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.platform_deals add constraint platform_deals_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.platform_deals add constraint platform_deals_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.platform_file_uploads add constraint platform_file_uploads_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.price_change_log add constraint price_change_log_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_performance_snapshots add constraint product_performance_snapshots_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code);
alter table public.product_performance_snapshots add constraint product_performance_snapshots_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.product_platform_listings add constraint product_platform_listings_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_platform_prices add constraint product_platform_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.products add constraint products_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.products add constraint products_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.returns add constraint returns_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES platform_file_uploads(id) ON DELETE CASCADE;
alter table public.salla_connections add constraint salla_connections_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.subscriptions add constraint subscriptions_merchant_code_fkey FOREIGN KEY (merchant_code) REFERENCES merchants(merchant_code) ON DELETE CASCADE;
alter table public.subscriptions add constraint subscriptions_payment_request_id_fkey FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id);
alter table public.task_comments add constraint task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES merchant_requests(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX account_closure_one_pending_per_merchant ON public.account_closure_requests USING btree (merchant_code) WHERE (status = 'pending'::text);
CREATE INDEX account_closure_due_idx ON public.account_closure_requests USING btree (scheduled_for) WHERE (status = 'pending'::text);
CREATE INDEX account_closure_requested_by_idx ON public.account_closure_requests USING btree (requested_by);
CREATE INDEX account_tx_merchant_platform_date_idx ON public.account_transactions USING btree (merchant_code, platform, transaction_date DESC);
CREATE INDEX account_tx_order_idx ON public.account_transactions USING btree (merchant_code, platform, order_id);
CREATE UNIQUE INDEX account_tx_uniq ON public.account_transactions USING btree (merchant_code, platform, transaction_no);
CREATE INDEX acct_tx_upload_idx ON public.account_transactions USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE INDEX ad_metrics_merchant_platform_date_idx ON public.ad_metrics USING btree (merchant_code, platform, report_date DESC);
CREATE INDEX ad_metrics_sku_idx ON public.ad_metrics USING btree (merchant_code, platform, sku);
CREATE INDEX ad_metrics_upload_idx ON public.ad_metrics USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX ad_metrics_natural_key ON public.ad_metrics USING btree (merchant_code, platform, report_date, campaign_name, ad_group_name, sku, search_query);
CREATE INDEX ai_insights_merchant_idx ON public.ai_insights USING btree (merchant_code);
CREATE INDEX ai_insights_created_idx ON public.ai_insights USING btree (created_at DESC);
CREATE UNIQUE INDEX amazon_daily_sales_uniq ON public.amazon_daily_sales USING btree (merchant_code, data_date);
CREATE INDEX audit_log_performed_at_idx ON public.audit_log USING btree (performed_at DESC);
CREATE INDEX audit_log_merchant_time_idx ON public.audit_log USING btree (merchant_code, performed_at DESC);
CREATE INDEX audit_log_action_time_idx ON public.audit_log USING btree (action, performed_at DESC);
CREATE INDEX grn_merchant_asn_idx ON public.goods_received USING btree (merchant_code, asn_number);
CREATE INDEX grn_sku_idx ON public.goods_received USING btree (merchant_code, platform, sku);
CREATE INDEX grn_upload_idx ON public.goods_received USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX goods_received_natural_key ON public.goods_received USING btree (merchant_code, platform, asn_number, sku, qc_status, reject_reason);
CREATE INDEX import_diagnostics_recent ON public.import_diagnostics USING btree (created_at DESC);
CREATE INDEX inbound_items_shipment_idx ON public.inbound_shipment_items USING btree (shipment_id);
CREATE INDEX inbound_items_sku_idx ON public.inbound_shipment_items USING btree (merchant_code, sku);
CREATE INDEX asn_items_upload_idx ON public.inbound_shipment_items USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX inbound_shipment_items_natural_key ON public.inbound_shipment_items USING btree (shipment_id, sku);
CREATE INDEX asn_upload_idx ON public.inbound_shipments USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE INDEX inventory_merchant_idx ON public.inventory USING btree (merchant_code);
CREATE INDEX inventory_sku_idx ON public.inventory USING btree (sku);
CREATE INDEX inventory_low_stock_idx ON public.inventory USING btree (quantity) WHERE (quantity <= low_stock_threshold);
CREATE INDEX inventory_merchant_platform_sku_idx ON public.inventory USING btree (merchant_code, platform, sku);
CREATE INDEX inventory_upload_idx ON public.inventory USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE INDEX idx_invoices_merchant ON public.invoices USING btree (merchant_code);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX idx_invoices_subscription_id ON public.invoices USING btree (subscription_id);
CREATE UNIQUE INDEX marketplace_action_idempotency_uniq ON public.marketplace_action_logs USING btree (merchant_code, platform, action, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX marketplace_action_merchant_date_idx ON public.marketplace_action_logs USING btree (merchant_code, platform, started_at DESC);
CREATE INDEX marketplace_action_logs_created_by_idx ON public.marketplace_action_logs USING btree (created_by);
CREATE INDEX marketplace_oauth_states_expiry_idx ON public.marketplace_oauth_states USING btree (expires_at);
CREATE INDEX marketplace_oauth_states_merchant_code_idx ON public.marketplace_oauth_states USING btree (merchant_code);
CREATE INDEX marketplace_oauth_states_user_id_idx ON public.marketplace_oauth_states USING btree (user_id);
CREATE INDEX mal_email_idx ON public.merchant_account_links USING btree (email);
CREATE INDEX idx_mal_merchant_code ON public.merchant_account_links USING btree (merchant_code);
CREATE UNIQUE INDEX merchant_account_links_user_merchant_uidx ON public.merchant_account_links USING btree (user_id, merchant_code) WHERE (user_id IS NOT NULL);
CREATE INDEX merchant_account_links_user_default_idx ON public.merchant_account_links USING btree (user_id, is_default DESC, merchant_code) WHERE (user_id IS NOT NULL);
CREATE INDEX notes_merchant_idx ON public.merchant_notes USING btree (merchant_code, created_at DESC);
CREATE INDEX mps_merchant_date ON public.merchant_payout_schedule USING btree (merchant_code, payout_date DESC);
CREATE INDEX mpm_merchant_idx ON public.merchant_platform_mappings USING btree (merchant_code);
CREATE INDEX mpm_connection_idx ON public.merchant_platform_mappings USING btree (connection_id);
CREATE INDEX mr_assigned_idx ON public.merchant_requests USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX mr_status_idx ON public.merchant_requests USING btree (status);
CREATE INDEX mr_platform_idx ON public.merchant_requests USING btree (platform) WHERE (platform IS NOT NULL);
CREATE INDEX mr_priority_idx ON public.merchant_requests USING btree (priority);
CREATE INDEX mr_created_at_idx ON public.merchant_requests USING btree (created_at DESC);
CREATE INDEX idx_merchant_requests_product_id ON public.merchant_requests USING btree (product_id);
CREATE INDEX idx_merchant_requests_merchant_code ON public.merchant_requests USING btree (merchant_code);
CREATE UNIQUE INDEX merchant_requests_active_action_source_uidx ON public.merchant_requests USING btree (merchant_code, source_key) WHERE ((request_kind = 'action'::text) AND (source_key IS NOT NULL) AND (status <> ALL (ARRAY['done'::text, 'rejected'::text])));
CREATE INDEX merchant_requests_action_plan_idx ON public.merchant_requests USING btree (merchant_code, status, due_date) WHERE (request_kind = 'action'::text);
CREATE INDEX merchant_weekly_briefs_timeline_idx ON public.merchant_weekly_briefs USING btree (merchant_code, week_start DESC);
CREATE INDEX merchant_weekly_briefs_captured_by_idx ON public.merchant_weekly_briefs USING btree (captured_by);
CREATE INDEX idx_merchants_email ON public.merchants USING btree (email);
CREATE INDEX idx_merchants_subscription_status ON public.merchants USING btree (subscription_status);
CREATE INDEX idx_merchants_salla_store ON public.merchants USING btree (salla_store_id) WHERE (salla_store_id IS NOT NULL);
CREATE INDEX idx_merchants_owner_code ON public.merchants USING btree (owner_merchant_code) WHERE (owner_merchant_code IS NOT NULL);
CREATE INDEX mfa_recovery_attempts_user_time_idx ON public.mfa_recovery_attempts USING btree (user_id, attempted_at DESC);
CREATE INDEX mfa_recovery_codes_user_unused_idx ON public.mfa_recovery_codes USING btree (user_id, created_at DESC) WHERE (used_at IS NULL);
CREATE INDEX idx_notifications_merchant ON public.notifications USING btree (merchant_code, is_read, created_at DESC);
CREATE INDEX nps_merchant_idx ON public.nps_responses USING btree (merchant_code);
CREATE INDEX order_items_order_idx ON public.order_items USING btree (merchant_code, platform, order_id);
CREATE INDEX order_items_barcode_idx ON public.order_items USING btree (merchant_code, platform, barcode);
CREATE INDEX order_items_package_lookup_idx ON public.order_items USING btree (merchant_code, platform, shipment_package_id) WHERE (shipment_package_id IS NOT NULL);
CREATE INDEX order_packages_order_lookup_idx ON public.order_packages USING btree (merchant_code, platform, order_id, modified_at DESC);
CREATE INDEX order_packages_open_status_idx ON public.order_packages USING btree (merchant_code, status, modified_at DESC) WHERE (status <> ALL (ARRAY['delivered'::text, 'cancelled'::text, 'returned'::text]));
CREATE INDEX orders_merchant_code_idx ON public.orders USING btree (merchant_code);
CREATE INDEX orders_platform_idx ON public.orders USING btree (platform);
CREATE INDEX orders_order_date_idx ON public.orders USING btree (order_date DESC);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);
CREATE INDEX orders_merchant_platform_date_idx ON public.orders USING btree (merchant_code, platform, order_date DESC);
CREATE INDEX orders_upload_idx ON public.orders USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE INDEX orders_trendyol_package_idx ON public.orders USING btree (merchant_code, shipment_package_id) WHERE ((platform = 'trendyol'::text) AND (shipment_package_id IS NOT NULL));
CREATE INDEX idx_payment_requests_merchant ON public.payment_requests USING btree (merchant_code);
CREATE INDEX idx_payment_requests_status ON public.payment_requests USING btree (status);
CREATE INDEX idx_performance_merchant_code ON public.performance_data USING btree (merchant_code);
CREATE INDEX idx_performance_created_at ON public.performance_data USING btree (created_at DESC);
CREATE UNIQUE INDEX performance_data_agg_upsert ON public.performance_data USING btree (merchant_code, platform, data_date) WHERE ((data_date IS NOT NULL) AND (product_name IS NULL));
CREATE UNIQUE INDEX performance_data_prod_upsert ON public.performance_data USING btree (merchant_code, platform, data_date, product_name) WHERE ((data_date IS NOT NULL) AND (product_name IS NOT NULL));
CREATE UNIQUE INDEX performance_data_uniq ON public.performance_data USING btree (merchant_code, platform, data_date) WHERE (product_name IS NULL);
CREATE INDEX idx_performance_data_product_id ON public.performance_data USING btree (product_id);
CREATE INDEX deals_merchant_idx ON public.platform_deals USING btree (merchant_code, platform);
CREATE INDEX deals_upload_idx ON public.platform_deals USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX platform_deals_natural_key ON public.platform_deals USING btree (merchant_code, platform, barcode, content_id);
CREATE INDEX file_uploads_merchant_idx ON public.platform_file_uploads USING btree (merchant_code, uploaded_at DESC);
CREATE INDEX pfu_fingerprint_idx ON public.platform_file_uploads USING btree (merchant_code, fingerprint) WHERE (fingerprint IS NOT NULL);
CREATE INDEX platform_file_uploads_uploaded_at_idx ON public.platform_file_uploads USING btree (uploaded_at DESC);
CREATE INDEX platform_file_uploads_platform_date_idx ON public.platform_file_uploads USING btree (platform, uploaded_at DESC);
CREATE INDEX platform_file_uploads_type_date_idx ON public.platform_file_uploads USING btree (file_type, uploaded_at DESC) WHERE (file_type IS NOT NULL);
CREATE INDEX platform_file_uploads_uploader_date_idx ON public.platform_file_uploads USING btree (uploaded_by, uploaded_at DESC) WHERE (uploaded_by IS NOT NULL);
CREATE INDEX idx_price_change_log_product_id ON public.price_change_log USING btree (product_id);
CREATE INDEX pps_merchant_platform_date_idx ON public.product_performance_snapshots USING btree (merchant_code, platform, snapshot_date DESC);
CREATE INDEX pps_sku_idx ON public.product_performance_snapshots USING btree (merchant_code, platform, sku);
CREATE INDEX pps_upload_idx ON public.product_performance_snapshots USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX pps_natural_key ON public.product_performance_snapshots USING btree (merchant_code, platform, snapshot_date, sku);
CREATE INDEX idx_product_performance_amazon_asin ON public.product_performance_snapshots USING btree (merchant_code, snapshot_date DESC, asin) WHERE ((platform = 'amazon'::text) AND (asin IS NOT NULL));
CREATE INDEX ppl_merchant_idx ON public.product_platform_listings USING btree (merchant_code);
CREATE INDEX product_platform_listings_batch_idx ON public.product_platform_listings USING btree (merchant_code, platform, external_batch_id) WHERE (external_batch_id IS NOT NULL);
CREATE INDEX products_merchant_sku_idx ON public.products USING btree (merchant_code, sku);
CREATE INDEX products_merchant_barcode_idx ON public.products USING btree (merchant_code, barcode);
CREATE INDEX products_merchant_asin_idx ON public.products USING btree (merchant_code, asin);
CREATE INDEX products_upload_idx ON public.products USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE INDEX idx_returns_merchant ON public.returns USING btree (merchant_code, return_date DESC);
CREATE INDEX returns_upload_idx ON public.returns USING btree (upload_id) WHERE (upload_id IS NOT NULL);
CREATE UNIQUE INDEX returns_trendyol_claim_line_uniq ON public.returns USING btree (merchant_code, platform, claim_id, claim_line_id);
CREATE INDEX returns_trendyol_claim_item_idx ON public.returns USING btree (merchant_code, provider_claim_item_id) WHERE ((platform = 'trendyol'::text) AND (provider_claim_item_id IS NOT NULL));
CREATE INDEX idx_salla_conn_merchant ON public.salla_connections USING btree (merchant_code);
CREATE INDEX idx_salla_conn_store_id ON public.salla_connections USING btree (salla_store_id);
CREATE INDEX idx_subscriptions_merchant ON public.subscriptions USING btree (merchant_code);
CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status);
CREATE INDEX idx_subscriptions_salla_id ON public.subscriptions USING btree (salla_subscription_id) WHERE (salla_subscription_id IS NOT NULL);
CREATE UNIQUE INDEX idx_subscriptions_merchant_unique ON public.subscriptions USING btree (merchant_code);
CREATE INDEX idx_subscriptions_payment_request ON public.subscriptions USING btree (payment_request_id);
CREATE INDEX idx_sync_logs_merchant ON public.sync_logs USING btree (merchant_code, started_at DESC);
CREATE INDEX idx_queue_pending ON public.sync_queue USING btree (priority, scheduled_at) WHERE (status = 'pending'::text);
CREATE INDEX idx_queue_merchant ON public.sync_queue USING btree (merchant_code, status);
CREATE INDEX idx_queue_retry ON public.sync_queue USING btree (next_retry_at) WHERE ((status = 'failed'::text) AND (attempts < max_attempts));
CREATE INDEX sync_queue_health_monitor_idx ON public.sync_queue USING btree (status, scheduled_at) WHERE ((health_alerted_at IS NULL) AND (status = ANY (ARRAY['pending'::text, 'running'::text, 'failed'::text])));
CREATE INDEX task_comments_task_idx ON public.task_comments USING btree (task_id, created_at DESC);
CREATE INDEX idx_webhook_store ON public.webhook_events USING btree (store_id, event_type);
CREATE INDEX idx_webhook_pending ON public.webhook_events USING btree (status, received_at) WHERE (status <> 'processed'::text);
CREATE UNIQUE INDEX webhook_events_source_event_key_uniq ON public.webhook_events USING btree (source, event_key);
CREATE UNIQUE INDEX client_incidents_open_fingerprint_idx ON security.client_incidents USING btree (merchant_code, fingerprint) WHERE (status = 'open'::text);
CREATE INDEX client_incidents_status_seen_idx ON security.client_incidents USING btree (status, last_seen_at DESC);
CREATE INDEX client_incidents_merchant_seen_idx ON security.client_incidents USING btree (merchant_code, last_seen_at DESC);
CREATE INDEX client_incidents_user_rate_idx ON security.client_incidents USING btree (user_id, first_seen_at DESC);

grant all on all tables in schema public, security to postgres, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public, security to anon, authenticated, service_role;

