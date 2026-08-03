param(
  [string]$AppUrl = 'https://sellpert.vercel.app',
  [string]$SupabaseUrl = 'https://urdyzbsukcuibadlaath.supabase.co'
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

# A 401 proves the external Supabase gateway is reachable without exposing a
# project key. Sensitive functions must also reject anonymous callers.
$authHealth = Invoke-WithRetry { Get-HttpStatus "$SupabaseUrl/auth/v1/health" }
Assert-Status 'Supabase API gateway' $authHealth @(401)

$protectedFunctions = @('queue-worker', 'salla-sync', 'impersonate-merchant', 'account-lifecycle', 'activity-feed')
foreach ($functionName in $protectedFunctions) {
  $status = Invoke-WithRetry {
    Get-HttpStatus "$SupabaseUrl/functions/v1/$functionName" 'POST' '{}'
  }
  Assert-Status "$functionName anonymous boundary" $status @(401)
}

Write-Host 'Production smoke checks passed.'
