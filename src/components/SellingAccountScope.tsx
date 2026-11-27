import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { listSellingAccounts, type SellingAccount } from '../lib/marketplaceAccounts'
import { sellingAccountDataClient } from '../lib/marketplaceDataScope'
import DataLoadError from './DataLoadError'
const SelectedAccountsContext = createContext<SellingAccount[]>([])
export const useSelectedSellingAccounts = () => useContext(SelectedAccountsContext)
const AccountDataContext = createContext(supabase)
export const useSellingAccountClient = () => useContext(AccountDataContext)

export default function SellingAccountScope({ merchantCode, enabled, children }: { merchantCode: string; enabled: boolean; children: ReactNode }) {
  const [accounts, setAccounts] = useState<SellingAccount[] | null>(null)
  const [selection, setSelection] = useState('')
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setError(false)
    listSellingAccounts(merchantCode).then(rows => {
      if (cancelled) return
      setAccounts(rows)
      const explicit = rows.filter(row => !row.is_legacy)
      let saved = new URLSearchParams(window.location.search).get('account') || ''
      if (!saved) { try { saved = window.localStorage.getItem(`sellpert-selling-scope:${merchantCode}`) || '' } catch { /* optional preference */ } }
      setSelection(rows.some(row => row.id === saved) || ['all', 'legacy'].includes(saved) ? saved
        : explicit.length && rows.some(row=>row.is_legacy) ? '' : explicit.length ? 'all' : 'legacy')
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [merchantCode, enabled, reload])
  const ids = useMemo(() => (accounts || []).filter(account => selection === 'all' ? !account.is_legacy
    : selection === 'legacy' ? account.is_legacy : account.id === selection).map(account => account.id), [accounts, selection])
  const client = useMemo(() => sellingAccountDataClient(supabase, merchantCode, ids), [merchantCode, ids])
  if (!enabled) return children
  if (error) return <DataLoadError onRetry={() => setReload(n => n + 1)} />
  if (!accounts) return <p role="status">جارٍ تحميل حسابات البيع…</p>
  function change(value: string) {
    setSelection(value)
    try { window.localStorage.setItem(`sellpert-selling-scope:${merchantCode}`,value) } catch { /* optional preference */ }
    const params = new URLSearchParams(window.location.search); params.set('account', value)
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }
  return <>
    <div className="merchant-page-frame selling-account-scope" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, minWidth: 0, maxWidth: '100%', flex: '0 1 320px' }}>نطاق حسابات البيع
        <select value={selection} onChange={event => change(event.target.value)} style={{ width: '100%', minWidth: 0, maxWidth: '100%', padding: 9, borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text)', background: 'var(--surface)' }}>
          <option value="" disabled>اختر مصدر البيانات</option>
          <option value="all">تجميع الحسابات المحددة الهوية</option>
          <option value="legacy">البيانات القديمة غير المنسوبة</option>
          {accounts.filter(account => !account.is_legacy).map(account => <option value={account.id} key={account.id}>{account.platform} · {account.label}</option>)}
        </select>
      </label>
      {accounts.some(account => account.is_legacy) ? <span style={{ color: 'var(--text2)', fontSize: 11, maxWidth: 560 }}>البيانات القديمة محفوظة في عرض مستقل حتى تتأكد هوية حسابها؛ لا تُجمع مع الربط الجديد تجنبًا للتكرار.</span> : null}
    </div>
    {selection ? <SelectedAccountsContext.Provider key={`${merchantCode}:${selection}`} value={(accounts || []).filter(account=>ids.includes(account.id))}><AccountDataContext.Provider value={client}>{children}</AccountDataContext.Provider></SelectedAccountsContext.Provider> : <p role="status" className="merchant-page-state">توجد بيانات قديمة وحسابات بيع محددة الهوية. اختر نطاق التقرير من القائمة أعلاه.</p>}
  </>
}
