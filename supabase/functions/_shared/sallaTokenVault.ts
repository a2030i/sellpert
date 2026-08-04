type SallaTokenRow = {
  id: string
  access_token?: string | null
  refresh_token?: string | null
}

export async function resolveSallaTokens(admin: any, connection: SallaTokenRow) {
  const { data, error } = await admin.rpc('get_salla_connection_tokens', {
    p_connection_id: connection.id,
  })
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    return {
      accessToken: String(row?.access_token || ''),
      refreshToken: String(row?.refresh_token || ''),
      source: 'vault' as const,
    }
  }

  // Deployment-order compatibility: functions may be deployed immediately
  // before the migration. Once the database constraint is active, both legacy
  // columns are forced to NULL and this branch cannot return a credential.
  if (connection.access_token) {
    return {
      accessToken: String(connection.access_token),
      refreshToken: String(connection.refresh_token || ''),
      source: 'legacy' as const,
    }
  }
  throw new Error('Unable to resolve encrypted Salla credentials')
}

export async function storeSallaTokens(
  admin: any,
  connectionId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: string,
) {
  const { error } = await admin.rpc('store_salla_connection_tokens', {
    p_connection_id: connectionId,
    p_access_token: accessToken,
    p_refresh_token: refreshToken || null,
    p_expires_at: expiresAt,
  })
  if (!error) return true
  if (['PGRST202', '42883'].includes(String(error.code || ''))) return false
  throw new Error('Unable to store encrypted Salla credentials')
}
