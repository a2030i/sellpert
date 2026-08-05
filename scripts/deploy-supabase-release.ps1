param(
  [string]$ProjectRef = 'urdyzbsukcuibadlaath'
)

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw 'SUPABASE_ACCESS_TOKEN is required.'
}
if (-not $env:SUPABASE_DB_PASSWORD) {
  throw 'SUPABASE_DB_PASSWORD is required.'
}
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw 'Supabase CLI is required.'
}

Write-Host 'Linking the production project...'
supabase link --project-ref $ProjectRef --password $env:SUPABASE_DB_PASSWORD
if ($LASTEXITCODE -ne 0) { throw 'Unable to link the Supabase project.' }

Write-Host 'Verifying local and production migration history...'
& "$PSScriptRoot\Test-SupabaseMigrationParity.ps1" -Password $env:SUPABASE_DB_PASSWORD
if ($LASTEXITCODE -ne 0) { throw 'Supabase migration history verification failed.' }

Write-Host 'Previewing committed database migrations...'
supabase db push --linked --dry-run
if ($LASTEXITCODE -ne 0) { throw 'The database migration preview failed.' }

# Phase 1 must remain backward compatible with the current schema. This lets
# Edge Functions understand both the old and new representation before a
# migration moves or constrains production data.
Write-Host 'Deploying backward-compatible Edge Functions...'
supabase functions deploy --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'The compatibility function deployment failed.' }

Write-Host 'Applying committed database migrations...'
supabase db push --linked
if ($LASTEXITCODE -ne 0) { throw 'The database migration deployment failed.' }

# Phase 2 makes the release convergent if a function and schema were deployed
# concurrently or the first deployment used a cached bundle.
Write-Host 'Re-deploying Edge Functions against the final schema...'
supabase functions deploy --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'The final function deployment failed.' }

Write-Host 'Supabase production release completed.'
