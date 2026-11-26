import { HttpError } from './sync.ts'

type ActorClientFactory = (
  url: string,
  key: string,
  options: {
    global: { headers: { Authorization: string } }
    auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false }
  },
) => { from(table: string): any }

/** Call only after auth.getUser(token) has verified this user's session. */
export async function loadAmazonCaller(
  createClient: ActorClientFactory,
  url: string,
  serviceKey: string,
  token: string,
  userId: string,
) {
  // The API key identifies the project, but the explicit bearer token makes
  // PostgREST evaluate this read as the user. In particular, merchants' existing
  // restrictive MFA policy hides the actor from an enrolled user's AAL1 session.
  // Never fall back to an admin read when this query is denied or fails.
  const actorClient = createClient(url, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: caller, error } = await actorClient.from('merchants')
    .select('merchant_code,owner_merchant_code,permissions,role,is_active')
    .eq('id', userId).maybeSingle()
  if (error || !caller || caller.is_active === false) throw new HttpError(403, 'Forbidden')
  return caller
}
