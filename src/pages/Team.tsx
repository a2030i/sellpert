import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import {
  Users, UserPlus, Trash2, Key, Save, X, Mail, Briefcase, Phone,
  Check, Power, Shield,
} from 'lucide-react'
import { toastOk, toastErr } from '../components/Toast'
import { fmtRelative } from '../lib/formatters'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string

const PERMISSION_ITEMS: { key: string; label: string; group: string }[] = [
  { key: 'dashboard',    label: 'لوحة التحكم',  group: 'view' },
  { key: 'orders',       label: 'الطلبات',       group: 'view' },
  { key: 'products',     label: 'المنتجات',      group: 'view' },
  { key: 'inventory',    label: 'المخزون',       group: 'manage' },
  { key: 'marketing',    label: 'التسويق',       group: 'view' },
  { key: 'statement',    label: 'كشف الحساب',    group: 'finance' },
  { key: 'billing',      label: 'الاشتراك',      group: 'finance' },
  { key: 'integrations', label: 'المنصات',       group: 'admin' },
  { key: 'settings',     label: 'الإعدادات',     group: 'admin' },
]

const DEFAULT_PERMISSIONS = Object.fromEntries(
  PERMISSION_ITEMS.map(p => [p.key, p.group === 'view' || p.key === 'inventory'])
)

interface Employee {
  id: string
  merchant_code: string
  name: string
  email: string
  whatsapp_phone: string | null
  job_title: string | null
  permissions: Record<string, boolean>
  is_active: boolean
  created_at: string
}

