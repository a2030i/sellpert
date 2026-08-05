# Production releases

Sellpert has two independently deployed runtimes: Vercel for the browser app
and Supabase for the database and Edge Functions. A production release that
changes Supabase must use the repository workflow instead of deploying only
the browser bundle.

## One-time GitHub configuration

Create a protected GitHub environment named `production` and add these
required secrets:

- `SUPABASE_ACCESS_TOKEN`: a scoped Supabase personal access token used only by GitHub Actions.
- `SUPABASE_DB_PASSWORD`: the production database password.

Do not store either value in source files, workflow YAML, Vercel variables, or
browser-prefixed environment variables.

The release job is intentionally mandatory. Missing secrets fail the release
instead of producing a green workflow that did not deploy Supabase.

## Release order

The `Supabase production release` workflow runs a two-phase deployment:

1. Compare committed migration timestamps with the production history and stop
   if an older local migration is missing remotely.
2. Run a dry-run database push without changing production.
3. Deploy backward-compatible Edge Functions.
4. Apply only forward, committed database migrations.
5. Deploy Edge Functions again against the final schema.

The release intentionally does not use `--include-all`. If history drift is
reported, verify that production already contains the migration's schema effect,
then reconcile that reviewed timestamp with `supabase migration repair <version>
--status applied`. Never mark a migration as applied merely to make CI green.

Every schema-changing function release must understand both the pre-migration
and post-migration representation during phase one. CI rebuilds the database
from all migrations, type-checks every Edge Function, runs database isolation
tests, and exercises browser journeys. The production smoke monitor then
checks the immutable Vercel release and anonymous authorization boundaries.

If the deployment workflow fails, do not retry only the browser deployment.
Fix or roll forward the Supabase release first, then rerun the failed workflow.

## Production migration state (2026-08-05)

Production contains historical migrations created before the repository adopted
its rebuildable baseline. Many have the same migration name under a different
timestamp, while several local bootstrap/restore migrations intentionally
reconstruct effects that already exist in production. This is a history problem,
not permission to replay old DDL.

The forward migration `explicit_data_api_grants` was independently reviewed,
rebuilt in CI, applied through the Supabase Management API, and recorded in
production as `20260805022434_explicit_data_api_grants`. Live verification
confirmed:

- `anon` has no table or column access to any of the 86 public relations.
- `service_role` has the required access to all public and security relations.
- all 51 tables carrying a merchant/store discriminator have RLS enabled and at
  least one policy.
- future migration-owner tables, sequences, and functions default to no browser
  access until a migration explicitly grants it.

Do not run `migration repair` for the remaining historical entries as a batch.
Reconcile each entry only after comparing its final schema effect with production.
Until that one-time reconciliation is complete, the parity guard is expected to
stop `db push`; deploy reviewed forward database changes through an explicitly
audited release instead of bypassing the guard.
