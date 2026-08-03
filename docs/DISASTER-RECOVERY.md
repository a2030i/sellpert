# Sellpert recovery baseline

This runbook separates two controls that must not be confused:

1. **Schema reconstruction** — rebuilding an empty Sellpert database from versioned migrations.
2. **Merchant-data recovery** — restoring production rows and storage objects from a managed or logical backup.

## Automated schema drill

The `Schema recovery drill` GitHub workflow runs weekly and on demand. It:

- starts a clean local Supabase stack;
- applies every migration in order;
- runs all tenant-isolation and authorization tests;
- creates portable `public` and `security` schema dumps plus checksums;
- destroys the local database, rebuilds it, and runs the invariants again.

A green workflow proves that application structure and authorization can be reconstructed. It does **not** prove that production merchant rows or uploaded objects have been restored.

## Production data recovery requirements

Before calling the service production-ready, the operator must record and test:

- the active Supabase database backup tier and retention period;
- whether Point-in-Time Recovery is enabled;
- a separate backup policy for Storage objects, because database backups contain object metadata but not deleted file contents;
- an encrypted off-site logical dump when the active plan does not provide sufficient retention;
- a quarterly restore into an isolated Supabase project, followed by the invariant and smoke tests;
- named incident owner, target RPO, and target RTO.

Never restore a backup over production as a drill. Restore into an isolated project, validate tenant counts and representative records, then destroy the isolated project after evidence is retained.

## Restore validation checklist

- Authentication users and merchant workspaces have matching identifiers.
- Every tenant-owned table has RLS enabled and the expected policies.
- Cross-merchant reads fail for orders, products, imports, credentials, finance, and analytics.
- Queue jobs and cron functions remain inaccessible to anonymous callers.
- Edge Function secrets are recreated from the secret manager; they are not expected inside database dumps.
- Uploaded files are present and readable only by their owning merchant.
- Production smoke checks pass against the isolated restored environment before cutover.
