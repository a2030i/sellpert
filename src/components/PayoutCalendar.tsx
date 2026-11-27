import { useEffect, useState } from 'react'
import { useSellingAccountClient } from './SellingAccountScope'
import { fetchAllStrict, withTimeout } from '../lib/db'
import DataLoadError from './DataLoadError'
import { PLATFORM_MAP } from '../lib/constants'

type Scheduled = { platform: string; payout_date: string; amount: number; status: string; note?: string }
type Pending = { platform: string; sales: number; last_data_date: string }

function fmtSAR(v: number) {
  return Number(v || 0).toLocaleString('ar-SA-u-nu-latn', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ر.س'
}
function fmtDate(d: string) { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }) }
function relDays(d: string) {
  const days = Math.round((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'اليوم'
  if (days === 1) return 'غداً'
  return `بعد ${days} يوم`
}

/** Workspace-scheduled payouts and separately labelled account-scoped recent sales. */
export default function PayoutCalendar({ merchantCode, compact }: { merchantCode?: string; compact?: boolean }) {
  const supabase = useSellingAccountClient()
  const [error,setError] = useState(false)
  const [retry,setRetry] = useState(0)
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    let active = true; setError(false); setLoaded(false)
    const start = new Date(); start.setUTCDate(start.getUTCDate()-29)
    Promise.all([
      withTimeout(supabase.rpc('merchant_payouts', { p_merchant_code: merchantCode })),
      fetchAllStrict<any>((from,to)=>supabase.from('performance_data').select('platform,total_sales,data_date').eq('merchant_code',merchantCode).gte('data_date',start.toISOString().slice(0,10)).lte('data_date',new Date().toISOString().slice(0,10)).order('id').range(from,to),'مبيعات الحسابات المحددة'),
    ]).then(([result,rows])=>{
      if (!active) return
      if (result.error) throw result.error
      setScheduled((result.data as any)?.scheduled || [])
      const groups = new Map<string,Pending>()
      for (const row of rows) {
        const group=groups.get(row.platform)||{platform:row.platform,sales:0,last_data_date:''}
        group.sales+=Number(row.total_sales)||0
        if (row.data_date>group.last_data_date) group.last_data_date=row.data_date
        groups.set(row.platform,group)
      }
      setPending([...groups.values()].filter(row=>row.sales>0)); setLoaded(true)
    }).catch(()=>{if(active)setError(true)})
    return ()=>{active=false}
  }, [merchantCode,supabase,retry])

  if (error) return <DataLoadError onRetry={()=>setRetry(value=>value+1)} />
  if (!loaded) return null
  const upcoming = scheduled.filter(s => s.status === 'expected')
  const next = upcoming[0]
  const hasContent = next || pending.length > 0
  if (!hasContent) return null

  // بطاقة مصغّرة (اللوحة الرئيسية): سطر «القادم لحسابك» فقط
  if (compact) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, borderRight: '4px solid var(--accent)' }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, fontWeight: 700 }}>مواعيد التحويل — المتجر كاملًا</div>
        {next ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{fmtSAR(next.amount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{PLATFORM_MAP[next.platform] || next.platform} · {relDays(next.payout_date)} ({fmtDate(next.payout_date)})</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>لا يوجد موعد تحويل مؤكد حاليًا</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>مبيعات آخر 30 يومًا للحسابات المحددة: {fmtSAR(pending.reduce((a, p) => a + p.sales, 0))} (قبل الرسوم، ليست رصيدًا مستحقًا)</div>
          </>
        )}
      </div>
    )
  }

  // بطاقة كاملة (كشف الحساب)
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>مواعيد التحويل — المتجر كاملًا</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>مواعيد فريق الحسابات تخص المتجر كاملًا؛ ملخص المبيعات أدناه يخص حسابات البيع المحددة فقط.</div>

      {upcoming.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: pending.length ? 16 : 0 }}>
          {upcoming.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10 }}>
              <div style={{ width: 42, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{new Date(s.payout_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric' })}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{new Date(s.payout_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short' })}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{fmtSAR(s.amount)}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_MAP[s.platform] || s.platform} · {relDays(s.payout_date)}{s.note ? ` · ${s.note}` : ''}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'var(--success-bg)', color: 'var(--success-text)' }}>مؤكّد</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '12px 14px', background: 'var(--warning-bg)', borderRadius: 10, fontSize: 13, color: 'var(--warning-text)', fontWeight: 600, marginBottom: 16 }}>
          لم يُضِف فريقك موعد تحويلك القادم بعد — سيظهر هنا فور تأكيده.
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>مبيعات آخر 30 يومًا <span style={{ fontWeight: 500, color: 'var(--text3)' }}>(الحسابات المحددة، قبل الرسوم؛ لا تثبت مبالغ لم تُحوّل)</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pending.map((p, i) => (
              <div key={i} style={{ flex: '1 1 160px', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 9 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_MAP[p.platform] || p.platform}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{fmtSAR(p.sales)}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>مبيعات حتى {fmtDate(p.last_data_date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
