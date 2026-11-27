# Operational reliability and account expansion — 2026-11-27

Status: implemented in the feature branch; **not deployed and not approved for
production**. Base reviewed: `e879bcb45c30405de70c2a93de9be51ea59d48c2`.
This record covers the findings transcribed in the conversation. The named full
HTML admin/merchant reports were not supplied as readable repository artifacts;
unquoted findings in those reports remain **NEEDS_CONFIRMATION**.

## Scope and acceptance record

| Finding / decision | Implemented behavior / acceptance evidence |
| --- | --- |
| Three merchant links fell back to home | Explicitly enable statement, security and store-status routes; other launch exclusions remain. Mock browser journeys verified reachability. |
| Pending-order count opened an empty list | Shared pending predicate and Riyadh period boundaries; dashboard drilldown carries the same platform/date scope. Account and order identity are separate. |
| Admin team loading did not recover | Bounded loads, explicit errors and retry; failure is not displayed as an empty/healthy dashboard. |
| Service requests absent in production review | Forward recovery migration creates the five documented tables only when all are absent, fails on partial absence, preserves existing data and restores RLS/MFA/private storage. Missing default form is seeded as a draft. Tested both missing and existing schema paths locally. Production application is unverified. |
| Missing product costs/prices and no search | Complete paginated loads, SKU/name search, missing-data filters and quality counts. No cost values are invented. Pricing excludes incomplete inputs and requires a specific account. |
| Misleading order/unit definition | Administration uses “حجم المبيعات المسجل” and explains source-dependent counts. Unique order operations use account/platform/order identity. |
| Import counters and drilldowns differed | Complete scoped upload counts; attention filter distinguishes failed/stalled attempts, including the date/platform/merchant filter set. Historical failed attempts are not rewritten or deleted. Elapsed time includes waiting and is labelled accordingly. |
| Ads empty despite successful imports | Complete paginated fact reads and scoped canonical matching; later pages are not silently lost. Actual absent source rows/impressions remain a source-data issue, not fabricated metrics. |
| Noon calculator category unavailable | Reset category/model when switching platform, show failed reference loads with retry, and disable estimates while categories or fulfilment models are absent. Mocked retry verified 25 Noon categories; production reference completeness needs verification. |
| CTR denominator zero | Displays unavailable rather than 0%; valid zero ROAS remains 0.00x. |
| ROAS classification implied profit | Neutral ratio labels/explanation; no claim that a threshold proves profitability. Removed the unreachable adjusted-return panel querying a nonexistent relation. Product cost, fees and returns are required for profit. |
| Shipping summary and fulfilment table differed | Explicit separate period/status definitions, including 90-day shipped summary versus 180-day order records. |
| Inventory scopes and quick edits | Main/quick lists use active scoped rows; account+SKU records remain separate and show account labels. Quick edits compare the previously read quantity and report failed/stale rows. |
| Physical inventory could be double-counted | Reviewed physical-pool links deduplicate mirrored stock. Missing/unreviewed/stale/conflicting pools yield unknown availability. Channel totals are labelled observations. Multi-account purchase recommendations are gated rather than summed into a false physical purchasing plan. |
| Product matching and variants | Exact, account-scoped identifiers or confirmed manual mapping; no automatic name/model merge. Families group variants; size/color remain separate. |
| Virtual bundles | Versioned, immutable recipes/costs; no nested/self-referential bundles. Historical sale keeps its applicable recipe; missing history/cost is unknown. Capacity is computed from components, not additional stock. |
| Same-platform multiple accounts | Amazon/Trendyol connection identity, queue jobs, sync facts, webhooks, natural keys and report scopes carry account ID. Identical external order IDs remain separate. Specific account and combined identified-account reports supported; legacy sources are separate. |
| Cross-platform SKUs for one product | Canonical mapping aggregates different source SKUs into the same variant. Real SQL fixture verifies 2+3 units, revenue 100+150, cost 50, fees 12, profit 188; per-account report stays 100 revenue. |
| Provider content/price writes | Uses provider barcode/content ID from that account's verified listing; missing IDs require sync. Existing confirmations, audit and validation remain. No live provider write was tested. |
| Settlement and return accuracy | Settlement references include selling account identity; bank confirmations reserve a credit across all accounts and tenant/platform FKs reject mismatches. Return ratios use distinct account/order references; hypothetical commissions/shipping are not presented as incurred losses. Payout schedules are labelled workspace-wide; selected-account recent sales are not labelled unpaid balances. |
| Internal staff roles | Left unchanged as explicitly requested. No employee permission changes. |
| Account-security flow | Error/retry states; password reset uses the authenticated actor's verified email, not a viewed merchant identity. Live email delivery/session revocation not tested. |

