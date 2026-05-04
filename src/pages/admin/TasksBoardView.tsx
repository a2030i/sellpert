import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { fmtRelative, fmtDate } from '../../lib/formatters'
import { Pagination, EmptyState } from '../../components/UI'
import { toastOk, toastErr } from '../../components/Toast'
import { Inbox, AlertTriangle, Clock, CheckCircle2, X, Send, User, Filter } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string; email: string }

const STATUSES = [
  { key: 'pending',     label: 'قيد المراجعة', color: '#ffd166', icon: Clock },
  { key: 'in_progress', label: 'قيد التنفيذ',  color: '#7c6bff', icon: Clock },
  { key: 'review',      label: 'بانتظار التأكيد', color: '#4cc9f0', icon: AlertTriangle },
  { key: 'blocked',     label: 'متوقّف',       color: '#e84040', icon: X },
  { key: 'done',        label: 'مكتمل',        color: '#00b894', icon: CheckCircle2 },
  { key: 'rejected',    label: 'مرفوض',         color: '#888', icon: X },
] as const

const PRIORITIES: any = {
  urgent: { label: 'عاجل',    color: '#e84040' },
  high:   { label: 'مرتفع',   color: '#ff9900' },
  medium: { label: 'متوسط',   color: '#7c6bff' },
  low:    { label: 'منخفض',   color: '#888' },
}

const CATEGORIES: any = {
  ad_budget_increase: '⬆️ رفع ميزانية إعلانات',
  ad_budget_decrease: '⬇️ خفض ميزانية إعلانات',
  price_change:       '💲 تغيير سعر منتج',
  shipping_change:    '🚚 تغيير شركة شحن',
  inventory_update:   '📦 تحديث مخزون',
  add_product:        '➕ إضافة منتج',
  remove_product:     '🗑 حذف منتج',
  update_info:        '✏️ تعديل بيانات',
  inquiry:            '💬 استفسار',
  complaint:          '⚠️ شكوى',
  task:               '📋 مهمة عامة',
  other:              '🔹 أخرى',
}

interface Task {
  id: string
  title: string | null
  type: string
  category: string | null
  platform: string | null
  status: string
  priority: string
  merchant_code: string
  assigned_to: string | null
  created_by: string | null
  created_by_role: string | null
  note: string | null
  admin_note: string | null
  due_date: string | null
  details: any
  created_at: string
  updated_at: string | null
  resolved_at: string | null
}

