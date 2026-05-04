import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { fmtRelative } from '../lib/formatters'
import { toastOk, toastErr } from '../components/Toast'
import { EmptyState } from '../components/UI'
import { Plus, MessageCircle, Send, X } from 'lucide-react'

const CATEGORIES: { key: string; label: string; icon: string; needsPlatform?: boolean; needsAmount?: boolean }[] = [
  { key: 'ad_budget_increase', label: 'رفع ميزانية إعلانات',  icon: '⬆️', needsPlatform: true, needsAmount: true },
  { key: 'ad_budget_decrease', label: 'خفض ميزانية إعلانات',  icon: '⬇️', needsPlatform: true, needsAmount: true },
  { key: 'price_change',       label: 'تغيير سعر منتج',        icon: '💲' },
  { key: 'shipping_change',    label: 'تغيير شركة الشحن',      icon: '🚚' },
  { key: 'inventory_update',   label: 'تحديث المخزون',         icon: '📦' },
  { key: 'add_product',        label: 'إضافة منتج جديد',       icon: '➕' },
  { key: 'remove_product',     label: 'إيقاف منتج',            icon: '🗑' },
  { key: 'inquiry',            label: 'استفسار عام',           icon: '💬' },
  { key: 'complaint',          label: 'شكوى',                  icon: '⚠️' },
  { key: 'other',              label: 'أخرى',                  icon: '🔹' },
]

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:     { label: '⏳ قيد المراجعة',   color: '#ffd166' },
  in_progress: { label: '⚙ قيد التنفيذ',     color: '#7c6bff' },
  review:      { label: '👀 ينتظر التأكيد',  color: '#4cc9f0' },
  blocked:     { label: '⛔ متوقّف',         color: '#e84040' },
  done:        { label: '✓ مكتمل',           color: '#00b894' },
  rejected:    { label: '✗ مرفوض',          color: '#888' },
}

const PRIORITIES: any = {
  urgent: { label: 'عاجل',    color: '#e84040' },
  high:   { label: 'مرتفع',   color: '#ff9900' },
  medium: { label: 'متوسط',   color: '#7c6bff' },
  low:    { label: 'منخفض',   color: '#888' },
}

