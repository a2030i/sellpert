# APIs and external integrations

This is the API surface found in the repository. Production enablement and working
credentials/scopes for every provider, including Trendyol, Salla and Omniful, are
`NEEDS_CONFIRMATION`. Handler/config/migration files do not prove deployment or
activation. Read [Data and security](DATA_AND_SECURITY.md)
before changing any tenant-facing handler.

## Browser and server API split

Browser code uses Supabase Auth, PostgREST tables/views/RPCs, Storage, and
`/functions/v1/<function-name>`. Edge handlers are under
[`supabase/functions/`](../supabase/functions/); shared provider normalization,
auth, retry, encryption and validation live under `_shared/`.

Most user operations send a session bearer token (many also send the browser
anon key). The anon key is not authority for a privileged operation.
`supabase/config.toml` explicitly disables gateway JWT verification for:
`trendyol-webhook`, `salla-webhook`, `salla-oauth-callback`, `queue-worker`,
and `pricing-request`. Their handler-specific trust checks are essential;
never enable/disable gateway checks as a generic fix.

| Edge Function(s) | Contract / purpose |
| --- | --- |
| `manage-platform-credentials` | Trendyol credential list/save/delete, queue sync, sync status; returns safe status rather than secret material |
| `amazon-connect` | Amazon SP-API website authorization for a signed-in user: status, start (single-use hashed state + Seller Central consent URL), complete (state check, LWA code exchange, seller verification, encrypted refresh token), disconnect |
| `test-platform-connection`, `sync-trendyol` | Connection validation and normalized marketplace synchronization |
| `trendyol-actions` | Fixed action registry for products, pricing/stock, packages, invoices, claims, questions and provider reference operations |
| `trendyol-webhook` | Validated provider callbacks, event dedupe and order/queue updates |
| `salla-oauth-callback`, `salla-webhook`, `salla-sync` | Existing Salla onboarding/token, signed event and synchronization paths |
| `queue-worker` | Internal job selection/completion, dispatch to Salla/Trendyol and legacy credential sealing |
| `manage-omniful-amazon` | Despite its historical name, Amazon/Noon/Trendyol shadow observations, account modes, channel discovery/assignment and portal configuration |
| `admin-integration-settings` | Guarded server-side integration setting writes and safe configuration status |
| `create-merchant`, `create-employee` | Identity provisioning; employee handler also manages invitation/access-link operations |
| `impersonate-merchant`, `admin-reset-merchant-password` | Privileged, actor-checked account access/reset operations |
| `mfa-recovery`, `account-lifecycle` | Recovery-code management, bounded export and account-closure request/cancellation |
| `manual-entry` | Authorized merchant selection and performance entry |
| `activity-feed` | Filtered activity from audit data; do not grant direct audit table access |
| `pricing-request` | Public GET form schema and multipart POST submissions, attachments and follow-up initialization |

This table is an index, not a replacement for request validation and response
shape in each handler. In particular, `trendyol-actions` defines accepted methods,
paths, risk levels and payload rules in its own `ACTIONS` registry; do not permit
caller-provided URLs or forward arbitrary provider operations.

## Provider behavior and constraints

### Trendyol

Direct integration uses server-held seller credentials, provider-specific
normalizers, package/item identity and financial rules. Product V2 listing,
review and delivery state are separate from local product existence.

The action handler enforces its confirmation/idempotency/audit paths for writes.
Preserve reconciliation of uncertain outcomes rather than blindly repeating
mutations. Shared sync range validation requires the upper bound to be at least
two minutes in the past. Read [sync.ts](../supabase/functions/_shared/sync.ts),
the action handler and associated tests before changing retries or date windows.

Webhook authentication uses configured secret material and bounded request
bodies. The webhook handler and `_shared/webhookSecurity.ts` define accepted
forms and timing-safe comparisons. Do not remove them because gateway JWT
verification is disabled.

### Amazon (SP-API connection)

Owner decision 2026-11-26: Sellpert is an approved public SP-API solution
provider (non-PII roles only: Product Listing, Pricing, Amazon Fulfillment,
Inventory and Order Tracking, Finance and Accounting, Selling Partner Insights),
so Amazon is a direct connection again. Commitments made to Amazon are in
[Security policy](SECURITY-POLICY.md).

