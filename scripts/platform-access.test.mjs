import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEAM, PROJECT, providerRequest, verifyVercel, rakanVercelAccess, rakanSupabaseAccess } from './platform-access.mjs'

function fixture({ members = [], emailInviteCodes = [], teamRole = 'OWNER', wrongProject = false } = {}) {
  const writes = []
  const request = async (path, method = 'GET', body) => {
    if (method !== 'GET') { writes.push({ path, method, body }); return {} }
    if (path === `/v2/teams/${TEAM}`) return { id: TEAM, membership: { role: teamRole } }
    if (path.startsWith('/v9/projects/')) return { id: wrongProject ? 'other' : PROJECT, accountId: TEAM, name: 'sellpert', link: { type: 'github', org: 'a2030i', repo: 'sellpert' } }
    return { members, emailInviteCodes }
  }
  return { request, writes }
}
test('wrong Vercel target blocks both verification and invitation', async () => {
  const f = fixture({ wrongProject: true })
  await assert.rejects(verifyVercel(f.request), /mismatch/)
  await assert.rejects(rakanVercelAccess(f.request, true), /mismatch/)
  assert.deepEqual(f.writes, [])
})
test('verification never mutates members; invite targets only the named email', async () => {
  const f = fixture()
  assert.equal(await rakanVercelAccess(f.request), 'not-found-or-not-accepted')
  assert.equal(f.writes.length, 0)
  assert.equal(await rakanVercelAccess(f.request, true), 'owner-invitation-sent')
  assert.deepEqual(f.writes, [{ path: `/v2/teams/${TEAM}/members`, method: 'POST', body: [{ email: 'rakan@sellpert.com', role: 'OWNER' }] }])
})
test('accepted and pending owner invitations are idempotent and distinct', async () => {
  for (const confirmed of [true, false]) {
    const f = fixture({ members: [{ email: 'Rakan@sellpert.com', role: 'OWNER', confirmed }] })
    assert.equal(await rakanVercelAccess(f.request, true), confirmed ? 'accepted-owner' : 'pending-owner')
    assert.equal(f.writes.length, 0)
  }
  const f = fixture({ emailInviteCodes: [{ email: 'rakan@sellpert.com', role: 'OWNER', expired: false, code: 'must-not-leak' }] })
  assert.equal(await rakanVercelAccess(f.request, true), 'pending-owner')
  assert.equal(f.writes.length, 0)
})
test('promotion changes only the matching member role and preserves other owners', async () => {
  const f = fixture({ members: [{ email: 'other@example.com', role: 'OWNER', uid: 'original-owner' }, { email: 'rakan@sellpert.com', role: 'MEMBER', uid: 'rakan-user' }] })
  await rakanVercelAccess(f.request, true)
  assert.deepEqual(f.writes, [{ path: `/v1/teams/${TEAM}/members/rakan-user`, method: 'PATCH', body: { role: 'OWNER' } }])
  const denied = fixture({ teamRole: 'MEMBER' })
  await assert.rejects(rakanVercelAccess(denied.request, true), /Owner required/)
  assert.equal(denied.writes.length, 0)
})
test('provider failures redact token and response bodies and refuse redirects', async () => {
  const request = providerRequest('https://api.vercel.com', 'private-token', async (_url, options) => {
    assert.equal(options.redirect, 'error')
    return { ok: false, status: 403, json: async () => ({ token: 'private-token' }) }
  })
  await assert.rejects(request('/v2/teams/example'), { message: 'Provider GET failed: HTTP 403' })
})
test('Supabase membership verification never returns unrelated members', async () => {
  assert.equal(await rakanSupabaseAccess(async () => [{ email: 'Rakan@sellpert.com', role_name: 'Owner' }]), 'owner-listed')
  assert.equal(await rakanSupabaseAccess(async () => [{ email: 'other@example.com', role_name: 'Owner' }]), 'not-listed-in-members')
})
