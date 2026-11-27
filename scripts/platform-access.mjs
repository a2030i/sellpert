import { pathToFileURL } from 'node:url'

export const TEAM = 'team_RnIh0txGDI26IavAcpabyqCs'
export const PROJECT = 'prj_Upq6kKTrMOC3NEfe2NMlrMFEiv8D'
const EMAIL = 'rakan@sellpert.com'
const ORG = 'fqpnljqebcuwdozuvlzt'

// Never log provider responses: member lists may include private invitation codes.
export function providerRequest(origin, token, fetchImpl = fetch) {
  if (!token) throw new Error('Missing required provider token')
  return async (path, method = 'GET', body) => {
    let response
    try {
      response = await fetchImpl(origin + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new Error('Provider connection failed') }
    if (!response.ok) throw new Error(`Provider ${method} failed: HTTP ${response.status}`)
    try { return await response.json() } catch { throw new Error('Invalid provider response') }
  }
}

export async function verifyVercel(request) {
  const team = await request(`/v2/teams/${TEAM}`)
  const project = await request(`/v9/projects/${PROJECT}?teamId=${TEAM}`)
  if (team.id !== TEAM || project.id !== PROJECT || project.accountId !== TEAM || project.name !== 'sellpert') {
    throw new Error('Vercel project/team identity mismatch')
  }
  const link = project.link
  if (link?.type !== 'github' || link.org !== 'a2030i' || link.repo !== 'sellpert') {
    throw new Error('Vercel GitHub repository mismatch')
  }
  return { team, project }
}

export async function rakanVercelAccess(request, invite = false) {
  const { team } = await verifyVercel(request)
  const result = await request(`/v3/teams/${TEAM}/members?limit=100&search=${encodeURIComponent(EMAIL)}`)
  if (!Array.isArray(result.members)) throw new Error('Invalid Vercel member list')
  const member = result.members.find(m => m.email?.toLowerCase() === EMAIL)
  const pending = result.emailInviteCodes?.find(m => m.email?.toLowerCase() === EMAIL && !m.expired)
  if (member?.role === 'OWNER') return member.confirmed === true ? 'accepted-owner' : 'pending-owner'
  if (pending?.role === 'OWNER') return 'pending-owner'
  if (!invite) return member ? 'member-needs-owner' : 'not-found-or-not-accepted'
  if (team.membership?.role !== 'OWNER') throw new Error('Vercel team Owner required to invite/promote')
  if (member) {
    if (!member.uid) throw new Error('Missing member identifier')
    await request(`/v1/teams/${TEAM}/members/${encodeURIComponent(member.uid)}`, 'PATCH', { role: 'OWNER' })
  } else {
    await request(`/v2/teams/${TEAM}/members`, 'POST', [{ email: EMAIL, role: 'OWNER' }])
  }
  // A successful invitation is not proof that the recipient accepted it.
  return member ? 'owner-update-submitted' : 'owner-invitation-sent'
}

export async function rakanSupabaseAccess(request) {
  const members = await request(`/v1/organizations/${ORG}/members`)
  if (!Array.isArray(members)) throw new Error('Invalid Supabase member list')
  const member = members.find(m => m.email?.toLowerCase() === EMAIL)
  return member?.role_name?.toLowerCase() === 'owner' ? 'owner-listed' : member ? 'listed-with-other-role' : 'not-listed-in-members'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.GITHUB_REPOSITORY !== 'a2030i/sellpert' || process.env.GITHUB_REF !== 'refs/heads/main') {
      throw new Error('Platform operations require the Sellpert main branch')
    }
    const mode = process.argv[2]
    if (mode === 'vercel-preflight') {
      await verifyVercel(providerRequest('https://api.vercel.com', process.env.VERCEL_TOKEN))
      console.log('Vercel team, project and repository identity verified')
    } else if (mode === 'vercel-verify' || mode === 'vercel-invite-rakan') {
      console.log(`Vercel Rakan access: ${await rakanVercelAccess(providerRequest('https://api.vercel.com', process.env.VERCEL_TOKEN), mode === 'vercel-invite-rakan')}`)
    } else if (mode === 'supabase-verify') {
      console.log(`Supabase Rakan access: ${await rakanSupabaseAccess(providerRequest('https://api.supabase.com', process.env.SUPABASE_ACCESS_TOKEN))}`)
    } else throw new Error('Unsupported platform operation')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
