import { loadAmazonCaller } from './amazonActor.ts'
import { authorizeMerchantSync, HttpError } from './sync.ts'

/** Internal queue jobs use the service token; user requests must also satisfy MFA RLS. */
export async function authorizeAmazonSync(
  req: Request,
  admin: any,
  serviceKey: string,
  supabaseUrl: string,
  createClient: Parameters<typeof loadAmazonCaller>[0],
  merchantCode: string,
) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!token) throw new HttpError(401, 'Unauthorized')
  if (token !== serviceKey) {
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) throw new HttpError(401, 'Unauthorized')
    // Read as the verified user. An enrolled AAL1 session cannot see its actor
    // under merchants' restrictive MFA policy. Never retry this as service role.
    await loadAmazonCaller(createClient, supabaseUrl, serviceKey, token, user.id)
  }
  return authorizeMerchantSync(req, admin, serviceKey, merchantCode, ['integrations', 'orders', 'statement'])
}
