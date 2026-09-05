# Data, identity and business invariants

## Sources of truth

All schema, policy and storage descriptions below refer to committed SQL/code.
Their application and enforcement in Production are `NEEDS_CONFIRMATION`.
A migration's presence is not evidence that it has run on any remote database.
Applying migrations, including through local stack startup, requires an explicit
request for the action and target; schema documentation does not authorize it.

The reproducible schema definition is the ordered set in
[`supabase/migrations/`](../supabase/migrations/), beginning with
`20260801000000_baseline_schema.sql`, followed by all subsequent migrations.
The 2026-09-05 review found 159 migration files, ending with
`20260828083527_pricing_requests.sql`. Counts are an inventory snapshot, not a contract.

Definitions are often replaced or relocated from `public` to `security`.
Some migrations use dynamic SQL to rewrite functions, policies or grants.
Find every occurrence of the affected object, in filename order, including
ALTER/DROP/GRANT/REVOKE and later wrappers. The first CREATE is not the final schema.

- [supabase-schema.sql](../supabase-schema.sql) is an obsolete two-table artifact.
  Never initialize or repair the current application from it.
- [database.types.ts](../src/lib/database.types.ts) says it was generated on
  2026-06-11. It is a historical generated snapshot, is not imported as the browser
  client generic, and does not establish current migration parity. Regeneration
  must use a deliberately selected schema/environment; never hand-edit it.
- [supabase.ts](../src/lib/supabase.ts) contains current hand-maintained frontend
  interfaces, which can also lag SQL. Successful TypeScript compilation does not
  validate database columns, RLS or RPC signatures.
- Live schema/history is `NEEDS_CONFIRMATION` until explicitly inspected against
  an authorized target. The dated history mismatch in
  [Production releases](PRODUCTION_RELEASES.md) is not permission to repair it.
- Files in `docs/` containing old SQL or audit findings are historical references,
  not migrations or instructions to execute.

## Main entities and relationships

| Domain | Main relations / relationship |
| --- | --- |
| Identity/workspaces | `auth.users` → `merchants.id`; `merchant_code` scopes business data; `owner_merchant_code` associates store employees; `merchant_account_links` links users to additional workspaces |
| Orders/fulfillment | `orders`, `order_items`, `order_packages`, `returns`; distinguish order identity from shipment-package and line identity |
| Catalog and stock | `products`, `product_channel_mappings`, `product_platform_listings`, `product_platform_prices`, `inventory`, `product_performance_snapshots` |
| Imports | `platform_file_uploads` stores source metadata/status; `upload_id` associates rows; `import_diagnostics` records parsing issues; original file is in private Storage |
| Money/advertising | `account_transactions`, `amazon_daily_sales`, `ad_metrics`, `performance_data`, fee reference tables, `merchant_contract_terms`, `merchant_platform_finance_settings`; reconciliation tables added by bank-statement migrations |
| Operations | `merchant_requests`, `task_comments`, `merchant_notes`, `inbound_shipments`, `inbound_shipment_items`, `goods_received`, `notifications` |
| Integrations | `platform_credentials`, `salla_connections`, `sync_queue`, `sync_logs`, `webhook_events`, `marketplace_action_logs`; Omniful account/channel/observation tables |
| Public intake | `service_request_forms` → questions/stages; `service_request_submissions` → activities; distinct from existing merchant support requests |
| Security/monitoring | `audit_log`, `security.client_incidents`, MFA recovery and account-closure records; guarded server/RPC access |

Browser APIs include tables/views and named PostgREST RPCs, not just Edge Functions.
Examples: `unified_product_catalog`, `commit_my_file_import`,
`list_order_operating_facts`, `list_return_facts`,
`list_marketplace_operation_facts`, `my_employees`,
`update_my_store_profile`, `get_db_health`, `admin_overview_metrics`.
Read callers plus the final SQL signature/privileges before changing a contract.

## Authentication and authorization

[App.tsx](../src/App.tsx) loads the signed-in identity by user ID. A merchant
employee is resolved to the owner's workspace while preserving employee role,
permissions and authenticated identity. Admin/super_admin/staff enter AdminPanel.
Account switching and admin viewing do not themselves grant new backend rights.

- `merchant`: workspace owner. `employee`: owner's store with explicit merchant
  permissions. `staff`: platform employee with separate platform permissions.
  `admin`/`super_admin`: platform managers.
- [merchantPermissions.ts](../src/lib/merchantPermissions.ts) supports stored
  merchant permission objects/arrays, rejects inactive users and does not delegate
  team ownership. [permissions.ts](../src/lib/permissions.ts) gives platform
  permissions only to platform staff/managers, never merchant employees.
- SQL helpers in `security` resolve `auth.uid()`, accessible workspaces, active
  state and permissions. Tenant restrictions, object/column grants and per-action
  permissions work together. Do not use email equality or user-editable metadata
  as an authorization replacement.
