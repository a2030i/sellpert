import { useEffect, useState } from 'react'
import { listSellingAccounts, manageSellingAccount, type SellingAccount } from '../lib/marketplaceAccounts'

/** The parent must remount actions/forms with the selected account ID. */
export default function SellingAccountChooser({ merchantCode, platform, value, onChange, allowCreate = true, disabled = false, includeLegacy = false, helpText = 'المزامنة وإلغاء الربط يخصان الحساب المحدد فقط.' }: {
  merchantCode: string; platform: string; value: string; onChange: (account: SellingAccount | null) => void; allowCreate?: boolean; disabled?: boolean; includeLegacy?: boolean; helpText?: string
}) {
  const [accounts, setAccounts] = useState<SellingAccount[]>([])
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    setBusy(true); setError(''); setAccounts([])
    listSellingAccounts(merchantCode, platform).then(rows => {
      if (cancelled) return
      const visible = rows.filter(row => includeLegacy || !row.is_legacy)
      setAccounts(visible)
      if (!visible.some(row => row.id === value)) onChange(visible[0] || null)
    }).catch(() => { if (!cancelled) setError('تعذر تحميل حسابات البيع') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
    // Selection is managed by the parent; it must not restart the list request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantCode, platform, reload, includeLegacy])
  async function create() {
    setBusy(true); setError('')
    try {
      const result = await manageSellingAccount({ action: 'create', merchant_code: merchantCode, platform, label: name.trim() })
      const account = { ...result.account, merchant_code: merchantCode, is_legacy: false, external_seller_id: null } as SellingAccount
      setAccounts(rows => [...rows, account]); onChange(account); setName(''); setAdding(false)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر إضافة الحساب') }
    finally { setBusy(false) }
  }
  return <div className="selling-account-chooser" style={{ marginBlock: 14, display: 'grid', gap: 8 }}>
    <label style={{ fontSize: 12, fontWeight: 700 }}>حساب البيع
      <select value={value} disabled={busy || disabled} onChange={event => onChange(accounts.find(row => row.id === event.target.value) || null)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 9, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <option value="">{busy ? 'جارٍ التحميل…' : 'اختر حسابًا'}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.label}{account.external_seller_id ? ` — ${account.external_seller_id}` : ''}{account.status === 'pending' ? ' · بانتظار الربط' : ''}</option>)}
      </select>
    </label>
    {error ? <div role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>إعادة المحاولة</button></div> : null}
    {allowCreate && !adding ? <button type="button" onClick={() => setAdding(true)} disabled={busy || disabled} style={{ justifySelf: 'start' }}>إضافة حساب بيع</button> : null}
    {adding ? <form onSubmit={event => { event.preventDefault(); void create() }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <label style={{ flex: '1 1 180px', minWidth: 0 }}>اسم الحساب
        <input autoFocus value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder="مثال: متجر الرياض" style={{ display: 'block', width: '100%' }} />
      </label>
      <button type="submit" disabled={busy || disabled || !name.trim()}>إضافة</button>
      <button type="button" disabled={busy || disabled} onClick={() => { setAdding(false); setName('') }}>إلغاء</button>
    </form> : null}
    <span style={{ color: 'var(--text2)', fontSize: 11 }}>{helpText}</span>
  </div>
}
