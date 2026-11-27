# Production releases

This runbook describes repository behavior reviewed on 2026-09-05. It is not
authorization to deploy or apply migrations. Follow [AGENTS.md](../AGENTS.md):
deployment, applying any migration (including locally), history repair and
Production changes require an explicit user request for the action and target.
Destructive migrations/production-data changes also require explicit approval
of the concrete change.

The committed workflows target Vercel for the browser bundle and Supabase for
Edge Functions/database migrations; application code uses Supabase Auth and
Storage too. These files establish the intended deployment split, not the current
live deployment. Actual hosting, active workflows, deployed versions, provider
enablement and applied migrations are `NEEDS_CONFIRMATION`. A browser deployment
does not execute this repository's Supabase release script.

## Workflow triggers and prerequisites

| Workflow | Configured trigger / behavior if executed |
| --- | --- |
| [CI](../.github/workflows/ci.yml) | Push to main/master and PR: npm checks, browser journeys, isolated SQL tests and Deno checks |
| [Vercel release](../.github/workflows/vercel-release.yml) | Matching frontend/config/lockfile paths on main/master, or manual dispatch |
| [Supabase release](../.github/workflows/supabase-release.yml) | Matching functions/migrations/config/release-script paths on main/master, or manual dispatch |
| [Production smoke](../.github/workflows/production-smoke.yml) | Main/master push, every 15 minutes, or manual dispatch; can create/comment/close incident issues |
| [Schema recovery drill](../.github/workflows/schema-recovery-drill.yml) | Matching schema/test/script changes, weekly or manual; isolated rebuild and SQL checks |

Release YAML declares GitHub environment `production` and serializes each runtime's
releases with `cancel-in-progress: false`, and fail when required deployment
secrets are missing. Vercel and Supabase do not share one release lock.

Both release workflows first require successful **push CI for the exact commit**
using [the release gate](../scripts/wait-for-release-ci.mjs). A successful PR run,
another commit, failed/cancelled CI, or an API error cannot authorize deployment.
Manual dispatch uses the same gate. Actual protected branches, required checks,
environment restrictions and approval enforcement must also be verified in GitHub.
A push can trigger production: commit/push authorization is not implicit in a
local development or documentation request.

## Configuration names only

- Supabase release requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.
- Vercel release requires `VERCEL_TOKEN`; `VERCEL_ORG_ID` and
  `VERCEL_PROJECT_ID` are workflow metadata.
  These three deployment secrets are stored in the `production` GitHub environment
  (repository secrets also resolve if no environment override exists).
- The browser client requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  at module initialization. Supply them to its intended build environment; a
  successful bundle build alone does not prove they exist or identify the correct backend.
