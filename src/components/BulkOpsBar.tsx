import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Bell, Pause, Play, X, Send, FileText } from 'lucide-react'
import { toastOk, toastErr } from './Toast'

interface Props {
  selected: string[]            // merchant_codes
  onClear: () => void
  onDone: () => void
}

type BulkAction = 'notify' | 'suspend' | 'unsuspend' | 'set_plan' | 'add_note'

export default function BulkOpsBar({ selected, onClear, onDone }: Props) {
  const [showModal, setShowModal] = useState<BulkAction | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // form fields
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyBody, setNotifyBody] = useState('')
  const [planTo, setPlanTo] = useState('basic')
  const [noteBody, setNoteBody] = useState('')

  if (selected.length === 0) return null

  async function bulkNotify() {
    if (!notifyTitle.trim() || !notifyBody.trim()) { toastErr('العنوان والنص مطلوبان'); return }
    setSubmitting(true)
    const { error, data } = await supabase.rpc('bulk_notify', {
      merchant_codes: selected, title: notifyTitle, body: notifyBody, action_path: null,
    })
    setSubmitting(false)
    if (error) toastErr(error.message)
    else {
      toastOk(`تم إرسال الإشعار إلى ${data || selected.length} تاجر`)
      setShowModal(null); setNotifyTitle(''); setNotifyBody('')
      onDone()
    }
  }

  async function bulkSuspend(suspended: boolean) {
    setSubmitting(true)
    const { error } = await supabase.from('merchants')
      .update({ suspended_until: suspended ? '2099-12-31' : null })
      .in('merchant_code', selected)
    setSubmitting(false)
    if (error) toastErr(error.message)
    else {
      toastOk(`تم ${suspended ? 'إيقاف' : 'تفعيل'} ${selected.length} تاجر`)
      setShowModal(null)
      onDone()
    }
  }

  async function bulkSetPlan() {
    setSubmitting(true)
    const { error } = await supabase.from('merchants')
      .update({ subscription_plan: planTo })
      .in('merchant_code', selected)
    setSubmitting(false)
    if (error) toastErr(error.message)
    else {
      toastOk(`تم تحديث خطة ${selected.length} تاجر`)
      setShowModal(null)
      onDone()
    }
  }

  async function bulkAddNote() {
    if (!noteBody.trim()) { toastErr('نص الملاحظة مطلوب'); return }
    setSubmitting(true)
    const { data: u } = await supabase.auth.getUser()
    const rows = selected.map(code => ({
      merchant_code: code,
      body: noteBody.trim(),
      type: 'note',
      author_email: u?.user?.email || null,
    }))
    const { error } = await supabase.from('merchant_notes').insert(rows)
    setSubmitting(false)
    if (error) toastErr(error.message)
    else {
      toastOk(`تمت إضافة ملاحظة لـ ${selected.length} تاجر`)
      setShowModal(null); setNoteBody('')
      onDone()
    }
  }

  return (
    <>
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'linear-gradient(135deg,#6c5ce7,#9f8fff)', color: '#fff',
        padding: '10px 14px', borderRadius: 10, marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
        boxShadow: '0 4px 20px rgba(108,92,231,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>تم اختيار {selected.length} تاجر</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <BulkBtn Icon={Bell} label="إشعار" onClick={() => setShowModal('notify')} />
          <BulkBtn Icon={FileText} label="ملاحظة" onClick={() => setShowModal('add_note')} />
          <BulkBtn Icon={Send} label="تغيير الخطة" onClick={() => setShowModal('set_plan')} />
          <BulkBtn Icon={Pause} label="إيقاف" onClick={() => setShowModal('suspend')} />
          <BulkBtn Icon={Play} label="تفعيل" onClick={() => setShowModal('unsuspend')} />
          <button onClick={onClear} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
            padding: '6px 10px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
          }}><X size={12} /> إلغاء</button>
        </div>
      </div>

      {showModal && (
        <div onClick={() => !submitting && setShowModal(null)} style={modalOverlayStyle}>
          <div onClick={e => e.stopPropagation()} style={modalStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginTop: 0, marginBottom: 6 }}>
              {modalTitle(showModal)}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
              ستطبَّق على {selected.length} تاجر
            </div>

            {showModal === 'notify' && (
              <>
                <label style={labelStyle}>العنوان</label>
                <input value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} style={inputStyle} placeholder="مثال: تحديث جديد" />
                <label style={labelStyle}>النص</label>
                <textarea value={notifyBody} onChange={e => setNotifyBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                <ModalActions onCancel={() => setShowModal(null)} onConfirm={bulkNotify} submitting={submitting} confirmLabel="إرسال" />
              </>
            )}

            {showModal === 'add_note' && (
              <>
                <label style={labelStyle}>الملاحظة</label>
                <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} placeholder="ستضاف نفس الملاحظة لكل تاجر مختار" />
                <ModalActions onCancel={() => setShowModal(null)} onConfirm={bulkAddNote} submitting={submitting} confirmLabel="إضافة" />
              </>
            )}

            {showModal === 'set_plan' && (
              <>
                <label style={labelStyle}>الخطة الجديدة</label>
                <select value={planTo} onChange={e => setPlanTo(e.target.value)} style={inputStyle}>
                  <option value="free">مجاني</option>
                  <option value="basic">أساسي</option>
                  <option value="pro">برو</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <ModalActions onCancel={() => setShowModal(null)} onConfirm={bulkSetPlan} submitting={submitting} confirmLabel="تحديث" />
              </>
            )}

            {showModal === 'suspend' && (
              <>
                <div style={{ background: 'rgba(232,64,64,0.08)', border: '1px solid rgba(232,64,64,0.3)', borderRadius: 9, padding: 12, fontSize: 12, color: 'var(--text)', marginBottom: 14 }}>
                  ⚠️ سيتم إيقاف الوصول لـ {selected.length} تاجر فوراً
                </div>
                <ModalActions onCancel={() => setShowModal(null)} onConfirm={() => bulkSuspend(true)} submitting={submitting} confirmLabel="إيقاف الكل" danger />
              </>
            )}

            {showModal === 'unsuspend' && (
              <>
                <div style={{ background: 'rgba(0,184,148,0.08)', border: '1px solid rgba(0,184,148,0.3)', borderRadius: 9, padding: 12, fontSize: 12, color: 'var(--text)', marginBottom: 14 }}>
                  ✓ سيتم تفعيل الوصول لـ {selected.length} تاجر
                </div>
                <ModalActions onCancel={() => setShowModal(null)} onConfirm={() => bulkSuspend(false)} submitting={submitting} confirmLabel="تفعيل الكل" />
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function modalTitle(a: BulkAction) {
  return a === 'notify' ? 'إرسال إشعار جماعي'
    : a === 'add_note' ? 'إضافة ملاحظة جماعية'
    : a === 'set_plan' ? 'تغيير الخطة'
    : a === 'suspend' ? 'إيقاف التجار'
    : a === 'unsuspend' ? 'تفعيل التجار'
    : ''
}

function BulkBtn({ Icon, label, onClick }: any) {
  return (
    <button onClick={onClick} style={{
      background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)',
      color: '#fff', padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
    }}><Icon size={12} /> {label}</button>
  )
}

function ModalActions({ onCancel, onConfirm, submitting, confirmLabel, danger }: any) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
      <button onClick={onCancel} disabled={submitting} style={{
        background: 'var(--surface2)', border: '1px solid var(--border)',
        color: 'var(--text2)', padding: '8px 16px', borderRadius: 8,
        fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}>إلغاء</button>
      <button onClick={onConfirm} disabled={submitting} style={{
        background: danger ? '#e84040' : 'var(--accent)', border: 'none', color: '#fff',
        padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
        cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
      }}>
        {submitting ? 'جاري...' : confirmLabel}
      </button>
    </div>
  )
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,18,40,0.65)',
  backdropFilter: 'blur(4px)', zIndex: 10002,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const modalStyle: React.CSSProperties = {
  width: '100%', maxWidth: 460, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 14, padding: 20,
  boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, marginTop: 8 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', marginBottom: 4 }
