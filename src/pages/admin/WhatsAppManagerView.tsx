import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP } from './adminShared'
import { fmtRelative } from '../../lib/formatters'
import { toastOk, toastErr } from '../../components/Toast'
import { EmptyState, Pagination } from '../../components/UI'
import { MessageSquare, Send, Plus, Trash2, Edit, RefreshCw, Megaphone, FileText, History } from 'lucide-react'

type Tab = 'send' | 'templates' | 'conversations' | 'bulk' | 'history' | 'events'

const EVENT_LABELS: Record<string, string> = {
  sync_complete: 'اكتمال المزامنة',
  low_stock: 'تنبيه مخزون',
  new_order: 'طلب جديد',
  ai_ready: 'تحليل AI جاهز',
  daily_report: 'تقرير يومي',
  weekly_digest: 'ملخص أسبوعي',
  import_complete: 'اكتمال استيراد',
  restock_alert: 'إعادة توريد',
  high_returns: 'ارتفاع مرتجعات',
  low_roas: 'ROAS ضعيف',
  shipment_loss: 'فقد إرسالية',
  task_assigned: 'تذكرة جديدة',
  task_resolved: 'حل تذكرة',
  subscription_expiring: 'اقتراب انتهاء الاشتراك',
  custom: 'رسالة مخصّصة',
}

export default function WhatsAppManagerView({ merchants }: { merchants: any[] }) {
  const [tab, setTab] = useState<Tab>('send')
  const [conn, setConn] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadConn() }, [])
  async function loadConn() {
    setLoading(true)
    const { data } = await supabase.from('platform_connections').select('*').eq('platform', 'respondly').eq('is_active', true).maybeSingle()
    setConn(data)
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}>...</div>
  if (!conn) return (
    <EmptyState icon="📲" title="Respondly غير مربوط" description="اربط حساب Respondly من صفحة الاتصالات أولاً"
      action={<button onClick={() => { window.history.pushState(null, '', '/admin/connections'); window.dispatchEvent(new PopStateEvent('popstate')) }} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← الذهاب للاتصالات</button>}
    />
  )

  const tabs: { k: Tab; l: string; Icon: any }[] = [
    { k: 'send',          l: 'إرسال سريع',     Icon: Send         },
    { k: 'bulk',          l: 'إرسال جماعي',    Icon: Megaphone    },
    { k: 'templates',     l: 'القوالب',         Icon: FileText     },
    { k: 'conversations', l: 'المحادثات',      Icon: MessageSquare },
    { k: 'events',        l: 'الأحداث التلقائية', Icon: RefreshCw  },
    { k: 'history',       l: 'سجل الإرسال',     Icon: History      },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📲 إدارة الواتساب (Respondly)</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>مركز موحّد لكل عمليات الواتساب — قوالب، إرسال، محادثات، أحداث</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {tabs.map(t => {
          const Icon = t.Icon
          return (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: '10px 16px', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              background: tab === t.k ? 'var(--accent)' : 'var(--surface2)',
              color: tab === t.k ? '#fff' : 'var(--text2)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon size={14} /> {t.l}
            </button>
          )
        })}
      </div>

      {tab === 'send'          && <SendQuickTab connection={conn} merchants={merchants} />}
      {tab === 'bulk'          && <BulkSendTab connection={conn} merchants={merchants} />}
      {tab === 'templates'     && <TemplatesTab connection={conn} />}
      {tab === 'conversations' && <ConversationsTab connection={conn} />}
      {tab === 'events'        && <EventsTab connection={conn} onUpdate={loadConn} />}
      {tab === 'history'       && <HistoryTab />}
    </div>
  )
}