- Edge provider secrets are separate; see [Development](DEVELOPMENT.md#environment-inventory).

Do not put deployment secrets in source, browser-prefixed variables or public
logs. Presence checks must not print values. Live Vercel project configuration,
preview/staging separation and Supabase secrets are not established by this file.

## Vercel behavior

The workflow specifies Node 22 and Vercel CLI 58.5.1 with production mode.
It supplies `VERCEL_GIT_COMMIT_SHA` from GitHub's immutable commit context.
[vite.config.ts](../vite.config.ts) actually defines the client release using
`VERCEL_GIT_COMMIT_SHA`, then `GITHUB_SHA`, then its local fallback. Preserve
release attribution and verify the deployed immutable release after an authorized
release; do not assume supplying a similarly named variable is sufficient.

Before deploying, the workflow authenticates to Vercel and checks that team
`team_RnIh0txGDI26IavAcpabyqCs` owns project
`prj_Upq6kKTrMOC3NEfe2NMlrMFEiv8D`, named `sellpert`, linked to
`a2030i/sellpert`. Failure stops the release without printing provider responses.
This preflight reads the project's `accountId`; it does not require permission to
list team members. Team membership management requires separate Owner access.
`vercel.json` disables native Git deployments for main/master. Production deploys
through the CI-gated Actions workflow; other branches retain native Git previews.
This avoids duplicate deployments and ensures the immutable merged commit passes
CI before publication. Do not merge this cutover before verifying an Actions release.

## Repository reviews and platform access

[CODEOWNERS](../.github/CODEOWNERS) suggests reviewers for database, financial,
identity, credential and release paths. By the owner's explicit decision, human
approval is optional for all changes: set `required_approving_review_count: 0`,
`require_code_owner_reviews: false`, and `require_last_push_approval: false`.
Either maintainer may merge their own PR after the required checks pass; a review
request from CODEOWNERS does not itself require approval.

Keep main protection enabled: require `checks`, `database-security`, and
`edge-functions` from GitHub Actions, an up-to-date branch and resolved conversations.
Protect administrators too; prohibit force pushes and branch deletion. Optional
peer review does not waive AGENTS.md's explicit authorization requirements for
production, migrations or destructive changes, or the production parity guard.

The repository currently belongs to personal account `a2030i`. GitHub supports
owner and collaborator access for personal repositories; a second repository
Admin requires a separately authorized organization transfer. Do not claim that
CODEOWNERS grants administrative access or transfer ownership during this setup.

[Platform access verification](../.github/workflows/platform-access.yml) runs only
by manual dispatch on main, uses production secrets and emits limited status only.
`verify` reads the Vercel target/member status and Supabase organization membership.
`invite-rakan` additionally invites/promotes only `rakan@sellpert.com` to Vercel team
Owner, preserving other owners. Only dispatch it with an explicit owner request.
Invitation sent, invitation pending and accepted membership are distinct states.
Supabase invitations are managed in the organization's dashboard; the workflow
only checks its member list. It does not change billing or database contents.

[vercel.json](../vercel.json) declares SPA rewrites, security headers, CSP and
immutable hashed-asset caching. Their presence on a live response is
`NEEDS_CONFIRMATION` until verified against an authorized target. Keep browser bundle and CSP changes
consistent. There is no repository-defined staging release workflow.
Do not change custom domains or Vercel/Supabase targets by inference.

## Supabase release order

[scripts/deploy-supabase-release.ps1](../scripts/deploy-supabase-release.ps1)
contains a default project reference intended for production (the live target
identity is `NEEDS_CONFIRMATION`); it is not a local setup
command. After explicit authorization and checks, it:

1. Links the target project.
2. Runs [migration parity verification](../scripts/Test-SupabaseMigrationParity.ps1).
3. Performs a dry-run database push.
4. Deploys backward-compatible Edge Functions.
5. Applies forward, committed migrations.
6. Deploys Edge Functions again against the final schema.

Phase-one functions must support both pre- and post-migration representations.
The parity script rejects unparseable history and any missing local timestamp
older than or equal to the latest remote timestamp. It intentionally does not
use `--include-all`.

When history differs, stop. Never mark history applied merely to make CI green.
Any repair needs per-migration evidence of equivalent final schema effects and
explicit authorization. Do not bypass the guard with ad hoc production SQL.
If a backend release fails, investigate before assuming a browser-only retry can
resolve it. Roll-forward or retry operations still require explicit authorization
covering the concrete action; this recovery advice is not permission to deploy.

The separately reviewed [Amazon-only exception proposal](AMAZON-RELEASE-EXCEPTION.md)
does not change these rules. Its manual workflow requires explicit owner approval
of that exact exception and manifest; ordinary release authorization is insufficient.

The separate [Amazon synchronization proposal](AMAZON-SYNC-RELEASE-PROPOSAL.md)
covers only `20261127090000` and its three named handlers. Its manual workflow
pins the reviewed main commit and immutable SQL bundle, requires new approval
of that specific exception, and preserves the ordinary parity gate. Approval of
the earlier Amazon connection exception does not extend to this proposal.

## Historical production state — NEEDS_CONFIRMATION

The previous runbook recorded a 2026-08-05 production-history mismatch after
adopting the rebuildable baseline: equivalent changes could have different
timestamps and local bootstrap/restore migrations could reconstruct effects
already present remotely. It recorded an independently applied
`explicit_data_api_grants` under timestamp `20260805022434` and described
live grant/RLS checks at that time.

Those are historical operator notes, not newly verified facts. Do not use old
table counts or that timestamp as proof of today's parity or permission state.
Resolve the current status through an explicitly authorized comparison before
a database release.

## Verification, incidents and recovery

The smoke script is written to check application availability, security headers, release
attribution and anonymous authorization boundaries. It is a production-targeting
operation and can send requests to backend endpoints; it is not a substitute for
isolated local tests. The workflow includes GitHub incident writes when it runs;
its actual execution history and outcomes are `NEEDS_CONFIRMATION`.

See [Incident response](INCIDENT-RESPONSE.md) for triage and
[Disaster recovery](DISASTER-RECOVERY.md) for schema versus data restoration.
A successful isolated rebuild does not prove backup retention, Storage object
recovery, PITR configuration or an achieved RPO/RTO. These remain operator
confirmation items in [Development](DEVELOPMENT.md#needs_confirmation-register).

## Coordinated account-identity release

PR #23 uses the separately authorized sequence documented in
[the recovery record](PRODUCTION-HISTORY-RECOVERY-2026-11-27.md#owner-authorized-coordinated-execution).
Its new handlers require the account schema, so they deploy during API maintenance
before the matching frontend. A merge commit tagged `[coordinated-backend-ready]`
skips the ordinary Supabase job after that backend has already passed parity.
This does not waive the parity guard for subsequent releases.
