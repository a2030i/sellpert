import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PLATFORM_MAP } from '../lib/constants'

type Scheduled = { platform: string; payout_date: string; amount: number; status: string; note?: string }
type Pending = { platform: string; sales: number; last_data_date: string }

function fmtSAR(v: number) { return Math.round(v).toLocaleString('ar-SA-u-nu-latn') + ' ر.س' }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }) }
function relDays(d: string) {
  const days = Math.round((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'اليوم'
  if (days === 1) return 'غداً'
  return `بعد ${days} يوم`
}

/**
 * رزنامة الكاش — «القادم لحسابك: كم ومتى». سؤال التاجر الأول.
 * المواعيد المؤكّدة يُدخلها فريق الحسابات (النموذج مُدار)؛ وبدونها نعرض «مبيعات
 * بانتظار التحويل» (قبل الرسوم) كتقدير خام مع توضيح أن الصافي والموعد يؤكّدهما الفريق.
 */
export default function PayoutCalendar({ merchantCode, compact }: { merchantCode?: string; compact?: boolean }) {
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    supabase.rpc('merchant_payouts', { p_merchant_code: merchantCode }).then(({ data }) => {
      const d: any = data || {}
      setScheduled(d.scheduled || [])
      setPending(d.pending_sales || [])
      setLoaded(true)
    })
  }, [merchantCode])

  if (!loaded) return null
  const upcoming = scheduled.filter(s => s.status === 'expected')
  const next = upcoming[0]
  const hasContent = next || pending.length > 0
  if (!hasContent) return null

  // بطاقة مصغّرة (اللوحة الرئيسية): سطر «القادم لحسابك» فقط
  if (compact) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20, borderRight: '4px solid var(--accent)' }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, fontWeight: 700 }}>💰 القادم لحسابك</div>
        {next ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{fmtSAR(next.amount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{PLATFORM_MAP[next.platform] || next.platform} · {relDays(next.payout_date)} ({fmtDate(next.payout_date)})</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>بانتظار تأكيد فريقك لموعد تحويلك</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>مبيعات بانتظار التحويل: {fmtSAR(pending.reduce((a, p) => a + p.sales, 0))} (قبل الرسوم)</div>
          </>
        )}
      </div>
    )
  }

  // بطاقة كاملة (كشف الحساب)
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>💰 القادم لحسابك</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>متى تصلك مستحقاتك وكم — مواعيد يؤكّدها فريق الحسابات</div>

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
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>مبيعات بانتظار التحويل <span style={{ fontWeight: 500, color: 'var(--text3)' }}>(قبل رسوم المنصة — الصافي يؤكّده فريقك)</span></div>
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
