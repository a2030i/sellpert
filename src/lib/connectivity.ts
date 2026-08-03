export type ConnectivityState = 'online' | 'offline' | 'restored'
export type ConnectivityEvent = 'went-online' | 'went-offline' | 'restore-notice-expired'

export function initialConnectivityState(isOnline: boolean): ConnectivityState {
  return isOnline ? 'online' : 'offline'
}

export function reduceConnectivityState(
  state: ConnectivityState,
  event: ConnectivityEvent,
): ConnectivityState {
  if (event === 'went-offline') return 'offline'
  if (event === 'went-online') return state === 'offline' ? 'restored' : 'online'
  return state === 'restored' ? 'online' : state
}