## Tests and evidence

The frontend was tested against synthetic mocked Auth/PostgREST responses. An
independent Product Designer reviewed the approach before implementation, and an
independent reviewer tested the rendered UI afterward. The main follow-up review
passed 42 scenario/viewport combinations at 390/768/1440, with no JavaScript page
errors or document-level overflow. Eight additional pricing/inventory/comparison
checks and 18 final statement/fees/overview checks passed at 390/1440. Product
comparison was tested as an isolated component because its route remains hidden. Earlier separate passes covered the initial
reliability and catalog/account editor changes. These are not live API tests.

Local SQL was explicitly authorized and ran on schema-only clones of the isolated
repository test database, never production. The first 18 forward migration files were
applied in order on a fresh clone; the nineteenth bank-account migration was
then applied to that same clone and its authenticated isolation tests passed. The service-recovery path was also tested on a
second clone created without the service tables. Synthetic fixtures roll back.
The account/catalog SQL test executes read/write boundaries as `authenticated`,
not only as an administrator, including cross-tenant denial, immutable lineage,
shared stock, bundle cost snapshots and per-account financial totals.

Three configuration-only tests cannot pass on a schema-only clone: cron jobs,
the merchant-imports bucket row, and the provisioned queue worker secret are not
copied. The same tests pass on the existing fully configured isolated baseline.
No secret was copied or invented to make the clone pass. The default-privilege
probe is executed as `postgres`, the role used by the original migration setup,
with local schema CREATE access restored after the no-owner dump restoration.
Final local checks:

- Node 22, committed npm lockfile: `npm ci` passed, audit reported zero vulnerabilities.
- `npm run build`, `npm run lint`, and `git diff --check` passed.
- Full `npm test`: 93 files / 493 tests passed; the final financial identity and
  action-contract recheck passed all 26 selected tests after the settlement fix.
- Deno checks passed for 11 changed handlers; shared Deno tests: 68 passed.
- Playwright full suite: 42 passed, 64 pre-existing skipped cases; no failed cases.
  Includes desktop/mobile reachability for the three authorized routes.
- Release artifact/failure-path Node tests: 33 passed.
- SQL suite: 47 of 50 passed on the schema-only clone; the three configuration
  cases described above passed unchanged on the configured local baseline.
  The expanded account/catalog test was rerun after migration 19 and passed,
  including distinct same-reference settlements, single-use bank credits, and
  cross-tenant bank-match rejection.
- Independent rendered review: 42 broad follow-up combinations, eight focused
  pricing/inventory/comparison checks, and 18 final financial/error-state checks.
  No outstanding P1/P2 finding within those reviewed scenarios.

The initial browser fixtures still used pre-account RPC names and expected the
statement route to redirect home. Fixtures were updated for the new contracts,
with reachability assertions for the three authorized routes. Browser testing
also caught filter controls unmounting during overview reload; controls now stay
mounted while result data is hidden until the new request finishes.
 No authenticated production journey, real merchant link,
provider reconciliation or production schema equivalence is claimed.

## Remaining confirmation and operational boundaries

- **Salla onboarding — NEEDS_CONFIRMATION:** Rakan must confirm published Easy
  Mode versus test Custom Mode. The owner explicitly does not know. Existing
  onboarding is retained, but a new production second-store onboarding flow is
  not enabled until its provider-supported ownership mechanism is established.
- **Data completeness:** merchants must supply actual costs/prices and missing
  source reports/impressions. Code cannot reconstruct nonexistent business data.
- **Historical reconciliation:** old account facts are retained in legacy buckets.
  No automatic identity assignment to a newly linked account, source deletion,
  or cross-source deduplication is performed. Explicit reviewed evidence is needed
  for any future historical reassignment.
- **Purchasing:** physical availability is supported, but an automatically funded
  consolidated purchasing plan across shared multi-account pools is not asserted.
  Existing workspace-wide financing is shown only for a wholly legacy workspace;
  account-based cases show guidance rather than an unreliable recommendation.
- **Live acceptance:** Amazon connection and two-cycle real-data fee matching,
  login/reset delivery, Salla production mode, and actual enabled secrets/scopes
  require controlled live acceptance after release authorization. No live Amazon
  writes are permitted as a test.

## Production release proposal — approval still required

The manifest `OPERATIONAL-RELIABILITY-MANIFEST.json` enumerates this change's
forward SQL files and SHA-256 digests. It does not authorize applying them.
Follow `PRODUCTION_RELEASES.md`; historical Amazon-only exceptions do not cover
this change. Existing production migration-history drift is unresolved and the
ordinary parity guard must remain active. Do not bulk-repair the ledger or mark
old files applied. If parity fails, stop and obtain a separately reviewed,
explicitly authorized reconciliation/release decision.

This is a coordinated schema/handler/browser change. The new handlers depend on
new account columns and are **not phase-one compatible with the old schema**.
Do not run the ordinary two-phase deploy script unmodified or merge the frontend
into an automatically deployed main branch before the backend release is ready.
A concrete approved release must provide a maintenance window, verified target
`urdyzbsukcuibadlaath`, a usable backup/restore point, and a way to suspend imports,
provider webhooks/queue dispatch and merchant writes during cutover. Drain running
and pending old-format jobs first; do not guess their account identity. Then:

1. Run parity and prerequisite/duplicate checks; resolve any failure without
   bypassing guards. Reconfirm schema, existing account uniqueness, relevant
   grants and source constraints. Preserve the pre-release ledger and row counts.
2. Apply only the reviewed forward migrations, transactionally where feasible,
   through the approved release path. This retains original facts, introduces
   legacy source IDs, changes natural indexes, and creates metadata/recipe/pool
   structures. Account source columns and natural keys must be checked before
   resuming any old writer. Service recovery does not publish its draft form.
3. Deploy `manage-marketplace-accounts`, `amazon-connect`,
   `manage-platform-credentials`, `sync-amazon`, `sync-trendyol`, `salla-sync`,
   `salla-oauth-callback`, `salla-webhook`, `trendyol-webhook`, `trendyol-actions`,
   and `queue-worker`; confirm their safe configuration and versions.
4. Deploy the matching browser commit, require active browser sessions to reload,
   and smoke-test tenant/account scopes, imports, empty/error states, security,
   service-request administration and canonical variants with synthetic fixtures.
   Reverify provider listing identity through a controlled read-only sync before
   enabling existing listing writes. Resume scheduled work after those checks.
5. With owner-selected consenting test merchants, validate connection and
   account-specific reads. Match one month's sales and roughly ten Amazon fee
   examples against the provider. Do not run provider writes as tests. Record
   discrepancies and remaining unknowns; do not delete historical records.

Rollback is not dropping the new tables or deleting facts. Pause affected writers
and roll forward a reviewed correction; any actual restore/production-data change
requires approval of its concrete target and data-loss implications.
