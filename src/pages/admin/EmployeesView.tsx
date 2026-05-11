import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import type { Merchant } from '../../lib/supabase'
import { UserPlus, Shield, Eye, Edit3, Upload, MessageSquare, Trash2, Crown, Briefcase, Info, ChevronDown } from 'lucide-react'
import { toastOk, toastErr } from '../../components/Toast'

// ── Role configuration ──────────────────────────────────────────────────────

type Role = 'employee' | 'admin' | 'super_admin'

const ROLE_META: Record<Role, { label: string; sub: string; color: string; Icon: any; badge: string }> = {
  employee:    { label: 'موظف',        sub: 'صلاحيات محددة على بيانات التجار',   color: '#f59e0b', Icon: Briefcase, badge: 'Employee' },
  admin:       { label: 'مدير',         sub: 'وصول كامل للنظام (يستثني الإعدادات الخطرة)', color: '#7c6bff', Icon: Shield,    badge: 'Admin' },
  super_admin: { label: 'Super Admin',  sub: 'وصول مطلق — إعدادات النظام والحذف الشامل',    color: '#e84040', Icon: Crown,     badge: 'Super' },
}

// What each role can actually do
const PERMISSIONS = [
  { key: 'view_merchants',     label: 'عرض قائمة التجار',           employee: true,  admin: true,  super_admin: true,  category: 'تجار' },
  { key: 'edit_merchants',     label: 'تعديل بيانات التجار',         employee: false, admin: true,  super_admin: true,  category: 'تجار' },
  { key: 'create_merchants',   label: 'إضافة تجار جدد',             employee: false, admin: true,  super_admin: true,  category: 'تجار' },
  { key: 'delete_merchants',   label: 'حذف تجار',                   employee: false, admin: false, super_admin: true,  category: 'تجار' },
  { key: 'wipe_merchant_data', label: 'مسح كل بيانات تاجر',          employee: false, admin: false, super_admin: true,  category: 'تجار' },
  { key: 'impersonate',        label: 'الدخول كحساب تاجر (👁 عرض)',  employee: false, admin: true,  super_admin: true,  category: 'تجار' },

  { key: 'view_files',         label: 'عرض الملفات المرفوعة',         employee: true,  admin: true,  super_admin: true,  category: 'ملفات' },
  { key: 'upload_files',       label: 'رفع ملفات للتجار',            employee: true,  admin: true,  super_admin: true,  category: 'ملفات' },
  { key: 'delete_files',       label: 'حذف ملف واحد',                employee: false, admin: true,  super_admin: true,  category: 'ملفات' },

  { key: 'view_finance',       label: 'عرض البيانات المالية',         employee: true,  admin: true,  super_admin: true,  category: 'مالية' },
  { key: 'edit_billing',       label: 'تعديل الفواتير والمدفوعات',     employee: false, admin: true,  super_admin: true,  category: 'مالية' },
  { key: 'view_revenue',       label: 'عرض إيرادات Sellpert',        employee: false, admin: true,  super_admin: true,  category: 'مالية' },

  { key: 'tasks',              label: 'إدارة المهام والمتابعات',       employee: true,  admin: true,  super_admin: true,  category: 'تشغيلي' },
  { key: 'crm',                label: 'إضافة ملاحظات على التجار',     employee: true,  admin: true,  super_admin: true,  category: 'تشغيلي' },
  { key: 'whatsapp_send',      label: 'إرسال واتساب لتاجر',           employee: true,  admin: true,  super_admin: true,  category: 'تشغيلي' },
  { key: 'whatsapp_bulk',      label: 'إرسال واتساب جماعي',          employee: false, admin: true,  super_admin: true,  category: 'تشغيلي' },

  { key: 'view_audit',         label: 'عرض سجل التدقيق',              employee: false, admin: true,  super_admin: true,  category: 'نظام' },
  { key: 'view_db_health',     label: 'صحة قاعدة البيانات',            employee: false, admin: true,  super_admin: true,  category: 'نظام' },
  { key: 'create_admins',      label: 'إنشاء/حذف مدراء',              employee: false, admin: false, super_admin: true,  category: 'نظام' },
  { key: 'manage_subscriptions', label: 'إيقاف/تفعيل اشتراكات',       employee: false, admin: true,  super_admin: true,  category: 'نظام' },
]

const PERM_CATEGORIES = ['تجار', 'ملفات', 'مالية', 'تشغيلي', 'نظام']

