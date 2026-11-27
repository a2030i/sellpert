import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function validateReleaseContext({ repository, sha, ref, event }) {
  if (repository !== 'a2030i/sellpert') throw new Error('Unexpected release repository')
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid immutable release SHA')
  if (!['refs/heads/main', 'refs/heads/master'].includes(ref)) throw new Error('Production releases require main/master')
  if (!['push', 'workflow_dispatch'].includes(event)) throw new Error('Unsupported release event')
}

export async function waitForReleaseCI(context, {
  fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, timeoutMs = 20 * 60_000, intervalMs = 15_000,
} = {}) {
  validateReleaseContext(context)
  if (!context.token) throw new Error('Missing GitHub Actions read token')
  const deadline = now() + timeoutMs
  const branch = context.ref.slice('refs/heads/'.length)
  const query = new URLSearchParams({ head_sha: context.sha, branch, event: 'push', per_page: '100' })
  while (now() < deadline) {
    const response = await fetchImpl(`https://api.github.com/repos/${context.repository}/actions/workflows/ci.yml/runs?${query}`, {
      headers: { Authorization: `Bearer ${context.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`CI lookup failed: HTTP ${response.status}`)
    const body = await response.json()
    if (!Array.isArray(body.workflow_runs)) throw new Error('Invalid CI response')
    const runs = body.workflow_runs.filter(run => run.head_sha === context.sha && run.head_branch === branch && run.event === 'push')
      .sort((a, b) => Number(b.id) - Number(a.id))
    const run = runs[0]
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`CI did not pass: ${run.conclusion || 'unknown'}`)
      return { runId: run.id, sha: context.sha }
    }
    await sleep(intervalMs)
  }
  throw new Error('Timed out waiting for successful CI on the exact release SHA')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await waitForReleaseCI({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, token: process.env.GH_TOKEN })
    console.log(`Release CI verified: run ${result.runId}, commit ${result.sha}`)
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `sha=${result.sha}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release CI verification failed')
    process.exitCode = 1
  }
}