export default function Team({ merchant }: { merchant: Merchant | null }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({})
  const [editJobTitle, setEditJobTitle] = useState('')
  const [resetPwdFor, setResetPwdFor] = useState<string | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    name: '', email: '', password: '', whatsapp_phone: '', job_title: '',
    permissions: { ...DEFAULT_PERMISSIONS } as Record<string, boolean>,
  })

  useEffect(() => { if (merchant) load() }, [merchant?.merchant_code])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.rpc('my_employees')
    if (error) toastErr(error.message)
    setEmployees((data as Employee[]) || [])
    setLoading(false)
  }

  async function callFn(body: any) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-employee`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return await res.json()
  }

  async function addEmployee() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toastErr('الاسم والبريد وكلمة المرور مطلوبة'); return
    }
    if (form.password.length < 8) { toastErr('كلمة المرور يجب 8 أحرف على الأقل'); return }
    setBusy(true)
    const data = await callFn({
      name: form.name, email: form.email, password: form.password,
      whatsapp_phone: form.whatsapp_phone || undefined,
      job_title: form.job_title || undefined,
      permissions: form.permissions,
    })
    setBusy(false)
    if (data.error) { toastErr(data.error); return }
    toastOk(`تم إضافة ${form.name} — الكود: ${data.merchant_code}`)
    setForm({ name: '', email: '', password: '', whatsapp_phone: '', job_title: '', permissions: { ...DEFAULT_PERMISSIONS } })
    setShowAdd(false)
    load()
  }

  function startEdit(e: Employee) {
    setEditId(e.merchant_code)
    setEditPermissions({ ...DEFAULT_PERMISSIONS, ...(e.permissions || {}) })
    setEditJobTitle(e.job_title || '')
  }

  async function saveEdit() {
    if (!editId) return
    setBusy(true)
    const { error } = await supabase.rpc('update_employee', {
      p_employee_code: editId,
      p_permissions: editPermissions,
      p_job_title: editJobTitle || null,
    })
    setBusy(false)
    if (error) { toastErr(error.message); return }
    toastOk('تم حفظ الصلاحيات')
    setEditId(null)
    load()
  }

  async function toggleActive(e: Employee) {
    setBusy(true)
    const { error } = await supabase.rpc('update_employee', {
      p_employee_code: e.merchant_code,
      p_is_active: !e.is_active,
    })
    setBusy(false)
    if (error) toastErr(error.message)
    else { toastOk(e.is_active ? 'تم إيقاف الموظف' : 'تم تفعيل الموظف'); load() }
  }

  async function removeEmployee(e: Employee) {
    if (!confirm(`حذف الموظف ${e.name}؟ سيفقد الوصول فوراً.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_employee', { p_employee_code: e.merchant_code })
    if (error) { toastErr(error.message); setBusy(false); return }
    // Then delete auth user via Edge Function (needs service role)
    await callFn({ action: 'delete_auth', auth_id: e.id })
    setBusy(false)
    toastOk('تم حذف الموظف')
    load()
  }

  async function resetPassword() {
    if (!resetPwdFor || newPwd.length < 8) { toastErr('كلمة المرور يجب 8 أحرف'); return }
    setBusy(true)
    const data = await callFn({ action: 'reset_password', employee_code: resetPwdFor, new_password: newPwd })
    setBusy(false)
    if (data.error) toastErr(data.error)
    else {
      toastOk('تم تغيير كلمة المرور')
      setResetPwdFor(null); setNewPwd('')
    }
  }

  if (!merchant) return null

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#6c5ce7,#00b894)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>الفريق</h1>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              أضف موظفين بصلاحيات مخصصة لإدارة متجرك
            </div>
          </div>
        </div>
        <button onClick={() => setShowAdd(s => !s)} style={primaryBtn}>
          <UserPlus size={14} /> {showAdd ? 'إلغاء' : 'إضافة موظف'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>موظف جديد</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Field label="الاسم الكامل" Icon={Users}>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="أحمد العلي" />
            </Field>
            <Field label="البريد الإلكتروني" Icon={Mail}>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} placeholder="employee@example.com" />
            </Field>
            <Field label="كلمة المرور (8+)" Icon={Key}>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle} placeholder="********" />
            </Field>
            <Field label="المسمى الوظيفي" Icon={Briefcase}>
              <input value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} style={inputStyle} placeholder="مدير عمليات" />
            </Field>
            <Field label="رقم الواتساب" Icon={Phone}>
              <input value={form.whatsapp_phone} onChange={e => setForm({ ...form, whatsapp_phone: e.target.value })} style={inputStyle} placeholder="+966500000000" />
            </Field>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={13} color="var(--accent)" /> الصلاحيات
            </div>
            <PermissionGrid value={form.permissions} onChange={(v) => setForm({ ...form, permissions: v })} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={secondaryBtn}>إلغاء</button>
            <button onClick={addEmployee} disabled={busy} style={primaryBtn}>
              {busy ? 'جاري...' : <><Check size={13} /> إنشاء وإرسال بيانات الدخول</>}
            </button>
          </div>
        </div>
      )}

      {/* Employees list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>
      ) : employees.length === 0 ? (
        <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
          <Users size={42} color="var(--text3)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>لا يوجد موظفون بعد</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>أضف موظفاً ليساعدك في إدارة متجرك بصلاحيات محددة</div>
          <button onClick={() => setShowAdd(true)} style={primaryBtn}>
            <UserPlus size={14} /> إضافة أول موظف
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {employees.map(e => {
            const isEditing = editId === e.merchant_code
            const enabledCount = Object.values(e.permissions || {}).filter(Boolean).length
            return (
              <div key={e.id} style={{ ...cardStyle, opacity: e.is_active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#6c5ce7,#9f8fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                    {e.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{e.name}</div>
                      {!e.is_active && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(232,64,64,0.15)', color: '#e84040', fontWeight: 700 }}>موقوف</span>}
                      {e.is_active && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(0,184,148,0.15)', color: '#00b894', fontWeight: 700 }}>نشط</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{e.email}</span>
                      <span>·</span>
                      <span style={{ fontFamily: 'monospace' }}>{e.merchant_code}</span>
                      {e.job_title && <><span>·</span><span>{e.job_title}</span></>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                      انضم {fmtRelative(e.created_at)} · {enabledCount} صلاحية مفعّلة
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!isEditing && (
                      <>
                        <button onClick={() => startEdit(e)} style={iconBtnStyle} title="تعديل الصلاحيات">
                          <Shield size={13} />
                        </button>
                        <button onClick={() => setResetPwdFor(e.merchant_code)} style={iconBtnStyle} title="تغيير كلمة المرور">
                          <Key size={13} />
                        </button>
                        <button onClick={() => toggleActive(e)} style={{ ...iconBtnStyle, color: e.is_active ? '#f0a800' : '#00b894' }} title={e.is_active ? 'إيقاف' : 'تفعيل'}>
                          <Power size={13} />
                        </button>
                        <button onClick={() => removeEmployee(e)} style={{ ...iconBtnStyle, color: '#e84040' }} title="حذف">
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Permissions panel (when not editing) */}
                {!isEditing && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {PERMISSION_ITEMS.filter(p => e.permissions?.[p.key]).map(p => (
                      <span key={p.key} style={permChip}>{p.label}</span>
                    ))}
                    {enabledCount === 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>لا توجد صلاحيات</span>
                    )}
                  </div>
                )}

                {/* Edit form */}
                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                    <Field label="المسمى الوظيفي" Icon={Briefcase}>
                      <input value={editJobTitle} onChange={ev => setEditJobTitle(ev.target.value)} style={inputStyle} />
                    </Field>
                    <div style={{ marginTop: 12, marginBottom: 12 }}>
                      <PermissionGrid value={editPermissions} onChange={setEditPermissions} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditId(null)} style={secondaryBtn}>إلغاء</button>
                      <button onClick={saveEdit} disabled={busy} style={primaryBtn}>
                        <Save size={13} /> حفظ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Reset password modal */}
      {resetPwdFor && (
        <div onClick={() => setResetPwdFor(null)} style={modalOverlayStyle}>
          <div onClick={ev => ev.stopPropagation()} style={modalStyle}>
            <h3 style={{ ...cardTitleStyle, marginTop: 0 }}>
              <Key size={14} /> تغيير كلمة المرور
            </h3>
            <Field label="كلمة المرور الجديدة (8+)" Icon={Key}>
              <input type="password" value={newPwd} onChange={ev => setNewPwd(ev.target.value)} style={inputStyle} autoFocus />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => { setResetPwdFor(null); setNewPwd('') }} style={secondaryBtn}>إلغاء</button>
              <button onClick={resetPassword} disabled={busy} style={primaryBtn}>تغيير</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PermissionGrid({ value, onChange }: { value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const groups: Record<string, typeof PERMISSION_ITEMS> = {}
  for (const p of PERMISSION_ITEMS) {
    (groups[p.group] = groups[p.group] || []).push(p)
  }
  const groupLabels: Record<string, string> = {
    view: 'عرض البيانات', manage: 'إدارة', finance: 'المالية', admin: 'إدارة النظام',
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      {Object.entries(groups).map(([g, items]) => (
        <div key={g} style={{ background: 'var(--surface2)', borderRadius: 9, padding: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            {groupLabels[g]}
          </div>
          {items.map(p => (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0', fontSize: 12, color: 'var(--text)' }}>
              <input type="checkbox" checked={!!value[p.key]} onChange={ev => onChange({ ...value, [p.key]: ev.target.checked })} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

function Field({ label, Icon, children }: any) {
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>
        <Icon size={11} /> {label}
      </label>
      {children}
    </div>
  )
}

const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12 }
const cardTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 12, marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }
const primaryBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, background: 'linear-gradient(135deg,#6c5ce7,#9f8fff)', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const secondaryBtn: React.CSSProperties = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const iconBtnStyle: React.CSSProperties = { width: 30, height: 30, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit' }
const permChip: React.CSSProperties = { fontSize: 10, padding: '3px 8px', background: 'rgba(108,92,231,0.12)', color: 'var(--accent)', borderRadius: 5, fontWeight: 700 }
const modalOverlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,18,40,0.65)', backdropFilter: 'blur(4px)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }
const modalStyle: React.CSSProperties = { width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }
