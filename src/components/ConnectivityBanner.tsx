import { useEffect, useReducer, useRef } from 'react'
import { Check, WifiOff } from 'lucide-react'
import {
  initialConnectivityState,
  reduceConnectivityState,
} from '../lib/connectivity'

const RESTORED_NOTICE_MS = 4_000

export default function ConnectivityBanner() {
  const [state, dispatch] = useReducer(
    reduceConnectivityState,
    typeof navigator === 'undefined' ? true : navigator.onLine,
    initialConnectivityState,
  )
  const restoredTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const handleOffline = () => dispatch('went-offline')
    const handleOnline = () => dispatch('went-online')

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  useEffect(() => {
    if (restoredTimer.current) window.clearTimeout(restoredTimer.current)
    if (state === 'restored') {
      restoredTimer.current = window.setTimeout(
        () => dispatch('restore-notice-expired'),
        RESTORED_NOTICE_MS,
      )
    }
    return () => {
      if (restoredTimer.current) window.clearTimeout(restoredTimer.current)
    }
  }, [state])

  if (state === 'online') return null

  return (
    <aside
      className={`connectivity-banner connectivity-banner--${state}`}
      role={state === 'offline' ? 'alert' : 'status'}
      aria-live={state === 'offline' ? 'assertive' : 'polite'}
      aria-atomic="true"
      dir="rtl"
    >
      <span className="connectivity-banner__icon" aria-hidden="true">
        {state === 'offline' ? <WifiOff size={17} /> : <Check size={17} />}
      </span>
      <span className="connectivity-banner__copy">
        <strong>{state === 'offline' ? 'الاتصال بالإنترنت متوقف' : 'عاد الاتصال بالإنترنت'}</strong>
        <span>
          {state === 'offline'
            ? 'لن تكتمل الإجراءات الجديدة حتى عودة الاتصال. اترك الصفحة مفتوحة.'
            : 'يمكنك متابعة العمل الآن.'}
        </span>
      </span>
    </aside>
  )
}