- Flow: the Integrations page calls `amazon-connect` `start`; the browser goes to
  `/apps/authorize/consent` on the marketplace's Seller Central (`version=beta`
  while the app is a draft). Amazon redirects to the registered URI
  `/integrations/amazon/callback`; the SPA posts `state`, `selling_partner_id`
  and `spapi_oauth_code` to `complete` with the user's session.
- `amazon_oauth_states` stores only a SHA-256 hash of the state, bound to the
  user and workspace, expiring within 15 minutes and consumed once. The table is
  server-only.
- Every action first verifies the session and reads the actor through a
  user-context Data API client. The existing restrictive MFA policy on
  `merchants` therefore denies enrolled users with AAL1 sessions before any
  privileged credential operation. A denied or failed actor read never falls
  back to a service-role read. Workspace checks still run separately.
- `complete` exchanges the code at LWA with the registered redirect URI, reads
  `GET /sellers/v1/marketplaceParticipations` on the EU endpoint, requires at
  least one supported marketplace (Amazon.sa/.ae/.eg), and verifies access to
  the supplied seller ID with `searchListingsItems` on that seller's own route.
  This read requires Product Listing or Inventory and Order Tracking, requests
  one listing summary, accepts a valid empty result, and discards listing data.
  It rejects failed or malformed responses before saving credentials, rejects a
  seller already active in another workspace, and upserts `platform_credentials`
  (`platform = 'amazon'`, `seller_id` = selling partner ID, refresh token in
  `extra.secret_blob`).
  A partial unique index prevents concurrent active connections for the same
  Amazon seller in different workspaces; a conflict returns HTTP 409.
- Sync (`sync-amazon`, dispatched by `queue-worker` for `platform = 'amazon'`;
  `enqueue_active_marketplace_syncs` includes Amazon from migration
  `20261127090000`). Each run continues a cursor in
  `platform_credentials.extra.sync` (no secrets) and stops after ~30 s or on
  HTTP 429. Pages alternate between orders and per-marketplace finances so
  neither stream is starved; the next run starts with the other stream after
  a rate limit. Orders v2026-01-01 `searchOrders` allows 0.0056 req/s
  (burst 20):
  - Financial sync currently covers **Amazon Saudi Arabia / SAR only**
    (`A17E79C6D8DWNP`). Existing aggregates have no currency conversion layer.
    Accounts must participate in Saudi Arabia before OAuth completion can save
    the connection; an account selling only in UAE/Egypt is rejected, so this
    connection attempt does not disable its file imports. For multi-market
    accounts only Saudi data is requested, with a warning that other markets
    are excluded. Explicit non-SAR amounts anywhere in an incoming provider page
    or mapped row fail closed before that page is written or its cursor advances.
    Stored fee payloads are also checked before recalculating order fees.
    Missing amounts on pending orders remain allowed. No exchange
    rate, conversion or cross-currency total is inferred.
  - Orders: 365-day backfill walking backwards in 30-day windows (newest
    month first) by `createdAfter/createdBefore`, then incremental by
    `lastUpdatedAfter/lastUpdatedBefore` from the backfill start with a
    10-minute overlap. Expired 24-hour pagination tokens replay their frozen
    window without skipping it. Query array parameters use CSV serialization. `includedData` is only `PROCEEDS` and `FULFILLMENT`
    (no BUYER/RECIPIENT). Items are embedded and upserted into `order_items`.
    Order refreshes never write `platform_fee`.
  - Finances v2024-06-19 `listTransactions`: the same 365-day backward
    backfill in 30-day windows independently for each connected marketplace
    (the request always includes `marketplaceId`), then forward windows (≤180 days) from the
    backfill start, with a 2-day re-read once caught up. Rows go to
    `account_transactions` with
    `raw.sellpertSource = 'sp_api'`; each touched order's `platform_fee` is
    recomputed from all stored SP-API transactions for that order, paging through
    the database results. Each page reconciles fees before its cursor advances;
    failures replay the page idempotently. Orders with no SP-API transaction keep
    their current fee. Nested fee aggregates are counted once, including reversals.
  - `rebuild_performance_data` runs once per completed run.
  - User-triggered sync enforces the same user-context MFA actor check as Amazon
    authorization before privileged work; the internal service-token queue path
    remains supported. Each run takes a conditional 120-second credential lease.
    Concurrent runs and reconnect/disconnect during that lease fail closed;
    credential writes compare revisions or lease IDs and cannot restore old
    ciphertext over a replacement account. Provider fetching stops at ~30 seconds
    and database HTTP calls at 45 seconds. Failed runs retain their expiring lease
    because a transport failure does not prove server-side writes have stopped.
    Release requires checking the production PostgREST statement timeout stays
    below the remaining lease margin (read-only inspection on 2026-11-27 found authenticator configured at 8 seconds,
    with no service-role or database-level override).
  - Malformed successful API responses fail closed without advancing a window.
    Cursor version 3 validates the connected marketplace scope; incompatible
    checkpoints replay the bounded backfill rather than skipping history.
  - Not included: inventory, listings/pricing, ads (separate Amazon Ads API),
    returns as `returns` rows. Fee classification by breakdown type
    (`amazonTransactionFee`) and the response shapes are verified only against
    Amazon's published models, not live data: `NEEDS_CONFIRMATION` with a
    consenting merchant before wider rollout. Orders v2026 does not establish
    delivery beyond SHIPPED; do not infer DELIVERED or delivered-only commission
    eligibility. Whether a deferred finance transaction released later than the
    two-day reread window changes its posted date remains NEEDS_CONFIRMATION.
  - Historical Amazon file rows in `account_transactions` are kept; for
    overlapping periods the statement ledger can contain both file and SP-API
    rows (performance and P&L are unaffected because API orders take
    precedence). Per the 2026-11-27 owner decision these file rows are low
    priority; any cleanup still needs explicit approval as a data change.
  - During the first backfill, dashboards show only the API history fetched so
    far (newest months first), because any API order overrides file-based
    Amazon performance for all dates. File-based Amazon history older than
    12 months therefore stops appearing in performance once API orders exist.
    Owner decision 2026-11-27: accepted. The platform is in a trial phase and
    uploaded Amazon files cover scattered periods, so they are not a reliable
    source; no per-date precedence change is planned.