export default function EmployeesView({ merchants, onRefresh }: { merchants: Merchant[]; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [showPerms, setShowPerms] = useState(true)
  const [search, setSearch] = useState('')
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', role: 'employee' as Role, whatsapp_phone: '' })
  const [saving, setSaving] = useState(false)
  const [editRole, setEditRole] = useState<{ id: string; role: Role } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Only show admin/employee/super_admin in this view
  const staff = useMemo(() => merchants.filter(m =>
    ['employee', 'admin', 'super_admin'].includes(m.role)
  ).filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q) || m.merchant_code?.toLowerCase().includes(q)
  }), [merchants, search])

  const stats = useMemo(() => ({
    employees: merchants.filter(m => m.role === 'employee').length,
    admins:    merchants.filter(m => m.role === 'admin').length,
    supers:    merchants.filter(m => m.role === 'super_admin').length,
  }), [merchants])

  async function addStaff() {
    if (!addForm.name.trim() || !addForm.email.trim()) { toastErr('الاسم والبريد مطلوبان'); return }
    if (addForm.password.length < 8) { toastErr('كلمة المرور يجب 8 أحرف على الأقل'); return }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-merchant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim().toLowerCase(),
          password: addForm.password,
          role: addForm.role,
          whatsapp_phone: addForm.whatsapp_phone.trim() || undefined,
          currency: 'SAR',
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) toastErr(data.error || 'فشل الإضافة')
      else {
        toastOk(`✓ تمت إضافة ${ROLE_META[addForm.role].label}: ${addForm.name}`)
        setAddForm({ name: '', email: '', password: '', role: 'employee', whatsapp_phone: '' })
        setShowAdd(false); onRefresh()
      }
    } catch (e: any) { toastErr(e.message) }
    setSaving(false)
  }

  async function updateRole(id: string, role: Role) {
    await supabase.from('merchants').update({ role }).eq('id', id)
    setEditRole(null); onRefresh()
    toastOk('تم تحديث الدور')
  }

  async function deleteStaff(m: Merchant) {
    // Prevent deleting last super_admin
    if (m.role === 'super_admin') {
      const count = merchants.filter(x => x.role === 'super_admin').length
      if (count <= 1) { toastErr('لا يمكن حذف آخر Super Admin'); setDeleteConfirm(null); return }
    }
    await supabase.from('merchants').delete().eq('id', m.id)
    setDeleteConfirm(null); onRefresh()
    toastOk('تم الحذف')
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['employee', 'admin', 'super_admin'] as Role[]).map(r => {
          const meta = ROLE_META[r]
          const Icon = meta.Icon
          const count = r === 'employee' ? stats.employees : r === 'admin' ? stats.admins : stats.supers
          return (
            <div key={r} style={{ flex: '1 1 220px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12, borderRight: `3px solid ${meta.color}` }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: meta.color + '22', color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{meta.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{count}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{meta.sub}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Permissions matrix toggle */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div onClick={() => setShowPerms(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={14} color="var(--accent)" />
            <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: 0 }}>مصفوفة الصلاحيات — ماذا يستطيع كل دور؟</h3>
          </div>
          <ChevronDown size={14} style={{ transform: showPerms ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text3)' }} />
        </div>

        {showPerms && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            {PERM_CATEGORIES.map(cat => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4, padding: '4px 0' }}>{cat}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ ...permThStyle, textAlign: 'right', width: '50%' }}>الصلاحية</th>
                      <th style={{ ...permThStyle, color: '#f59e0b' }}>موظف</th>
                      <th style={{ ...permThStyle, color: '#7c6bff' }}>مدير</th>
                      <th style={{ ...permThStyle, color: '#e84040' }}>Super</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSIONS.filter(p => p.category === cat).map(p => (
                      <tr key={p.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={permTdStyle}>{p.label}</td>
                        <td style={permCheckTd}>{p.employee ? '✓' : '—'}</td>
                        <td style={permCheckTd}>{p.admin ? '✓' : '—'}</td>
                        <td style={permCheckTd}>{p.super_admin ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div style={{ marginTop: 8, padding: 10, background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--text2)', lineHeight: 1.7 }}>
              💡 <strong>الموظف</strong> يدخل من لوحة الموظف الخاصة (EmployeePanel) ويرى التجار المعيّنين له فقط (إذا فعّلت الـ assignment).
              <strong> المدير</strong> يدخل من لوحة الأدمن ويستطيع التحكم بكل التجار.
              <strong> Super Admin</strong> هو الدور الوحيد القادر على حذف بيانات أو إنشاء مدراء.
            </div>
          </div>
        )}
      </div>

      {/* Add bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <input style={{ ...S.searchInput, flex: 1 }} placeholder="ابحث بالاسم أو البريد..." value={search} onChange={e => setSearch(e.target.value)} />
        <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? '✕ إلغاء' : <><UserPlus size={14} style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }} /> إضافة موظف</>}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>إضافة موظف / مدير</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={S.label}>الاسم الكامل</label>
              <input style={S.input} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="عبدالله أحمد" />
            </div>
            <div>
              <label style={S.label}>البريد الإلكتروني</label>
              <input style={S.input} type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="staff@sellpert.com" />
            </div>
            <div>
              <label style={S.label}>كلمة المرور</label>
              <input style={S.input} type="password" value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} placeholder="8 أحرف على الأقل" />
            </div>
            <div>
              <label style={S.label}>واتساب (اختياري)</label>
              <input style={S.input} value={addForm.whatsapp_phone} onChange={e => setAddForm({ ...addForm, whatsapp_phone: e.target.value })} placeholder="+966501234567" />
            </div>
            <div>
              <label style={S.label}>الدور</label>
              <select style={S.input} value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value as Role })}>
                <option value="employee">موظف — صلاحيات محددة</option>
                <option value="admin">مدير — وصول واسع</option>
                <option value="super_admin">Super Admin — وصول مطلق</option>
              </select>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, lineHeight: 1.6 }}>
                {ROLE_META[addForm.role].sub}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={S.saveBtn} onClick={addStaff} disabled={saving}>
              {saving ? '⟳ جاري الإنشاء...' : '✓ إنشاء الحساب'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {addForm.role === 'employee' && '⚙ سيدخل من لوحة الموظف'}
              {addForm.role === 'admin' && '⚙ سيدخل من لوحة الأدمن'}
              {addForm.role === 'super_admin' && '⚠ صلاحيات مطلقة — استخدمها بحذر'}
            </span>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['الاسم', 'البريد', 'الدور', 'واتساب', 'تاريخ الإنشاء', 'إجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>لا يوجد موظفون. اضغط "+ إضافة موظف"</td></tr>
              ) : staff.map(m => {
                const role = m.role as Role
                const meta = ROLE_META[role]
                const RoleIcon = meta?.Icon || Briefcase
                return (
                  <tr key={m.id} style={S.tr}>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${meta?.color || '#7c6bff'}, ${meta?.color || '#9f8fff'}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {m.name?.[0] || '?'}
                        </div>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{m.email}</td>
                    <td style={S.td}>
                      {editRole?.id === m.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select style={{ ...S.input, padding: '4px 8px', fontSize: 11 }} value={editRole.role} onChange={e => setEditRole({ ...editRole, role: e.target.value as Role })}>
                            <option value="employee">موظف</option>
                            <option value="admin">مدير</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                          <button style={{ ...S.miniBtn, background: 'var(--accent)', color: '#fff' }} onClick={() => updateRole(m.id, editRole.role)}>✓</button>
                          <button style={S.miniBtn} onClick={() => setEditRole(null)}>✕</button>
                        </div>
                      ) : (
                        <span
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: (meta?.color || '#7c6bff') + '22', color: meta?.color || '#7c6bff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                          onClick={() => setEditRole({ id: m.id, role })}
                          title="انقر للتعديل"
                        >
                          <RoleIcon size={11} />{meta?.label || role}
                        </span>
                      )}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{m.whatsapp_phone || '—'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{new Date(m.created_at).toLocaleDateString('ar-SA')}</td>
                    <td style={S.td}>
                      {deleteConfirm === m.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={() => deleteStaff(m)}>تأكيد</button>
                          <button style={S.miniBtn} onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                        </div>
                      ) : (
                        <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConfirm(m.id)}>
                          <Trash2 size={11} style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }} /> حذف
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const permThStyle: React.CSSProperties = { textAlign: 'center', padding: '6px 8px', fontSize: 10, fontWeight: 800, color: 'var(--text3)' }
const permTdStyle: React.CSSProperties = { padding: '6px 8px', color: 'var(--text)', fontSize: 12 }
const permCheckTd: React.CSSProperties = { padding: '6px 8px', textAlign: 'center', fontSize: 14, fontWeight: 800, color: 'var(--text)' }
