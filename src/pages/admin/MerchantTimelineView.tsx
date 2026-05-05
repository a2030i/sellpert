import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  ArrowRight, MessageSquare, Phone, Mail, Calendar, AlertCircle, Trophy,
  FileText, Upload, Bell, Pin, Trash2, Plus,
} from 'lucide-react'
import { toastOk, toastErr } from '../../components/Toast'
import { fmtRelative } from '../../lib/formatters'

interface TimelineItem {
  merchant_code: string
  kind: 'note' | 'task' | 'upload' | 'notification'
  ref_id: string
  title: string
  body: string | null
  meta: Record<string, any> | null
  pinned: boolean
  author_email: string | null
  author_name: string | null
  occurred_at: string
}

interface Note {
  id: string
  body: string
  type: string
  pinned: boolean
  author_email: string | null
  author_name: string | null
  created_at: string
}

interface Props {
  merchantCode: string
  onBack: () => void
}

const NOTE_TYPES = [
  { value: 'note', label: 'ملاحظة', Icon: MessageSquare, color: '#7c6bff' },
  { value: 'call', label: 'مكالمة', Icon: Phone, color: '#00b894' },
  { value: 'email', label: 'بريد', Icon: Mail, color: '#f0a800' },
  { value: 'whatsapp', label: 'واتساب', Icon: MessageSquare, color: '#25d366' },
  { value: 'meeting', label: 'اجتماع', Icon: Calendar, color: '#6c5ce7' },
  { value: 'issue', label: 'مشكلة', Icon: AlertCircle, color: '#e84040' },
  { value: 'win', label: 'إنجاز', Icon: Trophy, color: '#f0a800' },
]

export default function MerchantTimelineView({ merchantCode, onBack }: Props) {
  const [merchant, setMerchant] = useState<any>(null)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'note' | 'task' | 'upload' | 'notification'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [newType, setNewType] = useState('note')
  const [newPinned, setNewPinned] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [merchantCode])

  async function load() {
    setLoading(true)
    const [{ data: m }, { data: tl }] = await Promise.all([
      supabase.from('merchants').select('merchant_code,name,email,phone,sector').eq('merchant_code', merchantCode).maybeSingle(),
      supabase.from('merchant_timeline').select('*').eq('merchant_code', merchantCode).order('occurred_at', { ascending: false }).limit(200),
    ])
    setMerchant(m)
    setItems(tl || [])
    setLoading(false)
  }

  async function addNote() {
    if (!newBody.trim()) return
    setSaving(true)
    const { data: u } = await supabase.auth.getUser()
    const email = u?.user?.email || null
    const { error } = await supabase.from('merchant_notes').insert({
      merchant_code: merchantCode,
      body: newBody.trim(),
      type: newType,
      pinned: newPinned,
      author_email: email,
      author_name: u?.user?.user_metadata?.full_name || null,
    })
    setSaving(false)
    if (error) toastErr(error.message)
    else {
      toastOk('تمت إضافة الملاحظة')
      setNewBody(''); setNewPinned(false); setShowAdd(false)
      load()
    }
  }

  async function deleteNote(id: string) {
    if (!confirm('حذف هذه الملاحظة؟')) return
    const { error } = await supabase.from('merchant_notes').delete().eq('id', id)
    if (error) toastErr(error.message)
    else { toastOk('تم الحذف'); load() }
  }

  async function togglePin(id: string, pinned: boolean) {
    await supabase.from('merchant_notes').update({ pinned: !pinned }).eq('id', id)
    load()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.kind === filter)
  const pinnedItems = filtered.filter(i => i.pinned && i.kind === 'note')
  const regularItems = filtered.filter(i => !(i.pinned && i.kind === 'note'))

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={onBack} style={backBtnStyle}>
          <ArrowRight size={14} /> عودة
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {merchant?.name || merchantCode}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {merchant?.merchant_code} · {merchant?.email} {merchant?.sector && `· ${merchant.sector}`}
          </div>
        </div>
        <button onClick={() => setShowAdd(s => !s)} style={addBtnStyle}>
          <Plus size={14} /> ملاحظة
        </button>
      </div>

      {/* Add note form */}
      {showAdd && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {NOTE_TYPES.map(t => {
              const Icon = t.Icon
              const active = newType === t.value
              return (
                <button key={t.value} onClick={() => setNewType(t.value)} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                  border: '1px solid ' + (active ? t.color : 'var(--border)'),
                  background: active ? t.color + '20' : 'var(--surface2)',
                  color: active ? t.color : 'var(--text2)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Icon size={12} />{t.label}
                </button>
              )
            })}
          </div>
          <textarea value={newBody} onChange={e => setNewBody(e.target.value)} rows={3}
            placeholder="اكتب ملاحظتك..."
            style={{
              width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 9,
              background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, resize: 'vertical',
              fontFamily: 'inherit',
            }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={newPinned} onChange={e => setNewPinned(e.target.checked)} />
              تثبيت في الأعلى
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { setShowAdd(false); setNewBody('') }} style={cancelBtnStyle}>إلغاء</button>
              <button onClick={addNote} disabled={saving || !newBody.trim()} style={{ ...saveBtnStyle, opacity: !newBody.trim() ? 0.5 : 1 }}>
                {saving ? 'جاري...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--surface2)', padding: 3, borderRadius: 9, flexWrap: 'wrap' }}>
        {[
          { v: 'all', l: 'الكل' },
          { v: 'note', l: 'ملاحظات' },
          { v: 'task', l: 'مهام' },
          { v: 'upload', l: 'ملفات' },
          { v: 'notification', l: 'إشعارات' },
        ].map(t => (
          <button key={t.v} onClick={() => setFilter(t.v as any)} style={{
            flex: '1 1 90px', padding: '6px 10px', fontSize: 12, fontWeight: 700,
            border: 'none', borderRadius: 7,
            background: filter === t.v ? 'var(--surface)' : 'transparent',
            color: filter === t.v ? 'var(--text)' : 'var(--text2)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{t.l}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }}>
          لا توجد سجلات بعد. أضف أول ملاحظة!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pinnedItems.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 0' }}>
                <Pin size={10} style={{ display: 'inline-block', marginLeft: 4 }} />
                مثبّت
              </div>
              {pinnedItems.map(it => <TimelineEntry key={it.kind + it.ref_id} item={it} onDelete={deleteNote} onTogglePin={togglePin} />)}
              <div style={{ height: 8 }} />
            </>
          )}
          {regularItems.map(it => <TimelineEntry key={it.kind + it.ref_id} item={it} onDelete={deleteNote} onTogglePin={togglePin} />)}
        </div>
      )}
    </div>
  )
}

