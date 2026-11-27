# Product and architecture

Repository review: 2026-09-05, baseline commit `d9f07f3`. This describes source
behavior, not a verification of deployed services. Production deployment,
integration enablement, applied migrations and live settings are
`NEEDS_CONFIRMATION`; none follows from the diagram or source files below.
Start with [AGENTS.md](../AGENTS.md).

## Product and visible scope

Sellpert combines marketplace orders, catalog, inventory, advertising, imports
and operational/financial analysis for merchants, with a separate platform
administration console. The interface is Arabic/RTL. Platform support varies by
data source; an enum label is not evidence of a working external integration.

[App.tsx](../src/App.tsx) implements navigation using browser history and React
state, without a router package. `VALID_VIEWS` lists more routes than the
`PHASE_ONE_VIEWS` gate permits. `readView` and `goTo` constrain merchant navigation
to dashboard, integrations, orders, inventory, products, product catalog,
product detail, quick inventory, marketing and settings. Other destinations
fall back to dashboard. Do not expose them merely because their components exist.

| Surface | Implementation / behavior |
| --- | --- |
| Merchant launch interface | [DashboardV2](../src/pages/DashboardV2.tsx), Orders, Products, ProductCatalog, Inventory, Marketing, Integrations, Settings under `src/pages/` |
| Advanced merchant modules present in source | Statement, Actions, StoreStatus, StoreActivity, Team, AccountSecurity, CustomerService, Notifications, ProductCompare and others; normal navigation is phase-gated |
| Platform console | [AdminPanel](../src/pages/AdminPanel.tsx) composes `src/pages/admin/`: merchants/staff, imports, performance, tasks, inbound, integrations, service requests, audit and DB health |
| Public intake | [PricingRequest](../src/pages/PricingRequest.tsx) on `/pricing-request`, `/service-request`, or hosts beginning with `request.` / `quote.`; configurable form plus administrative follow-up pipeline |
| Account/public pages | Login/signup, `/auth/recovery`, `/privacy`, `/terms`; session/MFA/account state gates in App |

The current dashboard reads orders, order items, inventory, returns and catalog
mappings directly. Do not assume all screens consume `performance_data`.
Financial summary helpers and advanced pages still exist but are not a substitute
for tracing the actual launch dashboard query path.

## Runtime and data flow

```text
Browser: main.tsx → App.tsx → merchant page / AdminPanel / public intake
  ├─ supabase-js + user session → Auth / PostgREST tables, views and RPCs
  │                              → Postgres grants + RLS + security helpers
  ├─ private upload → Storage → import RPC → normalized rows + derived data
  └─ /functions/v1/<slug> → Deno handler → actor/tenant checks
                             ├─ privileged DB / Storage operations
                             └─ external provider API

Provider webhook / scheduled cron → validated handler / queue-worker
  → sync_queue → salla-sync or sync-trendyol → normalized rows + sync_logs
  → SQL aggregates and browser calculations → merchant/admin views

Omniful sync → observation tables + comparison against canonical orders (shadow)
Public intake → pricing-request → private documents + service_request_* tables
```

- [main.tsx](../src/main.tsx) installs theme/accent, client incident reporting,
  error/connectivity boundaries and the service worker, then mounts React.
- [supabase.ts](../src/lib/supabase.ts) creates one browser client with monitored
  fetch, persistent session, automatic refresh, PKCE, URL session detection and
  storage fallback (localStorage → sessionStorage → memory). Its TypeScript
  interfaces are hand-maintained; generated database types are not wired into
  `createClient`.
- Pages mostly use local React state/effects and direct queries; `src/lib/`
  contains reusable domain calculations, parsers, permission helpers and API
  adapters. There is no repository Node HTTP application server.
- [db.ts](../src/lib/db.ts) pages PostgREST results in batches of 1,000. Callers must
  provide deterministic ordering. It can return accumulated rows after an error;
  preserve explicit partial/unknown data states rather than assuming completeness.
- Heavy pages use lazy loading. [vite.config.ts](../vite.config.ts) separates
  Recharts/D3, Supabase and XLSX chunks. Fonts are packaged locally through
  `@fontsource-variable`; shared CSS/theme files live under `src/`.
