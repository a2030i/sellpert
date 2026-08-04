# Production releases

Sellpert has two independently deployed runtimes: Vercel for the browser app
and Supabase for the database and Edge Functions. A production release that
changes Supabase must use the repository workflow instead of deploying only
the browser bundle.

## One-time GitHub configuration

Create a protected GitHub environment named `production`, add these secrets,
then set the repository variable `SUPABASE_DEPLOY_ENABLED` to `true`:

- `SUPABASE_ACCESS_TOKEN`: a scoped Supabase personal access token used only by GitHub Actions.
- `SUPABASE_DB_PASSWORD`: the production database password.

Do not store either value in source files, workflow YAML, Vercel variables, or
browser-prefixed environment variables.

## Release order

The `Supabase production release` workflow runs a two-phase deployment:

1. Deploy backward-compatible Edge Functions.
2. Apply every committed database migration.
3. Deploy Edge Functions again against the final schema.

Every schema-changing function release must understand both the pre-migration
and post-migration representation during phase one. CI rebuilds the database
from all migrations, type-checks every Edge Function, runs database isolation
tests, and exercises browser journeys. The production smoke monitor then
checks the immutable Vercel release and anonymous authorization boundaries.

If the deployment workflow fails, do not retry only the browser deployment.
Fix or roll forward the Supabase release first, then rerun the failed workflow.