// ─── Quick Send ──────────────────────────────────────────────────────────────
function SendQuickTab({ connection, merchants }: { connection: any; merchants: any[] }) {
  const [merchantCode, setMerchantCode] = useState('')
  const [phone, setPhone] = useState('')
  const [event, setEvent] = useState('custom')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!message && event === 'custom') { toastErr('اكتب رسالة'); return }
    if (!merchantCode && !phone) { toastErr('اختر تاجر أو أدخل رقم'); return }
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-whatsapp`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_code: merchantCode || null,
          target_phone: phone || null,
          event,
          data: { message },
        }),
      })
      const data = await res.json()
      if (data.error) toastErr(data.error)
      else { toastOk('✓ تم الإرسال'); setMessage('') }
    } catch (e: any) { toastErr(e.message) }
    setSending(false)
  }

  return (
    <div style={{ ...S.formCard, padding: 22, maxWidth: 700 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>إرسال رسالة سريعة</div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label style={S.label}>التاجر</label>
          <select value={merchantCode} onChange={e => { setMerchantCode(e.target.value); setPhone('') }} style={{ ...S.input, fontSize: 13 }}>
            <option value="">— أو رقم مباشر —</option>
            {merchants.filter(m => m.role === 'merchant' && m.whatsapp_phone).map(m => (
              <option key={m.merchant_code} value={m.merchant_code}>{m.name} ({m.whatsapp_phone})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.label}>أو رقم واتساب مباشر</label>
          <input value={phone} onChange={e => { setPhone(e.target.value); setMerchantCode('') }} placeholder="+9665XXXXXXXX" style={{ ...S.input, fontSize: 13 }} />
        </div>
        <div>
          <label style={S.label}>نوع الحدث</label>
          <select value={event} onChange={e => setEvent(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
            {Object.entries(EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>الرسالة</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="اكتب رسالتك..." rows={5} style={{ ...S.input, fontSize: 13, minHeight: 100 }} />
        </div>
        <button onClick={send} disabled={sending} style={{ background: '#25D366', border: 'none', color: '#fff', padding: '11px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontFamily: 'inherit' }}>
          <Send size={14} /> {sending ? 'جاري الإرسال...' : 'إرسال عبر واتساب'}
        </button>
      </div>
    </div>
  )
}

// ─── Bulk Send ────────────────────────────────────────────────────────────────
function BulkSendTab({ connection, merchants }: { connection: any; merchants: any[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<any[]>([])

  const eligible = merchants.filter(m => m.role === 'merchant' && m.whatsapp_phone)

  async function bulkSend() {
    if (selected.size === 0) { toastErr('اختر تاجر واحد على الأقل'); return }
    if (!message && !templateName) { toastErr('اكتب رسالة أو اختر قالب'); return }
    setSending(true); setResults([])
    const recipients = eligible.filter(m => selected.has(m.merchant_code)).map(m => m.whatsapp_phone)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: connection.id,
          action: 'bulk_send',
          recipients,
          message: templateName ? null : message,
          template_name: templateName || null,
          template_language: 'ar',
          channel_id: connection.extra?.channel_id,
        }),
      })
      const data = await res.json()
      if (data.error) toastErr(data.error)
      else {
        setResults(data.results || [])
        toastOk(`تم إرسال ${data.sent} من ${recipients.length}`)
      }
    } catch (e: any) { toastErr(e.message) }
    setSending(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...S.formCard, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>اختر التجار ({selected.size}/{eligible.length})</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={() => setSelected(new Set(eligible.map(m => m.merchant_code)))} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>تحديد الكل</button>
          <button onClick={() => setSelected(new Set())} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>إلغاء التحديد</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, maxHeight: 280, overflowY: 'auto', padding: 4 }}>
          {eligible.map(m => (
            <label key={m.merchant_code} style={{ display: 'flex', gap: 6, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: selected.has(m.merchant_code) ? 'rgba(124,107,255,0.1)' : 'var(--surface2)', fontSize: 12, alignItems: 'center' }}>
              <input type="checkbox" checked={selected.has(m.merchant_code)} onChange={e => {
                const s = new Set(selected)
                if (e.target.checked) s.add(m.merchant_code); else s.delete(m.merchant_code)
                setSelected(s)
              }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>{m.whatsapp_phone}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ ...S.formCard, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>الرسالة</div>
        <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="اسم قالب (اختياري) — يطغى على النص" style={{ ...S.input, fontSize: 13, marginBottom: 8 }} />
        <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="اكتب نص الرسالة..." rows={5} style={{ ...S.input, fontSize: 13, minHeight: 110 }} disabled={!!templateName} />
        <button onClick={bulkSend} disabled={sending || selected.size === 0} style={{ marginTop: 12, background: '#25D366', border: 'none', color: '#fff', padding: '11px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit', opacity: sending || selected.size === 0 ? 0.5 : 1 }}>
          <Megaphone size={14} /> {sending ? 'جاري الإرسال...' : `إرسال لـ ${selected.size} تاجر`}
        </button>
      </div>

      {results.length > 0 && (
        <div style={{ ...S.formCard, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>نتائج الإرسال</div>
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ fontFamily: 'monospace' }}>{r.to}</span>
              <span style={{ color: r.ok ? '#00b894' : '#e84040', fontWeight: 700 }}>{r.ok ? '✓' : '✗ ' + (r.error || 'فشل')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Templates ────────────────────────────────────────────────────────────────
function TemplatesTab({ connection }: { connection: any }) {
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', body: '', language: 'ar', category: 'utility' })

  async function load() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connection.id, action: 'list_templates' }),
    })
    const data = await res.json()
    setTemplates(data.templates || [])
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function create() {
    if (!form.name || !form.body) { toastErr('الاسم والمحتوى مطلوبان'); return }
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connection.id, action: 'create_template', template: form }),
    })
    const data = await res.json()
    if (data.error) toastErr(data.error)
    else { toastOk('✓ أُنشئ القالب'); setCreating(false); setForm({ name: '', body: '', language: 'ar', category: 'utility' }); load() }
  }

  async function del(id: string) {
    if (!confirm('حذف هذا القالب؟')) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connection.id, action: 'delete_template', template_id: id }),
    })
    const data = await res.json()
    if (data.error) toastErr(data.error); else { toastOk('✓ حُذف'); load() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>القوالب ({templates.length})</div>
        <button onClick={() => setCreating(!creating)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          <Plus size={14} /> {creating ? 'إلغاء' : 'قالب جديد'}
        </button>
      </div>

      {creating && (
        <div style={{ ...S.formCard, padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={S.label}>الاسم *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ ...S.input, fontSize: 12 }} />
            </div>
            <div>
              <label style={S.label}>اللغة</label>
              <select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} style={{ ...S.input, fontSize: 12 }}>
                <option value="ar">عربي</option>
                <option value="en">إنجليزي</option>
              </select>
            </div>
            <div>
              <label style={S.label}>الفئة</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={{ ...S.input, fontSize: 12 }}>
                <option value="utility">خدمي</option>
                <option value="marketing">تسويقي</option>
                <option value="auth">تحقّق</option>
              </select>
            </div>
          </div>
          <div>
            <label style={S.label}>المحتوى * (يدعم {`{{1}}`} {`{{2}}`}...)</label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={5} style={{ ...S.input, fontSize: 12, minHeight: 120 }} />
          </div>
          <button onClick={create} style={{ marginTop: 10, background: 'var(--accent)', border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>إنشاء القالب</button>
        </div>
      )}

      {loading ? null : templates.length === 0 ? (
        <EmptyState icon="📄" title="لا توجد قوالب" description="أنشئ قالباً جديداً لإرسال رسائل سريعة وموحّدة" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map((t, i) => (
            <div key={i} style={{ ...S.formCard, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{t.language || 'ar'} · {t.category || 'utility'} · {t.status || 'active'}</div>
                </div>
                {t.id && <button onClick={() => del(t.id)} style={{ background: 'transparent', border: '1px solid #e84040', color: '#e84040', padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><Trash2 size={11} /> حذف</button>}
              </div>
              {t.body && <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{t.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Conversations ────────────────────────────────────────────────────────────
function ConversationsTab({ connection }: { connection: any }) {
  const [convs, setConvs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connection.id, action: 'list_conversations' }),
    })
    const data = await res.json()
    setConvs(data.conversations || [])
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function openConv(c: any) {
    setSelected(c)
    setMessages([])
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connection.id, action: 'list_messages', conversation_id: c.id }),
    })
    const data = await res.json()
    setMessages(data.messages || [])
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return
    setSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: connection.id, action: 'reply',
        to: selected.contact?.phone || selected.phone,
        channel_id: selected.channel_id,
        message: reply,
      }),
    })
    const data = await res.json()
    if (data.error) toastErr(data.error)
    else { toastOk('تم الإرسال'); setReply(''); openConv(selected) }
    setSending(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, height: 600 }}>
      {/* List */}
      <div style={{ ...S.formCard, padding: 0, overflowY: 'auto' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>المحادثات ({convs.length})</span>
          <button onClick={load} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer' }}><RefreshCw size={14} /></button>
        </div>
        {loading ? <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>...</div>
         : convs.length === 0 ? <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>لا توجد محادثات</div>
         : convs.map((c, i) => (
           <div key={c.id || i} onClick={() => openConv(c)} style={{
             padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
             background: selected?.id === c.id ? 'rgba(124,107,255,0.08)' : 'transparent',
           }}>
             <div style={{ fontSize: 13, fontWeight: 700 }}>{c.contact?.name || c.contact?.phone || c.phone || 'محادثة'}</div>
             <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message?.text || c.last_message_text || '—'}</div>
             {c.unread_count > 0 && <span style={{ fontSize: 10, color: '#fff', background: '#25D366', padding: '2px 7px', borderRadius: 10, marginTop: 4, display: 'inline-block' }}>{c.unread_count}</span>}
           </div>
         ))
        }
      </div>

      {/* Detail */}
      {selected ? (
        <div style={{ ...S.formCard, padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
            {selected.contact?.name || selected.phone}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messages.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text3)', fontSize: 12 }}>لا رسائل</div>
             : messages.map((m, i) => (
               <div key={m.id || i} style={{
                 alignSelf: m.from_me || m.direction === 'out' ? 'flex-end' : 'flex-start',
                 maxWidth: '75%',
                 background: m.from_me || m.direction === 'out' ? 'var(--accent)' : 'var(--surface2)',
                 color: m.from_me || m.direction === 'out' ? '#fff' : 'var(--text)',
                 padding: '8px 12px', borderRadius: 12, fontSize: 13,
               }}>
                 <div>{m.text || m.body || '—'}</div>
                 <div style={{ fontSize: 9, opacity: 0.7, marginTop: 4 }}>{fmtRelative(m.created_at || m.timestamp)}</div>
               </div>
             ))
            }
          </div>
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()} placeholder="رد..." style={{ ...S.input, fontSize: 13, flex: 1 }} />
            <button onClick={sendReply} disabled={sending || !reply.trim()} style={{ background: '#25D366', border: 'none', color: '#fff', padding: '0 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Send size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...S.formCard, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>اختر محادثة من القائمة</div>
      )}
    </div>
  )
}

// ─── Events Config ────────────────────────────────────────────────────────────
function EventsTab({ connection, onUpdate }: { connection: any; onUpdate: () => void }) {
  const [events, setEvents] = useState(connection.extra?.events || {})
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('platform_connections').update({
      extra: { ...connection.extra, events },
    }).eq('id', connection.id)
    setSaving(false)
    if (error) toastErr(error.message)
    else { toastOk('✓ حُفظت الإعدادات'); onUpdate() }
  }

  function toggle(eventKey: string) {
    setEvents((e: any) => ({ ...e, [eventKey]: { ...e[eventKey], enabled: !(e[eventKey]?.enabled !== false) } }))
  }

  function setTemplate(eventKey: string, tpl: string) {
    setEvents((e: any) => ({ ...e, [eventKey]: { ...e[eventKey], template: tpl || null } }))
  }

  return (
    <div style={{ ...S.formCard, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>الأحداث التلقائية</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>تحكّم في أي الأحداث ترسل رسالة واتساب تلقائياً</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(EVENT_LABELS).map(([k, l]) => {
          const cfg = events[k] || {}
          const enabled = cfg.enabled !== false
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 9, background: 'var(--surface2)' }}>
              <input type="checkbox" checked={enabled} onChange={() => toggle(k)} style={{ width: 18, height: 18 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>{k}</div>
              </div>
              <input value={cfg.template || ''} onChange={e => setTemplate(k, e.target.value)} placeholder="اسم قالب (اختياري)" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 7, fontSize: 11, color: 'var(--text)', width: 200 }} />
            </div>
          )
        })}
      </div>
      <button onClick={save} disabled={saving} style={{ marginTop: 14, background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {saving ? '...' : '💾 حفظ الإعدادات'}
      </button>
    </div>
  )
}

// ─── History ──────────────────────────────────────────────────────────────────
function HistoryTab() {
  const [logs, setLogs] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const PAGE = 25

  async function load() {
    const { data, count } = await supabase.from('webhook_events').select('*', { count: 'exact' })
      .eq('source', 'respondly')
      .order('received_at', { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1)
    setLogs(data || [])
    setTotal(count || 0)
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [page])

  return (
    <div style={{ ...S.tableCard }}>
      <div style={S.tableHeader}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>سجل الإرسال والاستقبال</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>{['الوقت', 'النوع', 'التاجر', 'الحالة', 'البيانات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} style={S.tr}>
                <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }}>{fmtRelative(l.received_at)}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)' }}>{l.event_type}</td>
                <td style={{ ...S.td, fontSize: 11 }}>{l.merchant_code || '—'}</td>
                <td style={S.td}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                    background: l.status === 'sent' ? 'rgba(0,184,148,0.1)' : l.status === 'failed' ? 'rgba(232,64,64,0.1)' : 'rgba(124,107,255,0.1)',
                    color: l.status === 'sent' ? '#00b894' : l.status === 'failed' ? '#e84040' : '#7c6bff',
                  }}>{l.status}</span>
                </td>
                <td style={{ ...S.td, fontSize: 10, color: 'var(--text3)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(l.payload)}>
                  {l.error || JSON.stringify(l.payload).slice(0, 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE} total={total} onPage={setPage} />
    </div>
  )
}
