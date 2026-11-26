import { execFileSync } from 'node:child_process'

// This deliberately deploys only the two handlers reviewed for the Amazon
// release. Never omit function names, prune functions, or disable JWT checks.
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is missing.')
  process.exit(1)
}
try {
  execFileSync('supabase', [
    'functions', 'deploy', 'amazon-connect', 'admin-integration-settings',
    '--project-ref', 'urdyzbsukcuibadlaath', '--use-api',
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 })
  console.log('Deployment command completed for amazon-connect and admin-integration-settings.')
} catch {
  console.error('Function deployment did not complete reliably. Inspect deployed versions before retrying; no CLI diagnostics were logged.')
  process.exitCode = 1
}
