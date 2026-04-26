import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'

const PLAN_LABELS: Record<string, string> = {
  free: 'مجاني', salla: 'باقة سلة', growth: 'باقة النمو',
  pro: 'باقة المحترف', enterprise: 'المؤسسات',
}
const PLAN_COLORS: Record<string, string> = {
  free: '#888', salla: '#7c6bff', growth: '#00e5b0', pro: '#ff9900', enterprise: '#f27a1a',
}

function RequestCard({ req, onConfirm, onReject }: { req: any; onConfirm: () => void; onReject: () => void }) {
  const planLabel = PLAN_LABELS[req.plan] || req.plan
  const planColor = PLAN_COLORS[req.plan] || '#888'
  const statusStyles: Record<string, React.CSSProperties> = {
    pending:  { background: 'rgba(255,153,0,0.1)',  border: '1px solid rgba(255,153,0,0.3)',  color: '#ff9900' },
    approved: { background: 'rgba(0,229,176,0.1)',  border: '1px solid rgba(0,229,176,0.3)',  color: '#00e5b0' },
    rejected: { background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', color: '#ff4d6d' },
  }
  const statusLabel: Record<string, string> = { pending: '⏳ معلق', approved: '✅ مؤكد', rejected: '❌ مرفوض' }

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${req.status === 'pending' ? 'rgba(255,153,0,0.3)' : 'var(--border)'}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={S.codeTag}>{req.merchant_code}</span>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: planColor + '22', color: planColor }}>
              {planLabel}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>
            {req.amount?.toLocaleString('ar-SA')} ر.س
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginRight: 6 }}>+ ضريبة {req.tax_amount?.toFixed(2)} ر.س = {req.total_amount?.toFixed(2)} ر.س</span>
          </div>
        </div>
        <span style={{ ...(statusStyles[req.status] || {}), padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
          {statusLabel[req.status] || req.status}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
        {req.bank_reference && (
          <div><span style={{ color: 'var(--text3)' }}>رقم الحوالة: </span><span style={{ fontFamily: 'monospace', color: 'var(--text)', fontWeight: 600 }}>{req.bank_reference}</span></div>
        )}
        {req.transfer_date && (
          <div><span style={{ color: 'var(--text3)' }}>تاريخ التحويل: </span>{new Date(req.transfer_date).toLocaleDateString('ar-SA')}</div>
        )}
        <div><span style={{ color: 'var(--text3)' }}>تاريخ الطلب: </span>{new Date(req.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}</div>
        {req.notes && (
          <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text3)' }}>ملاحظات التاجر: </span>{req.notes}</div>
        )}
        {req.admin_note && (
          <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text3)' }}>ملاحظة المدير: </span><span style={{ color: req.status === 'rejected' ? '#ff4d6d' : '#00e5b0' }}>{req.admin_note}</span></div>
        )}
      </div>

      {req.status === 'pending' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onReject} style={{ ...S.miniBtn, color: '#ff4d6d', borderColor: 'rgba(255,77,109,0.3)' }}>❌ رفض</button>
          <button onClick={onConfirm} style={{ flex: 1, background: 'linear-gradient(135deg,#00e5b0,#00b88a)', border: 'none', color: '#0a1628', padding: '9px', borderRadius: 9, fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
            ✅ تأكيد استلام الدفع وتفعيل الاشتراك
          </button>
        </div>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, maxWidth: 440, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text3)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function AdminBillingView() {
  const [requests, setRequests]   = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rejectId, setRejectId]   = useState<string | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    let q = supabase.from('payment_requests').select('*').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter)
    const { data } = await q
    setRequests(data || [])
    setLoading(false)
  }

  async function confirm(id: string) {
    setSaving(true)
    const { error } = await supabase.rpc('confirm_manual_payment', { p_request_id: id, p_admin_note: actionNote || null })
    setSaving(false)
    setConfirmId(null)
    setActionNote('')
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: 'تم تأكيد الدفع وتفعيل الاشتراك' })
    load()
  }

  async function reject(id: string) {
    setSaving(true)
    const { error } = await supabase.rpc('reject_payment_request', { p_request_id: id, p_admin_note: actionNote || 'رُفض الطلب من قبل المدير' })
    setSaving(false)
    setRejectId(null)
    setActionNote('')
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: 'تم رفض الطلب وإشعار التاجر' })
    load()
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'ok' ? S.msgOk : S.msgErr) }}>
          {msg.text}
          <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'معلقة',   value: requests.filter(r => r.status === 'pending').length,  color: '#ff9900' },
          { label: 'مؤكدة',  value: requests.filter(r => r.status === 'approved').length, color: '#00e5b0' },
          { label: 'مرفوضة', value: requests.filter(r => r.status === 'rejected').length, color: '#ff4d6d' },
          { label: 'إجمالي', value: requests.length,                                       color: 'var(--accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {pendingCount > 0 && (
        <div style={{ background: 'rgba(255,153,0,0.08)', border: '1px solid rgba(255,153,0,0.3)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#ff9900', fontWeight: 600 }}>
          ⚠️ يوجد {pendingCount} طلب{pendingCount > 1 ? 'ات' : ''} دفع تنتظر المراجعة
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['pending', 'all', 'approved', 'rejected'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...S.tabBtn, ...(filter === f ? S.tabActive : {}), fontSize: 12 }}>
            {{ pending: '⏳ معلقة', all: '📋 الكل', approved: '✅ مؤكدة', rejected: '❌ مرفوضة' }[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>جاري التحميل...</div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💳</div>
          <div>لا توجد طلبات دفع</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requests.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              onConfirm={() => { setConfirmId(req.id); setActionNote('') }}
              onReject={() => { setRejectId(req.id); setActionNote('') }}
            />
          ))}
        </div>
      )}

      {confirmId && (
        <Modal title="تأكيد استلام الدفع" onClose={() => setConfirmId(null)}>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.7 }}>
            هل تأكدت من استلام التحويل البنكي؟ سيتم تفعيل اشتراك التاجر فوراً عند التأكيد.
          </p>
          <label style={S.label}>ملاحظة (اختياري)</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
            placeholder="مثال: تم استلام التحويل بتاريخ ..." rows={3}
            style={{ ...S.input, resize: 'vertical', marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmId(null)} style={{ flex: 1, ...S.miniBtn }}>إلغاء</button>
            <button onClick={() => confirm(confirmId)} disabled={saving}
              style={{ flex: 2, background: '#00e5b0', border: 'none', color: '#0a1628', padding: '10px', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
              {saving ? 'جاري التأكيد...' : '✅ تأكيد الاستلام وتفعيل الاشتراك'}
            </button>
          </div>
        </Modal>
      )}

      {rejectId && (
        <Modal title="رفض طلب الدفع" onClose={() => setRejectId(null)}>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>سيتم رفض الطلب وإشعار التاجر بالرفض.</p>
          <label style={S.label}>سبب الرفض</label>
          <textarea value={actionNote} onChange={e => setActionNote(e.target.value)}
            placeholder="مثال: لم يتم العثور على التحويل..." rows={3}
            style={{ ...S.input, resize: 'vertical', marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setRejectId(null)} style={{ flex: 1, ...S.miniBtn }}>إلغاء</button>
            <button onClick={() => reject(rejectId)} disabled={saving || !actionNote.trim()}
              style={{ flex: 2, background: '#ff4d6d', border: 'none', color: '#fff', padding: '10px', borderRadius: 10, fontWeight: 800, cursor: saving || !actionNote.trim() ? 'not-allowed' : 'pointer', opacity: !actionNote.trim() ? 0.5 : 1, fontSize: 13 }}>
              {saving ? 'جاري الرفض...' : '❌ رفض الطلب'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