- Owner decision 2026-11-26: once a merchant's SP-API connection works, the API
  is the authoritative Amazon source and Amazon file uploads are retired for
  that merchant. Note the existing precedence in `security.rebuild_performance_data`:
  as soon as any `orders` row with `platform = 'amazon'` exists for a merchant,
  Amazon `account_transactions` and `amazon_daily_sales` are ignored for all
  dates, so the first API sync must backfill history to avoid losing earlier
  file-based periods. File-imported Amazon orders share the
  `(merchant_code, platform, order_id)` key and are merged, not duplicated.
- Seller Central-initiated authorization (Login URI with `amazon_callback_uri`)
  is not implemented; the registered Login URI only opens the Integrations page.

The import UI disables Amazon uploads while the connection is active and while
its status cannot be verified. Other platforms and historical archives remain
available. A permission-checked boolean RPC, `amazon_file_import_allowed`, also
supports the existing platform-staff import flow without exposing credentials.
The atomic import RPC enforces the rule for all callers, checking both the upload
platform and Amazon payload rows so relabeling a file cannot bypass it. This does
not delete previous imports; synchronization is dispatched separately as above.

Release dependency: the new import-policy RPC must be available before publishing
the frontend. On a missing RPC or failed status check, Amazon imports fail closed;
other platform imports remain available. Live OAuth, seller-ID rejection and
SQL enforcement still require validation against an authorized environment.

Platform administrators can enter the three Amazon app credentials together at
`/admin/amazon`. `admin-integration-settings` verifies the administrator and the
user-context MFA policy, then stores one AES-GCM encrypted `AMAZON_SP_APP_CONFIG`
record in server-only `app_settings`. The response contains configuration booleans
only; saved values are never returned or prefilled. `amazon-connect` reads that
record on the server. If no record exists, the original Edge secret configuration
remains supported. An unreadable stored record fails closed instead of switching
to a different app identity. Database-managed configuration uses the fixed
`https://app.sellpert.com/integrations/amazon/callback` URL and draft mode.
This does not mirror values into Supabase Edge Function Secrets or require a
Management API token in the application runtime. Replacing the global app identity
can require merchants to reconnect; it is not a verification of Amazon API access.

### Salla

Server implementation remains even though the launch product/direct-connection
types are narrower. `getSettings.ts` reads selected DB settings before environment
fallbacks. The OAuth callback exchanges the authorization code, retrieves store
identity from the provider and checks any supplied store ID against it; existing
email alone does not authorize takeover of an existing Sellpert identity.
Do not claim a separate OAuth-state validation solely from a config comment.

