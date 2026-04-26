import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import type { Merchant } from '../../lib/supabase'

const TYPE_LABELS: Record<string, string> = {
  price_change: 'تغيير سعر', add_product: 'إضافة منتج',
  remove_product: 'إيقاف منتج', update_info: 'تعديل معلومات', other: 'أخرى',
}
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'بانتظار المراجعة', color: '#ffd166', bg: 'rgba(255,209,102,0.15)' },
  in_progress: { label: 'قيد التنفيذ',       color: '#4cc9f0', bg: 'rgba(76,201,240,0.15)'  },
  done:        { label: 'تم التنفيذ',         color: '#00e5b0', bg: 'rgba(0,229,176,0.15)'   },
  rejected:    { label: 'مرفوض',             color: '#ff4d6d', bg: 'rgba(255,77,109,0.15)'  },
}

export default function AdminRequestsView({ merchants }: { merchants: Merchant[] }) {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'pending' | 'in_progress' | 'done' | 'rejected'>('pending')
  const [editReq, setEditReq]   = useState<any | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('merchant_requests').select('*').order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  async function resolve() {
    if (!editReq || !newStatus) return
    setSaving(true)
    const { error } = await supabase.from('merchant_requests').update({
      status: newStatus,
      admin_note: adminNote.trim() || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', editReq.id)
    if (error) setMsg({ type: 'err', text: error.message })
    else { setMsg({ type: 'ok', text: '✅ تم تحديث الطلب' }); setEditReq(null); load() }
    setSaving(false)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const getMName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code
  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    in_progress: requests.filter(r => r.status === 'in_progress').length,
    done: requests.filter(r => r.status === 'done').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>

  return (
    <div>
      {msg && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}` }}>
          {msg.text}
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['all', 'pending', 'in_progress', 'done', 'rejected'] as const).map(k => (
          <button key={k} style={{ padding: '9px 16px', background: 'transparent', border: 'none', color: filter === k ? 'var(--accent)' : 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderBottom: `2px solid ${filter === k ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setFilter(k)}>
            {k === 'all' ? 'الكل' : STATUS_META[k].label}
            {counts[k] > 0 && <span style={{ background: k === 'pending' ? '#ff4d6d' : 'var(--surface2)', color: k === 'pending' ? '#fff' : 'var(--text3)', padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 800 }}>{counts[k]}</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '60px 20px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد طلبات</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(req => {
            const st = STATUS_META[req.status]
            return (
              <div key={req.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ background: 'rgba(124,107,255,0.12)', color: 'var(--accent)', padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>{TYPE_LABELS[req.type] || req.type}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{getMName(req.merchant_code)}</span>
                    {req.details?.product_name && <span style={{ fontSize: 12, color: 'var(--text2)' }}>— {req.details.product_name}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st?.bg, color: st?.color }}>{st?.label}</span>
                    <button style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                      onClick={() => { setEditReq(req); setAdminNote(req.admin_note || ''); setNewStatus(req.status) }}>
                      معالجة
                    </button>
                  </div>
                </div>

                {req.type === 'price_change' && req.details?.new_target_price && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>
                    السعر الصافي المطلوب: <strong style={{ color: 'var(--accent)' }}>{req.details.new_target_price} ر.س</strong>
                  </div>
                )}
                {req.note && (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>ملاحظة التاجر: </span>{req.note}
                  </div>
                )}
                {req.admin_note && (
                  <div style={{ background: 'rgba(124,107,255,0.07)', border: '1px solid rgba(124,107,255,0.2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--accent)' }}>
                    <span style={{ fontWeight: 700 }}>ردك: </span>{req.admin_note}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
                  {new Date(req.created_at).toLocaleString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '24px 28px', width: '100%', maxWidth: 460 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>معالجة الطلب</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>{getMName(editReq.merchant_code)} — {TYPE_LABELS[editReq.type]}</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>تغيير الحالة</label>
              <select style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 9, fontSize: 13, width: '100%', outline: 'none' }}
                value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                <option value="pending">بانتظار المراجعة</option>
                <option value="in_progress">قيد التنفيذ</option>
                <option value="done">تم التنفيذ</option>
                <option value="rejected">مرفوض</option>
              </select>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>رد للتاجر (اختياري)</label>
              <textarea style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, width: '100%', height: 80, outline: 'none', resize: 'vertical', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
                value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="تفاصيل الرد أو سبب الرفض..." />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ background: 'var(--accent2)', color: '#111', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={resolve} disabled={saving}>{saving ? '⟳' : '✓ حفظ'}</button>
              <button style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer' }} onClick={() => setEditReq(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
