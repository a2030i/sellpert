import { describe, expect, it } from 'vitest'
import { initialConnectivityState, reduceConnectivityState } from '../connectivity'

describe('connectivity state', () => {
  it('reflects the browser state on first render', () => {
    expect(initialConnectivityState(true)).toBe('online')
    expect(initialConnectivityState(false)).toBe('offline')
  })

  it('shows a restored confirmation only after a real outage', () => {
    expect(reduceConnectivityState('offline', 'went-online')).toBe('restored')
    expect(reduceConnectivityState('online', 'went-online')).toBe('online')
  })

  it('returns to the quiet online state and handles another outage', () => {
    expect(reduceConnectivityState('restored', 'restore-notice-expired')).toBe('online')
    expect(reduceConnectivityState('restored', 'went-offline')).toBe('offline')
  })
})
