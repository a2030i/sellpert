# Amazon synchronization release proposal — new approval required

This is a review artifact, not permission to release. It covers only migration
`20261127090000_enqueue_amazon_sync.sql` in Supabase project
`urdyzbsukcuibadlaath`. The previous exception approved only migration
`20261126120000`. The owner has requested this synchronization release, but
that request does not extend the previous one-time migration-parity exception
to this new immutable bundle. Approval is needed only for this specific exception. No production mutation was executed while
preparing this proposal.

## Why the ordinary release is still blocked

The read-only 2026-11-27 comparison finds 162 local migration files, 226 remote
history rows, 124 local historical versions absent remotely, and 189 remote-only
versions. The only pending local version newer than the latest remote version
is `20261127090000`. The normal parity gate must continue to reject this state.
The older broad recovery proposal did not establish sufficient per-entry proof;
this proposal neither accepts nor executes it. No history repair, pricing change,
bootstrap replay, or unrelated policy reconciliation is included.

## Exact database effect

The live scheduler definition exactly matches the reconstructed local definition:

- Before SHA-256: `6087384485f9159a1c4e94838f8558ce764c78c250f691047f56baa1cf79f882`.
- After SHA-256: `76cc71419ab4b62bdae012732105223941ba282ac36a76674c5f8ca641f3ef50`.
- Exact migration SHA-256: `b59cfe4d9583b41eb7d6253c971b90099f5fd4cac50fbd1b9923e4a3ddd38384`.

The only body change is `credentials.platform = 'trendyol'` to
`credentials.platform in ('trendyol', 'amazon')`. It retains active credentials,
active merchants, active workspace status, the twenty-minute freshness gate,
three-minute upper-bound lag, existing job payload/priority, and suppression of
pending/processing/running jobs for the same merchant and platform. The function
retains SECURITY DEFINER, an empty search_path, owner postgres and execute access
only for postgres/service_role. Sequential deduplication is tested; this change
does not introduce an atomic uniqueness guarantee for concurrent scheduler calls.

The existing scheduler cron is active every thirty minutes. Therefore committing
this SQL enables automatic Amazon jobs; it is not merely a dormant schema change.
Read-only aggregate inspection found zero active Amazon connections. The apply
transaction requires that condition still hold, taking a short shared lock on
platform_credentials to prevent a concurrent connection becoming active between
that check and commit. If any active Amazon connection exists, stop and obtain a
separately reviewed rollout scope; do not weaken this assertion.

## Proposed execution order after explicit approval

1. Finish reviewing the final code changes and required checks. Pin the exact
   deployable commit, including any subsequent MFA/lease changes, separately from
   the migration source commit. This proposal was prepared from
   `ba825b265cd29e67fbdb4bbcdb422305fc4ea5db`; it does not certify later code changes.
   The reviewed handler limits synchronization to Amazon Saudi Arabia and rejects
   foreign-currency amounts because current reports aggregate in SAR; this release
   does not introduce exchange-rate conversion or support other Amazon markets.
2. Use the new [release-amazon-sync-exception.mjs](../scripts/release-amazon-sync-exception.mjs)
   runner and [amazon-sync-targeted-release.yml](../.github/workflows/amazon-sync-targeted-release.yml)
   manual workflow. The previous Amazon-connection runner/workflow remain unchanged.
   Inputs are `mode` (inspect/apply/verify), the exact `manifest_sha256`, and
   `reviewed_source_commit`. The latter must be forty lowercase hexadecimal
   characters and equal both the workflow's main commit and checked-out HEAD.
   This check runs before any production operation; apply and the deployment
   helper check it again. The workflow uses the production environment, read-only
   repository permissions, and shared backend release concurrency. A changed main
   commit fails closed until its exact source is reviewed and supplied explicitly.
   Raw provider responses and CLI diagnostics are suppressed.
3. Keep merchants from beginning Amazon connections during this short maintenance
   window. Run the bundled SELECT-only inspection. All seventeen predicates must
   pass immediately before applying. Do not infer approval from a successful check.
4. The [deploy-amazon-sync-functions.mjs](../scripts/deploy-amazon-sync-functions.mjs)
   helper deploys exactly `sync-amazon`, then `amazon-connect`, then `queue-worker`,
   sequentially, from the reviewed commit. Each CLI call targets only the named
   function and this fixed project. It retains JWT verification, has a bounded
   timeout and stops on the first uncertain result without retrying. The previous
   worker treats unknown platforms as completed jobs, so the consumer and worker
   must be deployed before SQL enables scheduling. A successful deployment command
   is followed by the database precondition recheck before applying; deployment
   version metadata still needs review as part of the final release evidence.
