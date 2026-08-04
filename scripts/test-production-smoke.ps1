param(
  [string]$AppUrl = 'https://sellpert.vercel.app',
  [string]$SupabaseUrl = 'https://urdyzbsukcuibadlaath.supabase.co',
  [string]$SupabasePublishableKey = 'sb_publishable_mQxr9nnCBszsxIB39DvWgw_T5R3BDL7',
  [string]$ExpectedRelease = '',
  [ValidateRange(0, 600)]
  [int]$ReleaseWaitSeconds = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-WithRetry([scriptblock]$Operation) {
  $lastError = $null
  foreach ($attempt in 1..3) {
    try { return & $Operation } catch {
      $lastError = $_
      if ($attempt -lt 3) { Start-Sleep -Seconds ([Math]::Pow(2, $attempt - 1)) }
    }
  }
  throw $lastError
}

function Get-HttpStatus(
  [string]$Uri,
  [string]$Method = 'GET',
  [string]$Body = ''
) {
  try {
    $request = @{ Uri = $Uri; Method = $Method; TimeoutSec = 20; UseBasicParsing = $true }
    if ($Body) {
      $request.ContentType = 'application/json'
      $request.Body = $Body
    }
    $response = Invoke-WebRequest @request
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

function Assert-Status([string]$Name, [int]$Actual, [int[]]$Expected) {
  if ($Actual -notin $Expected) {
    throw "$Name returned HTTP $Actual; expected $($Expected -join ' or ')"
  }
  Write-Host "PASS $Name ($Actual)"
}

$homeResponse = Invoke-WithRetry { Invoke-WebRequest -Uri "$AppUrl/" -TimeoutSec 20 -UseBasicParsing }
Assert-Status 'application shell' ([int]$homeResponse.StatusCode) @(200)
if ($homeResponse.Content -notmatch '<html lang="ar" dir="rtl">') {
  throw 'application shell lost Arabic RTL document metadata'
}
if ($homeResponse.Content -notmatch '<title>Sellpert') {
  throw 'application shell lost the Sellpert title'
}

$requiredHeaders = @(
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy'
)
foreach ($header in $requiredHeaders) {
  if (-not $homeResponse.Headers[$header]) { throw "missing production security header: $header" }
}
Write-Host 'PASS production security headers'

if ($ExpectedRelease) {
  if ($ExpectedRelease -notmatch '^[0-9a-fA-F]{7,64}$') {
    throw 'ExpectedRelease must be a Git commit SHA'
  }

  $releaseFound = $false
  $releaseDeadline = (Get-Date).AddSeconds($ReleaseWaitSeconds)
  do {
    # Re-fetch the shell on every attempt because Vercel changes the hashed
    # bundle URL when a deployment becomes active.
    $releaseHome = Invoke-WithRetry { Invoke-WebRequest -Uri "$AppUrl/" -TimeoutSec 20 -UseBasicParsing }
    $scriptMatches = [regex]::Matches(
      $releaseHome.Content,
      '<script[^>]+src=["''](?<src>[^"'']+\.js(?:\?[^"'']*)?)["'']',
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    $scriptSources = @($scriptMatches | ForEach-Object { $_.Groups['src'].Value } | Select-Object -Unique)
    if ($scriptSources.Count -eq 0) {
      throw 'application shell does not reference a JavaScript bundle'
    }

    foreach ($source in $scriptSources) {
      $bundleUri = if ($source -match '^https?://') {
        $source
      } else {
        "$($AppUrl.TrimEnd('/'))/$($source.TrimStart('/'))"
      }
      $bundle = Invoke-WithRetry { Invoke-WebRequest -Uri $bundleUri -TimeoutSec 30 -UseBasicParsing }
      if ($bundle.Content.Contains($ExpectedRelease)) {
        $releaseFound = $true
        break
      }
    }

    if (-not $releaseFound -and (Get-Date) -lt $releaseDeadline) {
      Write-Host "WAIT production has not activated $ExpectedRelease yet"
      Start-Sleep -Seconds 15
    }
  } while (-not $releaseFound -and (Get-Date) -lt $releaseDeadline)

  if (-not $releaseFound) {
    throw "production is not serving expected release $ExpectedRelease"
  }
  Write-Host "PASS production release ($ExpectedRelease)"
}

# A 401 proves the external Supabase gateway is reachable without exposing a
# project key. Sensitive functions must also reject anonymous callers.
$authHealth = Invoke-WithRetry { Get-HttpStatus "$SupabaseUrl/auth/v1/health" }
Assert-Status 'Supabase API gateway' $authHealth @(401)

# pg_net is required by trusted database cron/trigger functions, but its `net`
# schema must never be exposed through PostgREST to browser-facing API keys.
$netSchemaStatus = 0
$netSchemaBody = ''
try {
  $netResponse = Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 20 `
    -Uri "$SupabaseUrl/rest/v1/rpc/http_post" `
    -Headers @{
      apikey = $SupabasePublishableKey
      'Accept-Profile' = 'net'
      'Content-Profile' = 'net'
    } `
    -ContentType 'application/json' `
    -Body '{"url":"https://example.invalid"}'
  $netSchemaStatus = [int]$netResponse.StatusCode
  $netSchemaBody = $netResponse.Content
} catch {
  if (-not $_.Exception.Response) { throw }
  $netSchemaStatus = [int]$_.Exception.Response.StatusCode
  if ($_.ErrorDetails.Message) {
    $netSchemaBody = $_.ErrorDetails.Message
  } else {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    try { $netSchemaBody = $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
}
if ($netSchemaStatus -ne 406 -or $netSchemaBody -notmatch 'PGRST106') {
  throw "pg_net schema boundary failed: HTTP $netSchemaStatus $netSchemaBody"
}
Write-Host 'PASS pg_net is not exposed through the Data API (406)'

$protectedFunctions = @(
  'queue-worker',
  'salla-sync',
  'sync-trendyol',
  'sync-amazon',
  'sync-noon',
  'create-merchant',
  'create-employee',
  'manage-platform-credentials',
  'test-platform-connection',
  'trendyol-actions',
  'impersonate-merchant',
  'daily-report',
  'manual-entry',
  'respondly-info',
  'ai-chat',
  'analyze-merchant',
  'notify-whatsapp',
  'account-lifecycle',
  'activity-feed',
  'mfa-recovery'
)
foreach ($functionName in $protectedFunctions) {
  $status = Invoke-WithRetry {
    Get-HttpStatus "$SupabaseUrl/functions/v1/$functionName" 'POST' '{}'
  }
  Assert-Status "$functionName anonymous boundary" $status @(401)
}

# OAuth callbacks and provider webhooks intentionally bypass the gateway, so
# their handler-level authentication must be exercised separately.
$oauthStatus = Invoke-WithRetry {
  Get-HttpStatus "$SupabaseUrl/functions/v1/marketplace-oauth" 'POST' '{}'
}
Assert-Status 'marketplace-oauth anonymous boundary' $oauthStatus @(401)

foreach ($webhookName in @('salla-webhook', 'trendyol-webhook')) {
  $status = Invoke-WithRetry {
    Get-HttpStatus "$SupabaseUrl/functions/v1/$webhookName" 'POST' '{}'
  }
  Assert-Status "$webhookName invalid-signature boundary" $status @(401)
}

Write-Host 'Production smoke checks passed.'