Salla webhooks validate HMAC signatures and synchronize via the queue.
`_shared/sallaTokenVault.ts` uses guarded token RPCs and has compatibility handling
for older schema representations. Preserve deployment compatibility; do not treat
the fallback as permission for new plaintext token storage.

### Omniful

`manage-omniful-amazon` supports central-account and merchant-account modes,
encrypted account credentials, channel discovery and scoped channel assignments.
Central tokens require a safe store/seller scope; provider identity that needs
review must not be treated as a verified tenant mapping.

Synchronization compares provider orders against canonical orders and writes
`omniful_order_observations` with shadow/match state. It does not write canonical
`orders` or rebuild financial sales. Adding provider names/capabilities does not
authorize promoting this feed. Actual merchant enablement is `NEEDS_CONFIRMATION`.

### File-only and retired paths

Amazon/Noon report imports remain in `platformParsers.ts` (Amazon also has the
SP-API connection and sync above); other named parser
formats are not evidence of direct provider APIs. The migration
`20260810180331_remove_retired_integrations_and_billing.sql` contains SQL to remove
retired provider/billing paths while keeping imported data. Whether that migration
has run in Production is `NEEDS_CONFIRMATION`. Do not resurrect removed
direct integrations or paid-subscription behavior from baseline tables or old docs.

## Credentials and internal scheduling

- `credentialVault.ts` encrypts credential payloads with AES-GCM. It accepts a
  configured encryption key or derives a fallback from the service-role key.
  Changing either key can affect existing ciphertext: rotation requires a
  reviewed migration/re-encryption plan.
- New platform credential writes use encrypted `extra.secret_blob`; compatibility
  reads and queue sealing of legacy columns exist. Browsers receive safe metadata.
- `QUEUE_WORKER_SECRET` is read from `app_settings`, not from a frontend variable.
  The worker accepts dedicated internal authorization or service-role bearer;
  public anon credentials must never become worker authorization.
- Queue dispatch maps Salla, Trendyol and Amazon, not Omniful. SQL cron/
  `pg_net` authorization and timeouts are versioned in migrations.
- See [environment inventory](DEVELOPMENT.md#environment-inventory) for names only.
  Provider credentials also live in protected DB records; an env-name inventory
  is not a complete list of merchant credential fields.

## Public service requests

[pricing-request](../supabase/functions/pricing-request/index.ts) accepts only
published forms. POST validates question types/options/required fields, a honeypot,
minimum completion time and a source-hash rate limit. Attachments are PDF/JPEG/PNG,
up to 5 MiB each and 15 MiB total, stored privately. Failed submission persistence
has cleanup logic; do not describe Storage plus SQL writes as one DB transaction.

[ServiceRequestsView](../src/pages/admin/ServiceRequestsView.tsx) manages the
forms, stages and follow-up through administrator RLS. Preserve the separate
public Edge entrypoint; do not grant anonymous table or bucket access.
[e2e/service-request-flow.spec.ts](../e2e/service-request-flow.spec.ts) mocks
the function response and does not prove live rate limiting or storage isolation.

## Multiple selling accounts: server contract

The reliability branch adds `manage-marketplace-accounts` for safe account
metadata, and requires an explicit `marketplace_account_id` for connection and
account-specific actions. Old sync callers may omit a selector only when exactly
one active identified account exists. Amazon state includes the user, workspace
and account, expires, and is consumed once. Reconnect cannot replace the verified
seller identity with another seller. Disconnect retains merchant facts and rejects
an active sync lease; provider secrets are never returned to the browser.

Trendyol/Salla synchronization and signed webhooks propagate the verified account.
Failed Salla fetches/database writes no longer report successful completion, and
order updates preserve stored fees. Analytics rebuilds from persisted facts.
Account-specific Trendyol listing IDs must be reverified by sync before updating
existing content, pricing or inventory. No live provider write was used to test
these paths.

**NEEDS_CONFIRMATION — Salla production onboarding:** the owner does not know
whether the Sellpert app is published with Easy Mode or still a test Custom Mode
app. Rakan must supply its publication/onboarding mode from Salla. The existing
onboarding flow is retained; no new production second-store Custom flow or
unverified ownership association is enabled. The schema and fact isolation can
represent multiple Salla connections, but that does not establish a working
second-store production onboarding journey.
