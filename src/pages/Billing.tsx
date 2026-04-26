import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'

const PLANS = [
  { key: 'salla',      label: 'باقة سلة',      price: 99,  channels: ['سلة'],                                    color: '#7c6bff' },
  { key: 'growth',     label: 'باقة النمو',     price: 299, channels: ['سلة', 'أمازون', 'نون', 'تراندايول'],    color: '#00e5b0' },
  { key: 'pro',        label: 'باقة المحترف',   price: 599, channels: ['سلة', 'أمازون', 'نون', 'تراندايول'],    color: '#ff9900' },
  { key: 'enterprise', label: 'المؤسسات',       price: 999, channels: ['كل القنوات + دعم مخصص'],                  color: '#f27a1a' },
]

export default function Billing({ merchant }: { merchant: Merchant | null }) {
  const [sub, setSub]           = useState<any>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [bankInfo, setBankInfo] = useState({ iban: '', bank: '', holder: '' })
  const [pendingReq, setPendingReq] = useState<any>(null)
  const [loading, setLoading]   = useState(true)

  // Payment form
  const [selectedPlan, setSelectedPlan] = useState('')
  const [bankRef, setBankRef]   = useState('')
  const [transferDate, setTransferDate] = useState('')
  const [notes, setNotes]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg]           = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [showPayForm, setShowPayForm] = useState(false)

  const isSallaUser = merchant?.signup_source === 'salla_app' || sub?.billing_source === 'salla'

  useEffect(() => { if (merchant) load() }, [merchant])

  async function load() {
    setLoading(true)
    const [{ data: subData }, { data: invData }, { data: settings }, { data: reqData }] = await Promise.all([
      supabase.from('subscriptions').select('*').eq('merchant_code', merchant!.merchant_code).maybeSingle(),
      supabase.from('invoices').select('*').eq('merchant_code', merchant!.merchant_code).order('created_at', { ascending: false }).limit(12),
      supabase.from('app_settings').select('key,value').in('key', ['bank_iban','bank_name','bank_holder']),
      supabase.from('payment_requests').select('*').eq('merchant_code', merchant!.merchant_code).eq('status','pending').maybeSingle(),
    ])
    setSub(subData)
    setInvoices(invData || [])
    setPendingReq(reqData)
    const s: any = {}
    ;(settings || []).forEach((r: any) => { s[r.key] = r.value })
    setBankInfo({ iban: s.bank_iban || '', bank: s.bank_name || '', holder: s.bank_holder || '' })
    setLoading(false)
  }

  async function submitPaymentRequest() {
    if (!selectedPlan || !bankRef.trim() || !transferDate) {
      setMsg({ type: 'err', text: 'يرجى تعبئة جميع الحقول المطلوبة' }); return
    }
    setSubmitting(true)
    const plan = PLANS.find(p => p.key === selectedPlan)!
    const { data, error } = await supabase.rpc('request_plan_upgrade', {
      p_merchant_code: merchant!.merchant_code,
      p_new_plan: selectedPlan,
      p_period_months: 1,
    })
    if (error || !data?.ok) {
      setMsg({ type: 'err', text: error?.message || 'حدث خطأ' })
      setSubmitting(false); return
    }
    // Save bank reference details
    await supabase.from('payment_requests').update({
      bank_reference: bankRef.trim(),
      transfer_date: transferDate,
      notes: notes.trim() || null,
    }).eq('id', data.request_id)

    setMsg({ type: 'ok', text: `✅ تم إرسال طلب الدفع — سيتم تفعيل باقة ${plan.label} خلال ساعات العمل` })
    setShowPayForm(false)
    setBankRef(''); setTransferDate(''); setNotes(''); setSelectedPlan('')
    setSubmitting(false)
    load()
  }

  function daysLeft(dateStr: string) {
    const diff = new Date(dateStr).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / 86400000))
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const activePlan  = PLANS.find(p => p.key === (sub?.plan || merchant?.subscription_plan)) || PLANS[0]
  const periodEnd   = sub?.current_period_end
  const remaining   = periodEnd ? daysLeft(periodEnd) : 0
  const isActive    = merchant?.subscription_status === 'active'
  const isTrial     = sub?.status === 'trial'
  const isPending   = merchant?.subscription_status === 'pending_payment' || sub?.status === 'pending_payment'
  const isSuspended = merchant?.subscription_status === 'suspended'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>

      {/* Header */}
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💳 الاشتراك والفوترة</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>إدارة اشتراكك وعرض الفواتير</p>
      </div>

      {/* Alert message */}
      {msg && (
        <div style={{ padding: '12px 16px', borderRadius: 12, fontSize: 13, fontWeight: 600,
          background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)',
          color: msg.type === 'ok' ? 'var(--accent2)' : '#ff4d6d',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.25)' : 'rgba(255,77,109,0.25)'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {msg.text}
          <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Suspended banner */}
      {isSuspended && (
        <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 28 }}>🚫</span>
          <div>
            <div style={{ fontWeight: 800, color: '#ff4d6d', marginBottom: 4 }}>تم تعليق الاشتراك</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {isSallaUser ? 'جدّد اشتراكك من متجر تطبيقات سلة لإعادة التفعيل.' : 'يرجى تجديد اشتراكك بالضغط على "جدّد الاشتراك" أدناه.'}
            </div>
          </div>
        </div>
      )}

      {/* Pending payment banner */}
      {pendingReq && (
        <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(255,209,102,0.1)', border: '1px solid rgba(255,209,102,0.3)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 28 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 800, color: '#ffd166', marginBottom: 4 }}>بانتظار تأكيد الدفع</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              أرسلنا طلب تأكيد لفريق Sellpert — سيتم التفعيل خلال ساعات العمل.
              المبلغ: <strong>{pendingReq.total_amount} ر.س</strong> · الباقة: <strong>{PLANS.find(p=>p.key===pendingReq.plan)?.label}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Current plan card */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${activePlan.color}44`, borderRadius: 16, padding: '20px 24px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: `linear-gradient(90deg, ${activePlan.color}, ${activePlan.color}99)` }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 800 }}>{activePlan.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
                background: isActive ? 'rgba(0,229,176,0.15)' : isSuspended ? 'rgba(255,77,109,0.15)' : 'rgba(255,209,102,0.15)',
                color: isActive ? 'var(--accent2)' : isSuspended ? '#ff4d6d' : '#ffd166',
                border: `1px solid ${isActive ? 'rgba(0,229,176,0.3)' : isSuspended ? 'rgba(255,77,109,0.3)' : 'rgba(255,209,102,0.3)'}` }}>
                {isActive ? '✓ نشط' : isSuspended ? '⛔ معلّق' : '⏳ بانتظار الدفع'}
              </span>
              {isSallaUser && (
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(94,204,138,0.12)', color: '#5ecc8a', border: '1px solid rgba(94,204,138,0.25)', fontWeight: 700 }}>
                  🟢 سلة
                </span>
              )}
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: activePlan.color, marginBottom: 6 }}>
              {activePlan.price} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text3)' }}>ر.س / شهر</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {periodEnd && (
                <span>📅 تنتهي في: <strong style={{ color: remaining <= 7 ? '#ffd166' : 'var(--text)' }}>
                  {new Date(periodEnd).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {remaining <= 30 && ` (${remaining} يوم)`}
                </strong></span>
              )}
              <span>📡 القنوات: {activePlan.channels.join(' · ')}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {isSallaUser ? (
              <a href="https://salla.sa" target="_blank" rel="noopener noreferrer"
                style={{ padding: '10px 20px', borderRadius: 10, background: 'linear-gradient(135deg,#5ecc8a,#00c17d)', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                إدارة الاشتراك في سلة ↗
              </a>
            ) : (
              !showPayForm && (
                <button onClick={() => setShowPayForm(true)}
                  style={{ padding: '10px 20px', borderRadius: 10, background: `linear-gradient(135deg,${activePlan.color},${activePlan.color}cc)`, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {isSuspended || isPending ? '🔄 جدّد الاشتراك' : '⬆️ ترقية الباقة'}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Payment form — bank transfer */}
      {showPayForm && !isSallaUser && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>💳 طلب تجديد / ترقية الاشتراك</div>

          {/* Step 1: Choose plan */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>1. اختر الباقة</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {PLANS.map(p => (
                <button key={p.key} onClick={() => setSelectedPlan(p.key)}
                  style={{ padding: '12px 14px', borderRadius: 12, border: `2px solid ${selectedPlan === p.key ? p.color : 'var(--border)'}`,
                    background: selectedPlan === p.key ? p.color + '15' : 'var(--surface2)',
                    cursor: 'pointer', textAlign: 'right' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: selectedPlan === p.key ? p.color : 'var(--text)' }}>{p.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: p.color, marginTop: 4 }}>{p.price} <span style={{ fontSize: 10, fontWeight: 400 }}>ر.س/شهر</span></div>
                </button>
              ))}
            </div>
          </div>

          {selectedPlan && (
            <>
              {/* Step 2: Bank details */}
              <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>2. حوّل المبلغ إلى الحساب التالي</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'المبلغ', value: `${(PLANS.find(p=>p.key===selectedPlan)!.price * 1.15).toFixed(2)} ر.س (شامل VAT 15%)` },
                    { label: 'البنك', value: bankInfo.bank || 'البنك الأهلي السعودي' },
                    { label: 'اسم الحساب', value: bankInfo.holder || 'شركة Sellpert' },
                    { label: 'IBAN', value: bankInfo.iban || 'SA0000000000000000000000', mono: true },
                  ].map(({ label, value, mono }) => (
                    <div key={label} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                      <span style={{ color: 'var(--text3)', minWidth: 90 }}>{label}:</span>
                      <span style={{ fontWeight: 700, fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
                      {mono && <button onClick={() => navigator.clipboard.writeText(value)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>📋 نسخ</button>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 3: Confirm transfer */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 12 }}>3. أدخل تفاصيل التحويل</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>رقم مرجع التحويل *</label>
                    <input value={bankRef} onChange={e => setBankRef(e.target.value)}
                      placeholder="مثال: TXN123456789"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>تاريخ التحويل *</label>
                    <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>ملاحظات (اختياري)</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="أي معلومات إضافية..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={submitPaymentRequest} disabled={submitting}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? '⏳ جارٍ الإرسال...' : '📤 إرسال طلب التفعيل'}
                </button>
                <button onClick={() => { setShowPayForm(false); setMsg(null) }}
                  style={{ padding: '13px 20px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
                  إلغاء
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>🧾 الفواتير</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['رقم الفاتورة','الباقة','المبلغ','الضريبة','الإجمالي','الحالة','التاريخ'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text2)' }}>{inv.invoice_number}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>{PLANS.find(p=>p.key===inv.type)?.label || 'اشتراك'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700 }}>{Number(inv.amount).toLocaleString()} ر.س</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>{Number(inv.tax_amount || 0).toLocaleString()} ر.س</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800 }}>{Number(inv.total_amount).toLocaleString()} ر.س</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                        background: inv.status === 'paid' ? 'rgba(0,229,176,0.12)' : 'rgba(255,209,102,0.12)',
                        color: inv.status === 'paid' ? 'var(--accent2)' : '#ffd166' }}>
                        {inv.status === 'paid' ? '✓ مدفوعة' : inv.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {new Date(inv.created_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invoices.length === 0 && isActive && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          لا توجد فواتير بعد
        </div>
      )}
    </div>
  )
}
