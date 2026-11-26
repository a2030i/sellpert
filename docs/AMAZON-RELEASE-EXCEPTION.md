# Proposed Amazon-only release exception — approval required

This proposal targets only Supabase project `urdyzbsukcuibadlaath` and the
reviewed Amazon release in PR #18. It is not authorization to execute it.

The ordinary release is blocked by historical migration-version differences.
The investigation found 122 local historical versions absent from production
and 189 production versions absent locally. The broader recovery proposal did
not pass review: its per-entry evidence and supersession mappings are incomplete.
Do not execute that proposal or mark those versions applied.

## Exact alternative

With explicit owner approval of this exception to the normal parity gate:

1. Merge the reviewed PR after its checks pass.
2. Inspect the immutable Amazon release bundle and its live preconditions.
3. Deploy only `amazon-connect` and `admin-integration-settings`. Both preserve
   existing behavior before the Amazon migration is installed.
4. Apply only `20261126120000_amazon_sp_api_connection.sql`, with bounded locks,
   exact definition checks, postconditions and its single migration-history
   record in one transaction. Preserve all 225 original history records.
5. Verify through a new database request, then deploy the same two handlers
   again against the final schema.
6. Complete DNS and Auth configuration and verify the frontend deployment and
   read-only/anonymous boundaries. Do not perform Amazon writes as a test.

The runner is [release-amazon-exception.mjs](../scripts/release-amazon-exception.mjs)
and the manual workflow is
[amazon-targeted-release.yml](../.github/workflows/amazon-targeted-release.yml).
Both require the exact SHA-256 of the reviewed bundle manifest. `inspect` and
`verify` are read-only; `apply` must not be dispatched without owner approval.
No automatic retries are made after an ambiguous mutation or verification error.

Inspections execute only the immutable SELECT-only SQL files through the
`postgres` Management API transport. The API parameter `read_only: true` changes
the actor to `supabase_read_only_user`, which does not satisfy the approved actor
assertion. The runner therefore uses `read_only: false` for all three modes;
`inspect` and `verify` still send only their hash-verified inspection SQL. This
transport correction does not change the approved SQL bundle or its assertions.

Reviewed [manifest](../scripts/releases/amazon-20261126/manifest.json) SHA-256:
`4da5966b7c9bafc9d1675b09a12b7e9c31b099a42edfd924cb8ce79586c4c25e`.
The SQL sets a 60-second statement timeout and a 5-second lock timeout. All 12
production inspection assertions passed read-only. An isolated rollback test
passed the 12 inspection and 15 verification assertions using the local ledger
and its known helper fingerprint as test adapters; this is not a production
execution. Negative drift cases failed closed. The runner's ten tests cover
tampered artifacts, unexpected response shapes, redaction, failed preconditions
and ambiguous execution/verification without automatic retries.

The transaction changes the allowed credential platform constraint, adds the
unique active Amazon seller index and server-only OAuth state table, adds the
authorized import-status RPC, and inserts the Amazon guard into the existing
atomic import routine. The production routine must exactly match the reviewed
pre-migration fingerprint. No customer-row cleanup, credential rewriting,
historical migration replay, or provider request is part of this transaction.

## Boundaries and remaining release work

- The normal parity guard remains unchanged and will still reject ordinary
  releases until the historical discrepancies receive a separate, evidenced
  resolution. This exception does not certify the entire production schema.
- The pending pricing migration is excluded. Its tables, bucket and default
  form are not created by this release exception.
- `20261126092428_enforce_remaining_table_boundaries.sql` fixes nine missing MFA
  policies and two tenant guards in clean repository rebuilds. It follows the
  pricing migration and passed the full isolated SQL suite. It is also excluded
  from this production exception; do not claim it is applied on production.
- The workflow shares the backend release concurrency lock. An operator must
  also prevent concurrent manual database DDL for the short migration window;
  an advisory lock cannot exclude unrelated administrator sessions.
- A failed transaction rolls back its schema and ledger changes. After a
  successful commit, do not drop the OAuth table or remove the import guard as
  an automatic rollback. Inspect state and review any required forward fix.
- After a timeout or failed verification, use `verify` and inspect the database
  before deciding whether another action is appropriate. HTTP success alone is
  not a verified release.

Amazon application credentials are entered later by an authorized administrator
at `/admin/amazon`. They are stored encrypted on the server and are not copied
to Edge Function secrets. Until configured, the merchant card displays
`قيد التجهيز`. Live Amazon consent and login/password-recovery delivery must be
reported separately from mocked browser coverage.