- `workspace_status` is administrative access state, independent of retired
  paid subscriptions. Self-service provisioning waits for email confirmation
  before account activation and records legal acceptance through guarded paths.
- Opt-in MFA requires AAL2 for users with a verified factor through restrictive
  data/Storage policies. Recovery codes, attempts and lifecycle operations have
  separate guarded paths. UI challenge success alone is not an authorization test.
- Edge Functions using the service client must validate the actor and target
  explicitly. [authorizeMerchantSync](../supabase/functions/_shared/sync.ts) checks
  staff/owner/employee/linked access and active target workspace, including for
  internal syncs. Do not assume a service client inherits user RLS.
- Public RPC wrappers and private `security` implementations are intentional.
  Preserve safe search paths, execution grants and internal actor checks.
- Raw provider payloads, customer fields, credentials and audit records have
  restricted column/RPC access. Do not replace safe projections with `select('*')`
  to work around an access error.

Key migration families: `bootstrap_security_access_context`,
`enforce_opt_in_mfa_across_data_api`, `restore_linked_workspace_rls`,
`restore_private_rpc_boundary`, `explicit_data_api_grants`,
`enforce_catalog_finance_tenant_boundaries`. Pair them with their later changes
and [SQL tests](../supabase/tests/), not just their names.

## Business rules and regression anchors

| Invariant | Code / tests to read |
| --- | --- |
| Do not double-count sales sources | Final `security.rebuild_performance_data` in [snapshot semantics migration](../supabase/migrations/20260805080213_correct_trendyol_snapshot_financial_semantics.sql); `performance_source_precedence.test.sql`, `amazonReportReconciliation.test.ts` |
| Orders outrank Amazon finance rows, which outrank Amazon report summaries; Trendyol snapshots are used only when no canonical Trendyol orders exist | Rebuild selects source at platform scope, not merely per day; preserve its exact coverage behavior |
| Discounts are not deducted twice | [orderProfit.ts](../src/lib/orderProfit.ts): `total_amount` is already net; distinct gross amount enables separate discount deduction; `orderProfit.test.ts` |
| Unknown costs are not zero profit | [financialSummary.ts](../src/lib/financialSummary.ts) gates estimated profit/margin on sales-detail and cost completeness; [orderProfit.ts](../src/lib/orderProfit.ts) returns null when costs are incomplete |
| Sellpert fee is per delivered order | [sellpertCommission.ts](../src/lib/sellpertCommission.ts) and [SQL fee definition](../supabase/migrations/20260817092059_correct_sellpert_order_commission_semantics.sql): fixed once per order or percentage of recorded order total plus separately reported customer shipping; cancelled/returned earn zero; no automatic VAT addition |
| Product identity has multiple provider aliases | [catalogIdentity.ts](../src/lib/catalogIdentity.ts), `product_channel_mappings`, catalog RPC and actor/tenant triggers; resolver includes name fallback, so do not assume names are unique global identifiers |
| Freshness and provenance are evidence-based | [dataLineage.ts](../src/lib/dataLineage.ts), `storeHealth.ts`, `workspaceReadiness.ts`: file/API/manual/unknown must remain distinct |
| Orders, packages and items are different grains | `trendyolOrders`, `trendyolPackageWorkflow`, `trendyolPackageMutations` in shared Edge helpers plus tests; preserve split packages and claim line IDs |

A current launch screen may compute its own metrics (notably DashboardV2).
Trace its calculation before applying rules from an advanced financial page.
Arabic formatting, Latin digits and Riyadh date boundaries have dedicated tests;
do not standardize currency/time behavior globally as an incidental cleanup.

## Import and Storage boundaries

[ImportFilesView.tsx](../src/pages/admin/ImportFilesView.tsx) is also reused for
merchant imports. It parses through [platformParsers.ts](../src/lib/platformParsers.ts),
detects duplicate uploads, archives the original privately, then calls
`commit_my_file_import`. Failure to archive blocks committing business rows.

The atomic import SQL validates the target, archive and allowed tables and
overwrites supplied tenant/upload identity. The later
[`chunk_large_atomic_file_imports`](../supabase/migrations/20260812202758_chunk_large_atomic_file_imports.sql)
processes 5,000-row statements within one transaction; it does not turn one file
into independent commits. File-level limits and cascade deletion behavior matter.

[importArchive.ts](../src/lib/importArchive.ts) limits input files to 25 MiB,
ZIP expansion to 100 entries / 100 MiB, and preserves Excel containers.
`merchant-imports` uses merchant/upload paths; `merchant-assets` logo writes
use scoped policies. `service-request-documents` is a separate private bucket
for public intake accepted through its Edge Function and administrative access.

Relevant tests: `atomic_merchant_file_import.test.sql`,
`merchant_import_storage_isolation.test.sql`, `largeAtomicImportContract.test.ts`,
`importArchive.test.ts`, plus provider parser and payload-access contracts.
Never run deletion/rebuild/import fixtures against production.