function TimelineEntry({ item, onDelete, onTogglePin }: {
  item: TimelineItem
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) {
  const meta = getKindMeta(item)
  const Icon = meta.Icon
  const isNote = item.kind === 'note'

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid ' + (item.pinned ? meta.color + '40' : 'var(--border)'),
      borderRadius: 12, padding: 12, display: 'flex', gap: 10,
      borderRight: `3px solid ${meta.color}`,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: meta.color + '20', color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{item.title || meta.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {item.pinned && <Pin size={11} color={meta.color} />}
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtRelative(item.occurred_at)}</span>
            {isNote && (
              <>
                <button onClick={() => onTogglePin(item.ref_id, item.pinned)} style={miniBtnStyle} title={item.pinned ? 'إلغاء التثبيت' : 'تثبيت'}>
                  <Pin size={11} />
                </button>
                <button onClick={() => onDelete(item.ref_id)} style={{ ...miniBtnStyle, color: '#e84040' }} title="حذف">
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>
        </div>
        {item.body && <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.body}</div>}
        {item.author_name && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
            — {item.author_name}
          </div>
        )}
      </div>
    </div>
  )
}

function getKindMeta(item: TimelineItem) {
  if (item.kind === 'note') {
    const t = item.meta?.type as string
    const found = NOTE_TYPES.find(n => n.value === t)
    if (found) return found
    return NOTE_TYPES[0]
  }
  if (item.kind === 'task') return { label: 'مهمة', Icon: FileText, color: '#7c6bff', value: 'task' }
  if (item.kind === 'upload') return { label: 'رفع ملف', Icon: Upload, color: '#00b894', value: 'upload' }
  if (item.kind === 'notification') return { label: 'إشعار', Icon: Bell, color: '#f0a800', value: 'notification' }
  return { label: '', Icon: MessageSquare, color: 'var(--text3)', value: '' }
}

const backBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const addBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--accent)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const saveBtnStyle: React.CSSProperties = { background: 'var(--accent)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const cancelBtnStyle: React.CSSProperties = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const miniBtnStyle: React.CSSProperties = { width: 22, height: 22, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }
