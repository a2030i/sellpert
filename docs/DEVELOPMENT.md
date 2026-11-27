# Local development, checks and unresolved facts

## Toolchain and setup

Run commands from the repository root. Sources:
[package.json](../package.json), [package-lock.json](../package-lock.json),
[CI](../.github/workflows/ci.yml), [Vite](../vite.config.ts).

- Package manager: npm; lockfile version 3. Use `npm ci` to reproduce the lock.
  There is no `packageManager` field pinning npm.
- Manifest requires Node `>=22`; CI selects Node 22. Locked Vite/plugin-react/
  Rolldown require at least Node 22.12 within that line. Use Node 22.12+ in the
  CI line rather than assuming any Node 22 patch or later odd major is compatible.
- TypeScript uses strict checking and noEmit. Build runs TypeScript then Vite.
  ESLint covers `src`; it does not replace Deno checks of Edge Functions.
- Supabase client is pinned to 2.104.0 in browser and Edge imports. Deployment
  contract tests verify this relationship. Preserve lockfile/override intent.

Local frontend configuration is documented as root `.env`; Vite uses default
env loading (no custom `envDir` or script-selected mode). `.env.local` is also a
local override; mode-specific files and existing process variables can take
precedence. Keep these files untracked. Do not promise that a checkout contains
one merely because an old README said it did.

Check required variable presence without printing values. If absent, stop and
report names. Do not generate fake credentials or copy CI placeholders into
a developer's environment.

```sh
npm ci
npm run build
npm run lint
npm test
```

For an authorized local interactive session, `npm run dev` starts Vite on port
5173. `npm run preview` serves an existing build locally; neither command deploys.
Do not start servers when the task only requests static checks.
`npm run build` creates `dist/` but does not start production.

## Environment inventory

Names only; no values belong in these docs or agent output. Requiredness below
describes the consumer, not an instruction to configure every integration locally.

| Scope | Names | Requiredness / source |
| --- | --- | --- |
| Browser client | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Required by `src/lib/supabase.ts` at module initialization, including tests that import it |
| Build release identification | `VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA` | Vite defines the client release from these with a local fallback; the Vercel workflow supplies the immutable GitHub SHA as `VERCEL_GIT_COMMIT_SHA` |
| Browser tests | `PLAYWRIGHT_PORT`, `CI` | Optional runner settings in `playwright.config.ts` |
| SQL tests | `DATABASE_URL` | Optional override in `scripts/run-database-tests.sh`; default is the local Supabase DB. Never point tests at production |
| Edge runtime | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Used by privileged handlers; server only |
| Selected Edge handlers | `SUPABASE_ANON_KEY` | Used by create-employee, manual-entry and test-platform-connection; separate from the browser-prefixed name |
| Credential encryption | `PLATFORM_CREDENTIALS_ENCRYPTION_KEY` | Configured key or service-role-derived fallback in `credentialVault.ts`; rotation is sensitive |
| Salla / redirects | `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET`, `SALLA_WEBHOOK_SECRET`, `APP_URL` | Conditional on Salla/account link flows; selected DB settings take precedence in `getSettings.ts` |
| Amazon SP-API | `AMAZON_SP_APP_ID`, `AMAZON_SP_LWA_CLIENT_ID`, `AMAZON_SP_LWA_CLIENT_SECRET`, `AMAZON_SP_REDIRECT_URI`, `AMAZON_SP_APP_DRAFT` | Environment fallback when no encrypted `AMAZON_SP_APP_CONFIG` record exists. Admins can save the three keys together at `/admin/amazon`; that server-only encrypted configuration uses the fixed app.sellpert.com callback and draft mode. Environment-only draft mode stays on unless set to `false`. No complete configuration means the merchant card shows preparation status. |
| Trendyol webhook | `TRENDYOL_WEBHOOK_SECRET` | Conditional provider authentication; handler also consults protected configuration |
| Omniful | `OMNIFUL_ACCESS_TOKEN`, `OMNIFUL_BASE_URL` | Central fallback/provider endpoint override; account credentials may instead be encrypted DB records |
| Public intake | `RATE_LIMIT_SALT` | Optional source-hash salt with code fallback |
| Supabase release | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Required by release workflow/script, not local frontend checks |
| Vercel release | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Token secret plus workflow project metadata; not browser config |
| Workflow-managed context | `GITHUB_OUTPUT`, `GH_TOKEN` | Workflow output and smoke-monitor issue management; not local app requirements |

Protected DB setting names include encrypted `AMAZON_SP_APP_CONFIG`, `QUEUE_WORKER_SECRET` and
`salla_app_store_url`, in addition to settings consumed by `getSettings.ts`.
Do not incorrectly require these as `.env` keys. Never put service-role,
provider, deployment or encryption credentials in a `VITE_` variable.

## Test matrix

| Change scope | Commands / coverage |
| --- | --- |
| Browser TypeScript, domain helpers, queries | `npm run build`, `npm run lint`, `npm test` |
| Focused unit regression | `npm test -- <test-file-or-filter>`; Vitest script already limits discovery to `src` |
| Rendered journeys/navigation/accessibility | `npm run test:e2e`; install matching Chromium first with `npx playwright install --with-deps chromium` when needed |
| Edge Function implementation | CI uses Deno 2.9.4: `deno check --node-modules-dir=auto supabase/functions/*/index.ts` |
| Shared Edge utilities | `deno test --node-modules-dir=auto supabase/functions/_shared/*.test.ts` |
| SQL/RLS/RPC/schema | CI declares Supabase CLI 2.111.0, `supabase start`, then `bash scripts/run-database-tests.sh`; needs Docker, psql and a disposable local DB. Locally, startup that applies migrations requires an explicit request first |
| Dependency changes | Above relevant checks plus `npm audit --audit-level=high`, as in CI |
| Every development handoff | `git diff --check`, review changed files/diff for scope and accidental sensitive content |
| Documentation only | Check referenced paths, commands against scripts/workflows, whitespace and documentation-only diff |

Vitest includes pure unit tests and source-text contract tests under
`src/lib/__tests__/`, plus `src/lib/dashboardEvidence.test.ts`. Text-contract tests
verify patterns; they do not execute RLS or an external API.

Playwright starts a local Vite server on loopback with desktop/mobile Chromium,
Arabic locale and Riyadh timezone. Tests mock Auth/PostgREST/Edge responses.
`authenticated-merchant.spec.ts` is explicitly skipped for advanced release
scope; some admin checks skip mobile. Do not report these as passing coverage.

Products load a complete paginated snapshot with a 20-second deadline for the
whole request group, cancel superseded/unmounted requests, and expose retry on
failure instead of accepting partial rows. Catalog preparation reads for Trendyol
(inventory, listings and mappings) run only for a single non-legacy Trendyol
account; they are unused in the other scope states. The product snapshot uses
`product_rows_by_account` to filter membership on the server before paging.
The displayed list and its counts use the complete selected scope. Unmapped manual products
remain in the legacy/unassigned scope. See [catalog identity review](CATALOG-IDENTITY-REVIEW.md).
`productCatalogLoad.test.ts` covers pagination, cancellation and incomplete loads;
the Products cases in `phase-one-merchant.spec.ts` cover completed lists and retry.

To test actual deployment recovery, independently build the previous and next
frontend revisions with synthetic Supabase configuration, then run:
`node scripts/test-deployment-recovery.mjs /previous/dist /next/dist`.
The script requires different hashed entry assets, opens the previous build with
an active service worker, replaces the served directory, and navigates to Products
whose old chunk now returns 404. It verifies one automatic reload into the new
build, preserved session/URL/account scope, and a searchable row beyond 1000 on
desktop and mobile Chromium. Auth and data responses are synthetic; this does not
verify live merchant permissions or establish recovery on an already-open live tab.

SQL tests in `supabase/tests/` exercise real DB roles, tenant boundaries and
functions using transaction fixtures and raised exceptions. The script runs
all SQL files with psql and stops on error. It is not covered by `npm test`.
Deno tests are likewise separate. A schema recovery drill rebuilds twice and
checks SQL invariants; it does not prove recovery of production merchant data.

Verification baseline on 2026-09-05: Node 22.23.2 / npm 10.9.8;
`npm ci`, build, lint and Vitest passed (79 files, 336 tests).
This was a local check, not a standing CI guarantee. Browser, Deno, SQL tests,
production parity and live provider behavior were not verified in that run.

## Environments and releases

Merchant review regression coverage is summarized in
[Merchant review follow-ups](MERCHANT-REVIEW-FOLLOWUPS.md). The focused browser
journey is `e2e/merchant-review-followups.spec.ts`; it uses synthetic data.

Repository release workflows target Vercel for the browser and Supabase for
backend releases; app code uses Supabase Auth/DB/Storage/Edge Functions.
Actual Production hosting, deployed versions and enabled integrations are
`NEEDS_CONFIRMATION`. [Production releases](PRODUCTION_RELEASES.md) describes
committed workflow definitions, not verified execution.
Repository config specifies PostgreSQL 17 for the local Supabase stack.

Local frontend configuration may point to any project: localhost hosting alone
does not make database/provider operations safe. Confirm the intended isolated
backend before interactive tests that can write.

## NEEDS_CONFIRMATION register

| Unverified fact | Evidence needed before relying on it |
| --- | --- |
| Live database equals committed migration effects/history | Authorized schema/history comparison; dated production notes already describe drift |
| Generated types match the intended deployment | Regenerate from a selected verified target and review the diff |
| Staging/preview backend and frontend environment isolation | Operator-approved environment inventory and actual Vercel/Supabase settings |
| GitHub production reviewers, branch protection and release gating | Repository/environment settings; release YAML has no dependency on completion of the separate CI workflow |
| Current backup retention, PITR, Storage backup, owner, RPO/RTO | Operator evidence and a tested isolated restore; see recovery runbook |
| Currently enabled Trendyol/Salla/Omniful accounts and provider scopes | Approved configuration/provider verification; code presence is not enablement |
| Email provider, redirect allowlist, public intake custom domains and published live form | Auth/DNS/provider/deployment settings; none proven by local route support |
| When advanced routes or Omniful canonical promotion should ship | Explicit product decision; current phase/shadow gates remain authoritative behavior |
| Public intake live abuse/storage behavior and complete backend validation | Dedicated handler/SQL checks and isolated integration evidence; mocked E2E is insufficient |

Applying migrations (including via local `supabase start`), history repair,
deployment and Production changes require an explicit request for the action and
target. Test commands above describe the CI procedure, not standing authorization
to apply schema changes. Read-only inspection and editing migration files do not
constitute permission to execute them.

Resolve these only when a task needs them; record evidence and update this
register. None authorizes production access, deployment or credential changes.

## Reliability/account expansion validation

See [the dated implementation record](OPERATIONAL-RELIABILITY-2026-11-27.md).
New focused SQL coverage is in `marketplace_accounts_catalog.test.sql` and
`service_request_recovery.test.sql`; shared-server coverage includes
`marketplaceAccountScope.test.ts`. Run shared Deno tests with `--allow-env` because
the encryption tests set and restore synthetic test key material. Never supply
production provider credentials to those tests. A targeted Vitest invocation is
`node node_modules/vitest/vitest.mjs run <file>`; appending a file to `npm test`
still includes the script's `src` discovery argument.