5. Execute exactly the bundled apply transaction, once, after owner approval of
   this new exception. The transaction performs its own preconditions again,
   changes the scheduler, inserts one exact migration-history row, checks all
   postconditions, and commits. Preserve all 226 existing ledger rows, including
   their names, statements and any other existing columns. The new row records
   the whole exact migration SQL as one statements entry and name
   `enqueue_amazon_sync`; the final count must be 227.
6. Run the bundled SELECT-only verification in a fresh request. All sixteen
   predicates must pass. Verify immutable Edge deployment versions and the UI
   before declaring the release complete. Only then arrange a separately agreed
   consenting-merchant connection/sync; mocked/local tests are not live Amazon
   validation. Do not perform provider writes as a release test.

No code deployment or SQL execution in these steps has been performed by this
review. `NEEDS_CONFIRMATION`: final reviewed code commit after integration, explicit
owner approval, actual handler versions, and consenting-merchant scope. The runner,
manual workflow and tests are implemented locally and ready for review; they have
not been dispatched.

## Transaction safety and limits

The immutable bundle is in
[`scripts/releases/amazon-sync-20261127`](../scripts/releases/amazon-sync-20261127/manifest.json).
Manifest SHA-256:
`252511cd8653b74dd166496ba2867b06cf527d8c473fddd3481e9abf4fa6ff3c`.
The manifest hashes `inspect.sql`, `apply.sql` and `verify.sql`; it also records
both scheduler fingerprints, the migration hash and the complete original ledger
aggregate hash. The historical mismatch remains after this release by design.

The transaction uses statement_timeout=60s, lock_timeout=5s, a transaction advisory
lock `(20301127,90000)`, a shared lock on platform_credentials, and SHARE ROW
EXCLUSIVE locks on sync_queue and the migration ledger. These locks can briefly
block credential updates and queue processing; lock contention fails closed.
They do not authorize stopping unrelated production jobs or changing cron.

Postconditions preserve exact fingerprints for all other public/security routines,
relation ownership/privileges/RLS/options/view definitions, columns and column
privileges/defaults, constraints, indexes, policies and noninternal triggers.
No production-only policy or grant is removed to force repository parity.

System-catalog locks are unavailable to the production postgres actor. An operator
must prevent concurrent manual DDL for the short release window in addition to
the shared GitHub release concurrency lock. An advisory lock alone does not stop
uncooperative administrator sessions. The bundle does not pretend to solve this.

The apply request must have a client deadline greater than the SQL deadline
(e.g. ninety seconds) and leave database timeout enforcement enabled. Never
retry automatically after an ambiguous HTTP result or a failed verification.
Inspect whether the exact new history row and post-fingerprint exist before
reviewing further action. Do not remove a committed history row or reverse the
scheduler automatically: queued work and imported data require a separate plan.

## Evidence actually collected

- Live read-only inspection: all seventeen predicates true, including exact
  scheduler/metadata, full original 226-row history, active thirty-minute cron,
  absent new version and zero active Amazon connections.
- Local synthetic scheduler regression: active/null/stale eligibility, inactive
  credentials, inactive merchants, suspended workspaces, recent and exact-boundary
  timestamps, pending/processing/running suppression, completed-job retry,
  independent platform eligibility, preserved Trendyol scheduling, job shape,
  service-role-only access and sequential duplicate prevention.
- Full isolated SQL suite: 48/48 passed. Each test applied the new migration inside
  its own rollback transaction; no permanent schema or fixture changes remain.
- Bundle rollback test: seventeen preconditions and sixteen postconditions pass,
  including exact new history content. Only local catalog and local ledger hashes
  were adapted in the test copy; the proposed production bundle retains the actual
  production fingerprints. Wrong search_path, existing active Amazon connections
  and a repeated migration all fail closed. The original local scheduler hash was
  verified after rollback.
- Node 22 release/deployment tests: 23/23 passed. They cover exact source pinning,
  artifact hashes/target/version, real bundle integrity, strict Boolean response
  shapes, no secret/response disclosure, uncertain results without retries,
  deployment order/exact three-function scope, stopping after each possible partial
  deployment failure, and manual workflow ordering/concurrency. These are mocked
  request/process tests; no deployment command or Management API mutation ran.
- `git diff --check` passed. No production DDL/DML, secret read, provider call or
  live customer test was performed.

Read-only role metadata also shows authenticator statement_timeout=8s and
lock_timeout=8s, no service_role timeout override, and no applicable database-level
override. The Management API inspection session has a separate two-minute
statement timeout. This is configuration evidence; it is not a measured effective
PostgREST service-request deadline or proof that aborted HTTP requests cancel SQL.
