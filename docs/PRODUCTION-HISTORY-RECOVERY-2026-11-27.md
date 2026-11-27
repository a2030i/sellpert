# Production history reconciliation and PR #23

The owner approved deployment, then approved the explained history-reconciliation
work with “موافق ع كل شي”. Do not request that same authorization again. This
record documents preparation and actual verification; **no production schema,
history, merchant data, function deployment or main-branch merge has occurred**.

Target: `sellpert`, `urdyzbsukcuibadlaath`. Functional changes remain in
[PR #23](https://github.com/a2030i/sellpert/pull/23).

## Verified starting state

The production ledger contains 227 records, through `20261127090000`. The original
PR #23 branch has 124 historical local versions absent remotely, 189 remote
versions absent locally, and 19 genuinely forward functional migrations. Timestamp
differences alone do not establish missing schema effects.

The unchanged `Test-SupabaseMigrationParity.ps1` was actually executed on GitHub
against the captured production version list and rejected the 124 missing
historical versions. This supersedes the earlier local set-comparison-only
evidence. [Read-only inspection run](https://github.com/a2030i/sellpert/actions/runs/45998898241).

The same run read production history successfully but the backup metadata endpoint
returned **HTTP 403**. A usable backup/restore point remains **NEEDS_CONFIRMATION**.
The required missing token permission for that endpoint is `backups_read`;
existing deployment permissions must be retained. No backup contents or customer
rows were downloaded. The operator has been asked to update the token securely.

Fresh catalog fingerprints match the previous Amazon-sync release baseline.
Comparison with the older recovery review shows only the two already approved
Amazon changes: OAuth/import boundaries and the queue scheduler. No additional
column, index, policy or routine drift was found in that comparison.

## Reviewed corrections and retained behavior

The [manifest](../scripts/releases/recovery-20261127/manifest.json) identifies the
artifacts and current readiness. The four archived corrective migration files
retain their originally generated versions and contents:

- `20261126092419`: reconstruct 17 existing analytics views and eight routines
  omitted from the rebuild baseline. Matching production objects are preserved;
  an unexpected definition fails closed.
- `20261126092426`: restore the private cost-update implementation and public
  wrapper, two merchant sales-target write policies, and the hidden-customer-name
  constraint. A fresh aggregate found no rows violating the constraint. No
  automatic customer-name cleanup or cost update is performed.
- `20261126092919`: preserve correct internal deletion delegation and immutable
  UUID audit attribution; repair future Arabic fallback messages. These are
  definition changes, not deletion or modification of existing merchant records.
- `20261126094647`: preserve three existing merchant-argument guards and repair
  two future Arabic fallback labels without changing financial formulas.

The new `20261127123615_preserve_reviewed_policy_contracts.sql` represents the
existing production policy definitions in a clean rebuild. Each of its 259
entries accepts only the reviewed old baseline or current production state. A
matching live policy is not dropped or replaced. A third state aborts the entire
transaction. It does not change table grants, staff roles or customer rows. New
account policies and the intentional service/MFA/sales-target corrections are
excluded from this compatibility operation.

This records existing broader staff capabilities instead of silently narrowing
them or pretending that their predicates are identical. The owner's decision to
leave staff roles unchanged remains in effect. A future least-privilege review
must address those capabilities explicitly. Rebuilding this baseline must also
preserve the existing tenant, section-permission and MFA restrictions.

The 189 local history markers contain comments only. They preserve the original
remote version and recorded SQL hash; they never replay historical SQL. In
particular, the old billing/provider retirement deletes and Omniful trial seeds
must never be rerun as part of reconciliation.

The per-entry inventory covers the original 124 missing historical versions:
60 have exact recorded SQL counterparts, 11 differ only in leading comments, and
51 require final-effect/supersession evidence. The remaining two are the missing
service schema and late-table boundaries. Reconciliation remains conditional on
the corrected catalog and individual receipts; the inventory is not an executor.
The five additional corrective migrations have their own hashes and execution
records and must not be falsely represented as previously executed.

Service recovery must use the reviewed draft-form behavior from PR #23, preserve
existing service configurations, and fail on partial schema absence. It must not
publish a public intake form by replaying the old pricing seed. The late-table
MFA and private Omniful policies must be validated after recovery, not added twice.

## Local evidence

Two isolated schema-only databases were tested; no production customer data or
secrets were copied. One uses the rebuild baseline. The other uses the actual
production public-policy definitions before applying corrections and PR #23.
All four archived corrections and all 19 functional migrations applied on both.
The policy compatibility migration then applied and repeated successfully on both.

On the production-policy fixture, a repeat preserved every policy OID and
definition. An intentionally changed policy caused the migration to abort; the
rollback preserved the complete pre-test policy catalog.

An actual Supabase CLI 2.111.0 dry-run against an isolated timestamp-only ledger
reproduced the history failure, then accepted the proposed bidirectional history
shape and listed exactly the 19 functional migrations plus the policy-compatibility
migration. The 128 simulated historical entries comprise the original 124 plus
four corrective files. This proves CLI ordering compatibility only; the synthetic
ledger contains no production statements and does not establish per-entry live
schema equivalence. An initial attempt used an obsolete local forwarded port and
failed to connect; the recorded successful run used the verified local container
address. Neither attempt contacted production.

Both final fixtures passed 47 of 50 SQL suites. The three unavailable configuration
fixtures are the cron job catalog, the merchant-imports bucket configuration and
the queue-worker secret. These are not copied into schema-only clones. They had
passed on the configured local baseline. The local `postgres` schema-CREATE grant
needed by the default-privilege test was restored in the disposable fixtures; it
did not change production permissions. These tests establish local behavior, not
live provider or customer-data acceptance.

The pre-recovery PR commit `abb308b3ae7d13783164c6a3c6b05d9d56f76fe7` passed all
three CI jobs, including the complete isolated SQL suite. The correction files
added afterward require their own fresh CI run before release.

## Execution prerequisites still open

1. Verify a usable restore point through authorized backup metadata access.
2. Complete the reviewed transaction and maintenance cutover. Suspend old-format
   queue dispatch/import/webhook writers, drain active jobs, and prevent merchant
   writes across the schema/handler transition. A point-in-time empty queue does
   not establish a maintenance boundary.
3. Check the target and original 227 row hashes immediately before applying any
   correction. Apply only reviewed SQL, validate final effects, and record each
   reconciled version with its own proof and receipt. Never bulk-mark unverified
   history. Preserve every original ledger row, including statements and name.
4. Run the unchanged parity guard and CLI dry-run against the resulting history.
   Coordinate the 19 functional migrations, compatibility correction, 11 handlers
   and matching browser release as described in the operational release record.
   New handlers require the new account columns; ordinary deploy-first ordering
   is not compatible with this change.
5. Verify deployed versions and live read paths before resuming work. No marketplace
   write may be used as a test. Real Amazon reconciliation and Salla app-mode
   confirmation remain separate acceptance items.

The production permission failure is an access limitation, not a new request for
deployment approval. No automatic restoration, customer-data cleanup, staff-role
change, historical provider operation or guard bypass is part of this work.
