import { HttpError } from './sync.ts'
// Same workspace rules as manage-platform-credentials.
export async function authorizeMarketplaceWorkspace(admin: any, caller: any, userId: string, requestedCode: unknown): Promise<string> {
  const requested = clean(requestedCode)
  if (['admin', 'super_admin'].includes(caller.role)) {
    if (!requested) throw new HttpError(400, 'merchant_code is required')
    await requireActiveWorkspace(admin, requested)
    return requested
  }
  if (caller.role === 'merchant' && caller.merchant_code) {
    if (!requested || requested === caller.merchant_code) {
      await requireActiveWorkspace(admin, caller.merchant_code)
      return caller.merchant_code
    }
    const { data: link } = await admin.from('merchant_account_links').select('id')
      .eq('user_id', userId).eq('merchant_code', requested).maybeSingle()
    if (!link) throw new HttpError(403, 'Forbidden')
    await requireActiveWorkspace(admin, requested)
    return requested
  }
  if (caller.role === 'employee' && caller.owner_merchant_code && permissionEnabled(caller.permissions, 'integrations')) {
    if (requested && requested !== caller.owner_merchant_code) throw new HttpError(403, 'Forbidden')
    await requireActiveWorkspace(admin, caller.owner_merchant_code)
    return caller.owner_merchant_code
  }
  throw new HttpError(403, 'Forbidden')
}

async function requireActiveWorkspace(admin: any, merchantCode: string) {
  const { data: workspace, error } = await admin.from('merchants')
    .select('is_active,workspace_status').eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (error) throw error
  if (!workspace || workspace.is_active === false || workspace.workspace_status !== 'active') throw new HttpError(403, 'Merchant account is inactive')
}

function permissionEnabled(value: unknown, permission: string): boolean {
  if (Array.isArray(value)) return value.includes(permission)
  return !!value && typeof value === 'object' && (value as Record<string, unknown>)[permission] === true
}

function clean(value: unknown) { return String(value || '').trim() }
