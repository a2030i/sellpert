export type ApiIncidentSignal = {
  category: 'network' | 'api'
  severity: 'error'
  component: 'api'
  action: 'load' | 'save'
  errorCode: 'network_failure' | 'api_failure'
  httpStatus?: number
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

export function createMonitoredFetch(
  fetchImplementation: typeof fetch,
  emit: (signal: ApiIncidentSignal) => void,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const action = ['GET', 'HEAD'].includes(requestMethod(input, init)) ? 'load' : 'save'
    try {
      const response = await fetchImplementation(input, init)
      if (response.status >= 500) {
        emit({ category: 'api', severity: 'error', component: 'api', action, errorCode: 'api_failure', httpStatus: response.status })
      }
      return response
    } catch (error) {
      emit({ category: 'network', severity: 'error', component: 'api', action, errorCode: 'network_failure' })
      throw error
    }
  }
}

export function dispatchApiIncident(signal: ApiIncidentSignal) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ApiIncidentSignal>('sellpert:api-incident', { detail: signal }))
}