export default function Requests({ merchant }: { merchant: Merchant | null }) {
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | string>('all')
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<any | null>(null)

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data } = await supabase.from('merchant_requests').select('*')
      .eq('merchant_code', merchant.merchant_code).order('created_at', { ascending: false })
    setTickets(data || [])
    setLoading(false)
  }

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🎫 تذاكر الدعم</h2>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>اكتب طلبك أو استفسارك وفريق Sellpert يتابعه ويرد عليك</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          <Plus size={14} /> إنشاء تذكرة جديدة
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { v: 'all',         l: 'الكل', n: tickets.length },
          { v: 'pending',     l: 'قيد المراجعة', n: tickets.filter(t => t.status === 'pending').length },
          { v: 'in_progress', l: 'قيد التنفيذ', n: tickets.filter(t => t.status === 'in_progress').length },
          { v: 'done',        l: 'مكتمل', n: tickets.filter(t => t.status === 'done').length },
        ].map(b => (
          <button key={b.v} onClick={() => setFilter(b.v)} style={{
            padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            background: filter === b.v ? 'var(--accent)' : 'var(--surface2)',
            color: filter === b.v ? '#fff' : 'var(--text2)',
          }}>{b.l} ({b.n})</button>
        ))}
      </div>

      {loading ? null : filtered.length === 0 ? (
        <EmptyState icon="📭" title="لا توجد تذاكر" description="أنشئ تذكرة جديدة لأي طلب أو استفسار وفريقنا يتولّاه فوراً"
          action={<button onClick={() => setShowNew(true)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ إنشاء تذكرة</button>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(t => {
            const cat = CATEGORIES.find(c => c.key === (t.category || t.type))
            const sm = STATUS_META[t.status]
            const pm = PRIORITIES[t.priority || 'medium']
            return (
              <div key={t.id} onClick={() => setSelected(t)} style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '14px 18px', cursor: 'pointer',
                borderRight: `3px solid ${pm?.color || 'var(--accent)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 18 }}>{cat?.icon || '📋'}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title || cat?.label || t.type}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{cat?.label || t.type} · {fmtRelative(t.created_at)}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 12, background: sm?.color + '20', color: sm?.color, alignSelf: 'flex-start' }}>{sm?.label}</span>
                </div>
                {t.note && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.6, paddingRight: 26 }}>{String(t.note).slice(0, 150)}{String(t.note).length > 150 ? '…' : ''}</div>}
                {t.admin_note && t.status !== 'pending' && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(124,107,255,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--text2)' }}>
                    <b style={{ color: 'var(--accent)' }}>رد الفريق:</b> {String(t.admin_note).slice(0, 200)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showNew && <NewTicketModal merchant={merchant} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
      {selected && <TicketDetailModal ticket={selected} merchant={merchant} onClose={() => { setSelected(null); load() }} />}
    </div>
  )
}

function NewTicketModal({ merchant, onClose, onCreated }: { merchant: Merchant | null; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<'category' | 'form'>('category')
  const [category, setCategory] = useState<typeof CATEGORIES[number] | null>(null)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!merchant || !category) return
    if (!title.trim()) { toastErr('العنوان مطلوب'); return }
    setSaving(true)
    const details: any = {}
    if (amount) details.amount = parseFloat(amount)
    const { error } = await supabase.from('merchant_requests').insert({
      merchant_code: merchant.merchant_code,
      type: category.key as any,
      category: category.key,
      title: title.trim(),
      platform: platform || null,
      priority,
      note: note.trim() || null,
      details,
      created_by: merchant.merchant_code,
      created_by_role: 'merchant',
      status: 'pending',
    })
    setSaving(false)
    if (error) toastErr(error.message)
    else { toastOk('✓ أُرسلت التذكرة'); onCreated() }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: '100%', maxWidth: 580, marginTop: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{step === 'category' ? 'اختر نوع الطلب' : category?.label}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)' }}><X size={16} /></button>
        </div>

        {step === 'category' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {CATEGORIES.map(c => (
              <button key={c.key} onClick={() => { setCategory(c); setTitle(c.label); setStep('form') }} style={{
                background: 'var(--surface2)', border: '1px solid var(--border)', padding: '14px 12px',
                borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 24 }}>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <Field label="العنوان *">
              <input value={title} onChange={e => setTitle(e.target.value)} style={inp} placeholder={category?.label || ''} />
            </Field>
            {category?.needsPlatform && (
              <Field label="المنصة *">
                <select value={platform} onChange={e => setPlatform(e.target.value)} style={inp}>
                  <option value="">— اختر —</option>
                  <option value="noon">نون</option>
                  <option value="trendyol">تراندايول</option>
                  <option value="amazon">أمازون</option>
                  <option value="salla">سلة</option>
                </select>
              </Field>
            )}
            {category?.needsAmount && (
              <Field label="المبلغ المقترح (ر.س)">
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inp} placeholder="مثال: 500" />
              </Field>
            )}
            <Field label="الأولوية">
              <div style={{ display: 'flex', gap: 6 }}>
                {Object.entries(PRIORITIES).map(([k, v]: any) => (
                  <button key={k} onClick={() => setPriority(k as any)} style={{
                    flex: 1, padding: '8px', border: `1px solid ${priority === k ? v.color : 'var(--border)'}`,
                    borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    background: priority === k ? v.color : 'var(--surface2)',
                    color: priority === k ? '#fff' : 'var(--text2)',
                  }}>{v.label}</button>
                ))}
              </div>
            </Field>
            <Field label="التفاصيل">
              <textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...inp, minHeight: 90 }} placeholder="اشرح طلبك بالتفصيل…" />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
              <button onClick={() => setStep('category')} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '10px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>‹ رجوع</button>
              <button onClick={submit} disabled={saving} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Send size={14} /> {saving ? '...' : 'إرسال'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TicketDetailModal({ ticket, merchant, onClose }: { ticket: any; merchant: Merchant | null; onClose: () => void }) {
  const [comments, setComments] = useState<any[]>([])
  const [newComment, setNewComment] = useState('')
  const cat = CATEGORIES.find(c => c.key === (ticket.category || ticket.type))
  const sm = STATUS_META[ticket.status]

  useEffect(() => {
    supabase.from('task_comments').select('*').eq('task_id', ticket.id).eq('is_internal', false).order('created_at')
      .then(({ data }) => setComments(data || []))
  }, [ticket.id])

  async function addComment() {
    if (!newComment.trim() || !merchant) return
    await supabase.from('task_comments').insert({
      task_id: ticket.id, body: newComment.trim(),
      author_code: merchant.merchant_code, author_role: 'merchant', is_internal: false,
    })
    setNewComment('')
    const { data } = await supabase.from('task_comments').select('*').eq('task_id', ticket.id).eq('is_internal', false).order('created_at')
    setComments(data || [])
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: '100%', maxWidth: 600, marginTop: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{cat?.icon} {ticket.title || cat?.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtRelative(ticket.created_at)}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 14, background: sm?.color + '20', color: sm?.color }}>{sm?.label}</span>
        </div>

        {ticket.note && (
          <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>
            {ticket.note}
          </div>
        )}

        {ticket.admin_note && (
          <div style={{ padding: '12px 14px', background: 'rgba(124,107,255,0.08)', border: '1px solid rgba(124,107,255,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', marginBottom: 4 }}>رد فريق Sellpert:</div>
            {ticket.admin_note}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MessageCircle size={14} /> المحادثة ({comments.length})
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {comments.map(c => (
              <div key={c.id} style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 12,
                background: c.author_role === 'merchant' ? 'rgba(124,107,255,0.06)' : 'var(--surface2)',
                alignSelf: c.author_role === 'merchant' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: c.author_role === 'merchant' ? 'var(--accent)' : 'var(--text3)', marginBottom: 3 }}>
                  {c.author_role === 'merchant' ? 'أنت' : 'فريق Sellpert'} · {fmtRelative(c.created_at)}
                </div>
                <div style={{ color: 'var(--text)' }}>{c.body}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} placeholder="اكتب رد…" style={{ ...inp, flex: 1 }} />
            <button onClick={addComment} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Send size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>إغلاق</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '9px 12px', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
