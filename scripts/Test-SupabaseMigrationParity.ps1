param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Password = $env:SUPABASE_DB_PASSWORD,
  [string]$MigrationListOutput = ''
)

$ErrorActionPreference = 'Stop'

$migrationDirectory = Join-Path $ProjectRoot 'supabase\migrations'
$localVersions = @(
  Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.sql' |
    ForEach-Object {
      if ($_.BaseName -match '^(?<version>\d{14})_') { $Matches.version }
    } |
    Sort-Object -Unique
)

if ($localVersions.Count -eq 0) {
  throw 'No local Supabase migrations were found.'
}

if (-not $MigrationListOutput) {
  if (-not $Password) { throw 'SUPABASE_DB_PASSWORD is required for migration parity verification.' }
  if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw 'Supabase CLI is required.' }

  $lines = & supabase migration list --linked --password $Password 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Unable to read the remote migration history.`n$($lines -join "`n")" }
  $MigrationListOutput = $lines -join "`n"
}

$remoteVersions = @(
  foreach ($line in ($MigrationListOutput -split "`r?`n")) {
    # The CLI uses a box-drawing separator. The ASCII fallback makes captured
    # CI logs and test fixtures safe across terminal encodings.
    $separator = $line.IndexOf([char]0x2502)
    if ($separator -lt 0) { $separator = $line.IndexOf('|') }
    if ($separator -lt 0) { continue }
    $remoteColumn = $line.Substring($separator + 1)
    if ($remoteColumn -match '(?<version>\d{14})') { $Matches.version }
  }
) | Sort-Object -Unique

if ($remoteVersions.Count -eq 0) {
  throw 'The remote Supabase migration history could not be parsed; release stopped without changes.'
}

$latestRemote = $remoteVersions[-1]
$remoteLookup = [System.Collections.Generic.HashSet[string]]::new([string[]]$remoteVersions)
$historicalDrift = @(
  $localVersions | Where-Object {
    -not $remoteLookup.Contains($_) -and [string]::CompareOrdinal($_, $latestRemote) -le 0
  }
)

if ($historicalDrift.Count -gt 0) {
  $versions = $historicalDrift -join ', '
  $message = @"
Supabase migration history drift detected. These committed migrations are older than
the latest remote migration but are not recorded remotely: $versions

Do not use db push --include-all. Verify production schema equivalence, then reconcile
each reviewed version with 'supabase migration repair <version> --status applied'.
No production changes were made.
"@
  throw $message
}

$forwardMigrations = @(
  $localVersions | Where-Object {
    -not $remoteLookup.Contains($_) -and [string]::CompareOrdinal($_, $latestRemote) -gt 0
  }
)

Write-Host "Migration history is safe. Latest remote: $latestRemote; forward migrations: $($forwardMigrations.Count)."