export default function TasksBoardView({ merchants, currentUserCode, currentUserRole }: { merchants: Merchant[]; currentUserCode?: string; currentUserRole?: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [staff, setStaff] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus]       = useState<string>('all')
  const [filterPriority, setFilterPriority]   = useState<string>('all')
  const [filterAssigned, setFilterAssigned]   = useState<string>(currentUserRole === 'employee' ? (currentUserCode || '') : 'all')
  const [filterMerchant, setFilterMerchant]   = useState<string>('all')
  const [filterPlatform, setFilterPlatform]   = useState<string>('all')
  const [view, setView]                       = useState<'kanban' | 'list'>('kanban')
  const [page, setPage]                       = useState(1)
  const [showCreate, setShowCreate]           = useState(false)
  const [editing, setEditing]                 = useState<Task | null>(null)
  const PAGE_SIZE = 20

  const isEmployee = currentUserRole === 'employee'
  const merchantOnly = merchants.filter(m => m.role === 'merchant')

  useEffect(() => { load() /* eslint-disable-line */ }, [filterStatus, filterPriority, filterAssigned, filterMerchant, filterPlatform])

  async function load() {
    setLoading(true)
    let query = supabase.from('merchant_requests').select('*').order('created_at', { ascending: false })
    if (filterStatus !== 'all')   query = query.eq('status', filterStatus)
    if (filterPriority !== 'all') query = query.eq('priority', filterPriority)
    if (filterAssigned !== 'all') query = query.eq('assigned_to', filterAssigned)
    if (filterMerchant !== 'all') query = query.eq('merchant_code', filterMerchant)
    if (filterPlatform !== 'all') query = query.eq('platform', filterPlatform)
    const [{ data }, staffRes] = await Promise.all([
      query,
      supabase.from('merchants').select('merchant_code, name, role, email').in('role', ['admin', 'super_admin', 'employee']),
    ])
    setTasks((data as Task[]) || [])
    setStaff((staffRes.data as Merchant[]) || [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    const upd: any = { status, updated_at: new Date().toISOString() }
    if (status === 'done' || status === 'rejected') upd.resolved_at = new Date().toISOString()
    const { error } = await supabase.from('merchant_requests').update(upd).eq('id', id)
    if (error) toastErr(error.message)
    else { toastOk('تم تحديث الحالة'); load() }
  }

  async function assignTo(id: string, code: string | null) {
    const { error } = await supabase.from('merchant_requests').update({ assigned_to: code, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toastErr(error.message)
    else { toastOk(code ? 'تم التعيين' : 'تم إلغاء التعيين'); load() }
  }

  const summary = useMemo(() => {
    const counts: any = {}
    for (const s of STATUSES) counts[s.key] = tasks.filter(t => t.status === s.key).length
    const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && !['done','rejected'].includes(t.status)).length
    const urgent  = tasks.filter(t => t.priority === 'urgent' && !['done','rejected'].includes(t.status)).length
    return { ...counts, total: tasks.length, overdue, urgent }
  }, [tasks])

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { pending: [], in_progress: [], review: [], blocked: [], done: [], rejected: [] }
    for (const t of tasks) {
      if (g[t.status]) g[t.status].push(t)
    }
    return g
  }, [tasks])

  const pagedList = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📋 إدارة المهام والتذاكر</h3>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>{isEmployee ? 'مهامك المسندة' : 'كل مهام النظام — من التجار والإدارة'}</p>
        </div>
        {!isEmployee && (
          <button onClick={() => setShowCreate(true)} style={{ ...S.addBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> إنشاء مهمة جديدة
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <KpiBox label="الإجمالي" value={summary.total} color="#7c6bff" />
        <KpiBox label="عاجلة" value={summary.urgent} color="#e84040" highlight={summary.urgent > 0} />
        <KpiBox label="متأخّرة" value={summary.overdue} color="#ff9900" highlight={summary.overdue > 0} />
        <KpiBox label="قيد التنفيذ" value={summary.in_progress} color="#7c6bff" />
        <KpiBox label="مكتملة" value={summary.done} color="#00b894" />
      </div>

      {/* Filters */}
      <div style={{ ...S.formCard, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={14} style={{ color: 'var(--text3)' }} />
        <Select label="الحالة" value={filterStatus} onChange={setFilterStatus} options={[{ v: 'all', l: 'كل الحالات' }, ...STATUSES.map(s => ({ v: s.key, l: s.label }))]} />
        <Select label="الأولوية" value={filterPriority} onChange={setFilterPriority} options={[{ v: 'all', l: 'كل الأولويات' }, ...Object.keys(PRIORITIES).map(k => ({ v: k, l: PRIORITIES[k].label }))]} />
        {!isEmployee && (
          <Select label="المُسنَدة لـ" value={filterAssigned} onChange={setFilterAssigned} options={[
            { v: 'all', l: 'الكل' },
            { v: '__unassigned__', l: 'بدون تعيين' },
            ...staff.map(s => ({ v: s.merchant_code, l: s.name }))
          ]} />
        )}
        {!isEmployee && (
          <Select label="التاجر" value={filterMerchant} onChange={setFilterMerchant} options={[{ v: 'all', l: 'كل التجار' }, ...merchantOnly.map(m => ({ v: m.merchant_code, l: m.name }))]} />
        )}
        <Select label="المنصة" value={filterPlatform} onChange={setFilterPlatform} options={[{ v: 'all', l: 'كل المنصات' }, { v: 'noon', l: 'نون' }, { v: 'trendyol', l: 'تراندايول' }, { v: 'amazon', l: 'أمازون' }, { v: 'salla', l: 'سلة' }]} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setView('kanban')} style={tabBtn(view === 'kanban')}>كانبان</button>
          <button onClick={() => setView('list')}   style={tabBtn(view === 'list')}>قائمة</button>
        </div>
      </div>

      {/* Body */}
      {loading ? null : tasks.length === 0 ? (
        <EmptyState icon="📭" title="لا توجد مهام" description={isEmployee ? 'لا توجد مهام مُسنَدة لك حالياً' : 'لم تُنشأ مهام أو تذاكر بعد'} />
      ) : view === 'kanban' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          {STATUSES.filter(s => !['rejected'].includes(s.key) || grouped[s.key].length > 0).map(s => (
            <KanbanColumn key={s.key} status={s} tasks={grouped[s.key] || []} merchants={merchantOnly} staff={staff}
              onUpdateStatus={updateStatus} onAssign={assignTo} onEdit={t => setEditing(t)} canEdit={!isEmployee} />
          ))}
        </div>
      ) : (
        <div style={{ ...S.tableCard }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>{['الأولوية', 'العنوان', 'النوع', 'التاجر', 'المنصة', 'المُسنَدة لـ', 'الحالة', 'تاريخ الإنشاء', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {pagedList.map(t => {
                  const merchantName = merchantOnly.find(m => m.merchant_code === t.merchant_code)?.name || t.merchant_code
                  const assigneeName = staff.find(s => s.merchant_code === t.assigned_to)?.name || (t.assigned_to ? t.assigned_to : '—')
                  const statusMeta = STATUSES.find(s => s.key === t.status)
                  return (
                    <tr key={t.id} style={{ ...S.tr, cursor: 'pointer' }} onClick={() => setEditing(t)}>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: PRIORITIES[t.priority]?.color + '20', color: PRIORITIES[t.priority]?.color }}>
                          {PRIORITIES[t.priority]?.label}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontWeight: 700 }}>{t.title || t.note?.slice(0, 50) || '—'}</td>
                      <td style={{ ...S.td, fontSize: 11 }}>{CATEGORIES[t.category || t.type] || t.type}</td>
                      <td style={{ ...S.td, fontSize: 11 }}>{merchantName}</td>
                      <td style={{ ...S.td, fontSize: 11, color: PLATFORM_COLORS[t.platform || ''] || 'var(--text3)' }}>{t.platform ? PLATFORM_MAP[t.platform] : '—'}</td>
                      <td style={{ ...S.td, fontSize: 11 }}>{assigneeName}</td>
                      <td style={{ ...S.td }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: statusMeta?.color + '20', color: statusMeta?.color }}>
                          {statusMeta?.label}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }} title={fmtDate(t.created_at)}>{fmtRelative(t.created_at)}</td>
                      <td style={S.td}>›</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={tasks.length} onPage={setPage} />
        </div>
      )}

      {showCreate && (
        <CreateTaskModal merchants={merchantOnly} staff={staff} currentUserCode={currentUserCode} currentUserRole={currentUserRole}
          onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load() }} />
      )}
      {editing && (
        <EditTaskModal task={editing} staff={staff} canEdit={!isEmployee}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onDelete={async () => {
            if (!confirm('حذف نهائي؟')) return
            await supabase.from('merchant_requests').delete().eq('id', editing.id)
            setEditing(null); load()
          }}
        />
      )}
    </div>
  )
}

function KpiBox({ label, value, color, highlight }: { label: string; value: number; color: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? color + '15' : 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function tabBtn(active: boolean): React.CSSProperties {
  return { padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: active ? 'var(--accent)' : 'var(--surface2)', color: active ? '#fff' : 'var(--text2)' }
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      title={label}>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

function KanbanColumn({ status, tasks, merchants, staff, onUpdateStatus, onAssign, onEdit, canEdit }: {
  status: typeof STATUSES[number]; tasks: Task[]; merchants: Merchant[]; staff: Merchant[];
  onUpdateStatus: (id: string, s: string) => void; onAssign: (id: string, code: string | null) => void;
  onEdit: (t: Task) => void; canEdit: boolean
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${status.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <status.icon size={14} color={status.color} />
          <span style={{ fontSize: 12, fontWeight: 800, color: status.color }}>{status.label}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>{tasks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 600, overflowY: 'auto' }}>
        {tasks.map(t => {
          const merchantName = merchants.find(m => m.merchant_code === t.merchant_code)?.name
          const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !['done','rejected'].includes(t.status)
          return (
            <div key={t.id} onClick={() => onEdit(t)} style={{
              background: 'var(--surface2)', borderRadius: 8, padding: 10, cursor: 'pointer',
              borderRight: `3px solid ${PRIORITIES[t.priority]?.color}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: PRIORITIES[t.priority]?.color }}>{PRIORITIES[t.priority]?.label}</span>
                {isOverdue && <span style={{ fontSize: 9, color: '#e84040', fontWeight: 700 }}>⚠ متأخرة</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{t.title || t.note?.slice(0, 60) || '—'}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{CATEGORIES[t.category || t.type] || t.type}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10 }}>
                <span style={{ color: 'var(--text2)' }}>{merchantName || t.merchant_code}</span>
                {t.platform && <span style={{ color: PLATFORM_COLORS[t.platform], fontWeight: 700 }}>{PLATFORM_MAP[t.platform]}</span>}
              </div>
              {canEdit && (
                <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                  <select value={t.assigned_to || ''} onChange={e => onAssign(t.id, e.target.value || null)} style={{ flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'inherit' }}>
                    <option value="">— تعيين —</option>
                    {staff.map(s => <option key={s.merchant_code} value={s.merchant_code}>{s.name}</option>)}
                  </select>
                  <select value={t.status} onChange={e => onUpdateStatus(t.id, e.target.value)} style={{ fontSize: 10, padding: '3px 6px', borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'inherit' }}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
        {tasks.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 11, padding: 20 }}>لا شيء</div>}
      </div>
    </div>
  )
}

function CreateTaskModal({ merchants, staff, currentUserCode, currentUserRole, onClose, onSaved }: any) {
  const [form, setForm] = useState({
    merchant_code: '', title: '', category: 'task', platform: '', priority: 'medium' as const,
    assigned_to: '', note: '', due_date: '',
  })
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!form.merchant_code || !form.title) { toastErr('التاجر والعنوان مطلوبان'); return }
    setSaving(true)
    const payload = {
      merchant_code: form.merchant_code,
      type: form.category as any,
      category: form.category,
      title: form.title,
      platform: form.platform || null,
      priority: form.priority,
      assigned_to: form.assigned_to || null,
      note: form.note || null,
      due_date: form.due_date || null,
      created_by: currentUserCode,
      created_by_role: currentUserRole,
      details: {},
      status: 'pending',
    }
    const { error } = await supabase.from('merchant_requests').insert(payload)
    setSaving(false)
    if (error) toastErr(error.message)
    else { toastOk('✓ أُنشئت المهمة'); onSaved() }
  }
  return (
    <Modal title="إنشاء مهمة جديدة" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="التاجر *">
          <select value={form.merchant_code} onChange={e => setForm({ ...form, merchant_code: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {merchants.map((m: any) => <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="الفئة">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
          </select>
        </Field>
      </div>
      <Field label="العنوان *">
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inputStyle} placeholder="مثال: رفع ميزانية إعلانات نون لـ 500 ر.س" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label="المنصة">
          <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} style={inputStyle}>
            <option value="">— لا يهم —</option>
            <option value="noon">نون</option>
            <option value="trendyol">تراندايول</option>
            <option value="amazon">أمازون</option>
            <option value="salla">سلة</option>
          </select>
        </Field>
        <Field label="الأولوية">
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as any })} style={inputStyle}>
            {Object.entries(PRIORITIES).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="موعد التنفيذ">
          <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
        </Field>
      </div>
      <Field label="إسناد لموظف">
        <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} style={inputStyle}>
          <option value="">— بدون تعيين —</option>
          {staff.map((s: any) => <option key={s.merchant_code} value={s.merchant_code}>{s.name} ({s.role})</option>)}
        </select>
      </Field>
      <Field label="التفاصيل">
        <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={{ ...inputStyle, minHeight: 80 }} placeholder="اكتب تفاصيل المهمة..." />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} style={{ ...S.miniBtn, padding: '8px 16px' }}>إلغاء</button>
        <button onClick={save} disabled={saving} style={{ ...S.addBtn }}>{saving ? '...' : '✓ إنشاء'}</button>
      </div>
    </Modal>
  )
}

function EditTaskModal({ task, staff, canEdit, onClose, onSaved, onDelete }: any) {
  const [data, setData] = useState(task)
  const [comment, setComment] = useState('')
  const [comments, setComments] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('task_comments').select('*').eq('task_id', task.id).order('created_at').then(({ data }) => setComments(data || []))
  }, [task.id])

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('merchant_requests').update({
      title: data.title, category: data.category, platform: data.platform,
      priority: data.priority, assigned_to: data.assigned_to, status: data.status,
      due_date: data.due_date, note: data.note, admin_note: data.admin_note,
      updated_at: new Date().toISOString(),
      ...(data.status === 'done' || data.status === 'rejected' ? { resolved_at: new Date().toISOString() } : {})
    }).eq('id', task.id)
    setSaving(false)
    if (error) toastErr(error.message)
    else { toastOk('تم الحفظ'); onSaved() }
  }
  async function addComment() {
    if (!comment.trim()) return
    const { data: user } = await supabase.auth.getUser()
    const { data: m } = await supabase.from('merchants').select('merchant_code, role').eq('email', user.user?.email!).maybeSingle()
    await supabase.from('task_comments').insert({
      task_id: task.id, body: comment, author_code: m?.merchant_code || 'unknown', author_role: m?.role
    })
    setComment('')
    supabase.from('task_comments').select('*').eq('task_id', task.id).order('created_at').then(({ data }) => setComments(data || []))
  }

  return (
    <Modal title={data.title || 'مهمة'} onClose={onClose} size="large">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Field label="العنوان">
          <input value={data.title || ''} onChange={e => setData({ ...data, title: e.target.value })} style={inputStyle} disabled={!canEdit} />
        </Field>
        <Field label="الفئة">
          <select value={data.category || data.type} onChange={e => setData({ ...data, category: e.target.value })} style={inputStyle} disabled={!canEdit}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <Field label="الحالة">
          <select value={data.status} onChange={e => setData({ ...data, status: e.target.value })} style={inputStyle}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="الأولوية">
          <select value={data.priority} onChange={e => setData({ ...data, priority: e.target.value })} style={inputStyle} disabled={!canEdit}>
            {Object.entries(PRIORITIES).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="المنصة">
          <select value={data.platform || ''} onChange={e => setData({ ...data, platform: e.target.value || null })} style={inputStyle} disabled={!canEdit}>
            <option value="">—</option>
            <option value="noon">نون</option>
            <option value="trendyol">تراندايول</option>
            <option value="amazon">أمازون</option>
            <option value="salla">سلة</option>
          </select>
        </Field>
        <Field label="الموعد">
          <input type="date" value={data.due_date || ''} onChange={e => setData({ ...data, due_date: e.target.value || null })} style={inputStyle} disabled={!canEdit} />
        </Field>
      </div>
      <Field label="مُسنَدة لـ">
        <select value={data.assigned_to || ''} onChange={e => setData({ ...data, assigned_to: e.target.value || null })} style={inputStyle} disabled={!canEdit}>
          <option value="">— بدون تعيين —</option>
          {staff.map((s: any) => <option key={s.merchant_code} value={s.merchant_code}>{s.name} ({s.role})</option>)}
        </select>
      </Field>
      <Field label="التفاصيل (يراها التاجر)">
        <textarea value={data.note || ''} onChange={e => setData({ ...data, note: e.target.value })} style={{ ...inputStyle, minHeight: 70 }} disabled={!canEdit} />
      </Field>
      <Field label="ملاحظات داخلية (الإدارة فقط)">
        <textarea value={data.admin_note || ''} onChange={e => setData({ ...data, admin_note: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} disabled={!canEdit} />
      </Field>

      {/* Comments */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>💬 التعليقات ({comments.length})</div>
        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {comments.map(c => (
            <div key={c.id} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: 'var(--text2)' }}>{c.author_code}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtRelative(c.created_at)}</span>
              </div>
              <div style={{ color: 'var(--text)' }}>{c.body}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="أضف تعليق…" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addComment} style={{ ...S.addBtn, padding: '8px 14px' }}>إرسال</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
        {canEdit ? (
          <button onClick={onDelete} style={{ ...S.miniBtn, padding: '8px 16px', color: '#e84040', borderColor: '#e8404040' }}>🗑 حذف</button>
        ) : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...S.miniBtn, padding: '8px 16px' }}>إغلاق</button>
          <button onClick={save} disabled={saving} style={{ ...S.addBtn }}>{saving ? '...' : '💾 حفظ'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, size = 'normal', children }: { title: string; onClose: () => void; size?: 'normal' | 'large'; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: '100%', maxWidth: size === 'large' ? 720 : 540, marginTop: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)' }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
  padding: '8px 10px', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
