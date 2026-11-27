import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { assertReviewedSource, PROJECT_REF, ReleaseError, safeFailure, sourcePinFromEnvironment } from './release-amazon-sync-exception.mjs'

export const FUNCTIONS = Object.freeze(['sync-amazon', 'amazon-connect', 'queue-worker'])
const FAILURE = 'Amazon function deployment did not complete reliably. Some handlers may already be deployed. Inspect deployed versions before retrying; no CLI diagnostics were logged.'

export class FunctionDeploymentError extends Error {
  constructor() { super(FAILURE) }
}

// Deploy sequentially so the consumer exists before the worker dispatches to it.
// Never deploy all functions, prune functions, or disable their JWT checks.
export function deployAmazonSyncFunctions({ token, sourcePin, exec = execFileSync }) {
  if (!token?.trim() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new ReleaseError('CONFIG')
  const reviewedCommit = assertReviewedSource(sourcePin)
  for (const slug of FUNCTIONS) {
    try {
      exec('supabase', ['functions', 'deploy', slug, '--project-ref', PROJECT_REF, '--use-api'], {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
      })
    } catch { throw new FunctionDeploymentError() }
  }
  return { project_ref: PROJECT_REF, source_commit: reviewedCommit, deployed_functions: [...FUNCTIONS] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new ReleaseError('INPUT')
    console.log(JSON.stringify(deployAmazonSyncFunctions({
      token: process.env.SUPABASE_ACCESS_TOKEN,
      sourcePin: sourcePinFromEnvironment(),
    })))
  } catch (error) {
    console.error(error instanceof FunctionDeploymentError ? FAILURE : safeFailure(error))
    process.exitCode = 1
  }
}