- [public/sw.js](../public/sw.js) caches same-origin static assets and uses
  network-first HTML fallback, skipping non-GET and cross-origin requests.
  This does not implement offline marketplace operations.
- [clientIncident.ts](../src/lib/clientIncident.ts) and
  [apiMonitoring.ts](../src/lib/apiMonitoring.ts) send bounded, sanitized,
  deduplicated incident metadata. Keep query strings, raw errors and credentials
  out of telemetry. See [incident response](INCIDENT-RESPONSE.md).

## Page layout

Reachable merchant pages share the `merchant-page` frame in
[PageLayout.css](../src/components/PageLayout.css): a 1,344px maximum outer
width, 32px desktop gutters and 16px gutters at 900px and below. Use
`PageHeader` from [UI.tsx](../src/components/UI.tsx) for the page identity and
actions, and `PageLoading` when a page replaces its content while loading.
Product detail and the dashboard keep their specialized headers with the same
`merchant-page-title` typography. Narrow form bodies belong inside the frame;
Settings uses a 920px body aligned to the RTL starting edge.

AdminPanel owns the administrative page title and outer gutters. Child views
should use section headings rather than repeat the page title. Wide tables
scroll within their own containers; do not hide document overflow to conceal
unreachable controls. Public entry, legal and intake pages retain their separate
layouts. These layout conventions do not expand the launch navigation gates.

## Existing architectural decisions to preserve

These are observed implementation choices, not newly proposed architecture.

| Decision | Evidence and consequence |
| --- | --- |
| Browser data access with database enforcement | Supabase client, migrations and SQL tests: client filters are useful but cannot replace RLS/grants |
| Separate privileged server paths | Edge Functions and `security` schema RPC implementations prevent browser possession of service credentials |
| Two employee permission domains | `permissions.ts` is platform staff; `merchantPermissions.ts` is store employees; do not merge role semantics |
| Restricted launch navigation | App's phase gate and skipped advanced E2E suite preserve the current release scope |
| File imports as reproducible source records | Private archives and one atomic SQL commit preserve provenance and rollback |
| One canonical sales representation per platform | SQL rebuild source precedence avoids adding orders, financial transactions and reports together |
| Explicit uncertainty in business metrics | Financial/cost/coverage and freshness helpers distinguish unknown from zero |
| Omniful is a comparison feed | Handler writes observations with `canonical_write: false`; no automatic canonical order promotion |
| Independent web/backend release units | Vercel and Supabase workflows; compatible Edge Functions deploy before and after forward migrations |
| Security enforced by executable contracts | Vitest source-contract tests, Deno utilities and SQL role/tenant tests complement mocked browser journeys |

For database/business invariants read [Data and security](DATA_AND_SECURITY.md).
For supported providers and environment placement read [Integrations](INTEGRATIONS.md)
and [Development](DEVELOPMENT.md).

## Selling accounts and canonical variants (2026-11-27 working change)

The operational-reliability change introduces `marketplace_accounts` beneath a
merchant workspace. Platform is a provider type; an account is one seller/store
on that provider. Account IDs travel through OAuth, queue jobs, synchronizers,
webhooks, import provenance and fact queries. Identically numbered orders/SKUs in
two accounts are independent until a reviewed product mapping says otherwise.
Merchant report scope is one account or the aggregate of identified accounts.
Historical facts with unproven seller identity remain in separate legacy sources;
the UI does not silently add those to newly connected accounts.

`products.id` remains the canonical sellable variant. `product_families` groups
variants; color/size stay on the variant. Account-scoped exact identifiers or a
confirmed manual mapping connect provider listings to variants. Names/model codes
alone never merge variants. `product_bundle_versions` and components represent
virtual kits with immutable recipe/cost snapshots. Shared physical stock is
explicitly reviewed through `inventory_pools`/links, counted once per pool, and
shown as unverified if observations disagree, are missing or exceed two days.
A bundle's capacity is the minimum complete component capacity, not added stock.

The explicitly requested `/statement`, `/security`, and `/store-status` routes
are enabled by this change. Other launch exclusions remain unchanged. Internal
staff roles are unchanged. See [implementation/release record](OPERATIONAL-RELIABILITY-2026-11-27.md)
for tested behavior, limitations and the production boundary.
