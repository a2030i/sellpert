import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import type { Merchant } from '../../lib/supabase'
import { UserPlus, Shield, Trash2, DollarSign, Database, Headphones, Megaphone, Truck, Info, ChevronDown, Briefcase, Users } from 'lucide-react'
import { toastOk, toastErr } from '../../components/Toast'

// ── Departments (internal staff only) ────────────────────────────────────────

type Department = 'finance' | 'data_entry' | 'support' | 'marketing' | 'operations' | 'manager'

const DEPT_META: Record<Department, { label: string; sub: string; color: string; Icon: any; defaultRole: 'admin' | 'employee' }> = {
  manager:    { label: 'مدير',         sub: 'وصول كامل للنظام',                  color: '#7c6bff', Icon: Shield,     defaultRole: 'admin'    },
  finance:    { label: 'مالية',         sub: 'الفواتير + الإيرادات + المعاملات',   color: '#00b894', Icon: DollarSign, defaultRole: 'employee' },
  data_entry: { label: 'مدخل بيانات',   sub: 'رفع وإدخال ملفات وبيانات التجار',    color: '#f59e0b', Icon: Database,   defaultRole: 'employee' },
  support:    { label: 'دعم فني',       sub: 'الطلبات + المهام + واتساب التجار',   color: '#4cc9f0', Icon: Headphones, defaultRole: 'employee' },
  marketing:  { label: 'تسويق',         sub: 'الإعلانات والحملات والمحتوى',        color: '#ff6b6b', Icon: Megaphone,  defaultRole: 'employee' },
  operations: { label: 'عمليات',        sub: 'الشحن + الإرساليات + المخزون',       color: '#fbbf24', Icon: Truck,      defaultRole: 'employee' },
}

// Permissions per department (what they can do in admin panel)
const DEPT_PERMS = [
  // Merchants section
  { key: 'view_merchants',     label: 'عرض قائمة التجار',           cat: 'تجار',     manager: true, finance: true,  data_entry: true,  support: true,  marketing: true,  operations: true },
  { key: 'edit_merchants',     label: 'تعديل بيانات التجار',         cat: 'تجار',     manager: true, finance: false, data_entry: true,  support: true,  marketing: false, operations: false },
  { key: 'create_merchants',   label: 'إضافة تجار جدد',             cat: 'تجار',     manager: true, finance: false, data_entry: true,  support: false, marketing: false, operations: false },
  { key: 'delete_merchants',   label: 'حذف تجار / مسح بياناتهم',    cat: 'تجار',     manager: true, finance: false, data_entry: false, support: false, marketing: false, operations: false },
  { key: 'impersonate',        label: 'الدخول كحساب تاجر (عرض)',     cat: 'تجار',     manager: true, finance: true,  data_entry: true,  support: true,  marketing: true,  operations: true },

  // Files section
  { key: 'view_files',         label: 'عرض الملفات المرفوعة',         cat: 'ملفات',    manager: true, finance: true,  data_entry: true,  support: false, marketing: true,  operations: true },
  { key: 'upload_files',       label: 'رفع ملفات للتجار',            cat: 'ملفات',    manager: true, finance: false, data_entry: true,  support: false, marketing: false, operations: true },
  { key: 'delete_files',       label: 'حذف ملفات',                   cat: 'ملفات',    manager: true, finance: false, data_entry: true,  support: false, marketing: false, operations: false },

  // Finance section
  { key: 'view_finance',       label: 'عرض البيانات المالية',         cat: 'مالية',    manager: true, finance: true,  data_entry: false, support: false, marketing: false, operations: false },
  { key: 'edit_billing',       label: 'تعديل الفواتير والمدفوعات',     cat: 'مالية',    manager: true, finance: true,  data_entry: false, support: false, marketing: false, operations: false },
  { key: 'view_revenue',       label: 'عرض إيرادات Sellpert',        cat: 'مالية',    manager: true, finance: true,  data_entry: false, support: false, marketing: false, operations: false },
  { key: 'manage_subscriptions', label: 'إيقاف/تفعيل اشتراكات',       cat: 'مالية',    manager: true, finance: true,  data_entry: false, support: false, marketing: false, operations: false },

  // Operations
  { key: 'tasks',              label: 'إدارة المهام والمتابعات',       cat: 'تشغيلي',  manager: true, finance: false, data_entry: false, support: true,  marketing: false, operations: true },
  { key: 'crm',                label: 'ملاحظات على التجار',          cat: 'تشغيلي',  manager: true, finance: true,  data_entry: true,  support: true,  marketing: true,  operations: true },
  { key: 'whatsapp_send',      label: 'واتساب لتاجر واحد',           cat: 'تشغيلي',  manager: true, finance: true,  data_entry: false, support: true,  marketing: true,  operations: true },
  { key: 'whatsapp_bulk',      label: 'واتساب جماعي',                cat: 'تشغيلي',  manager: true, finance: false, data_entry: false, support: false, marketing: true,  operations: false },
  { key: 'manage_inbound',     label: 'إدارة الإرساليات والشحن',      cat: 'تشغيلي',  manager: true, finance: false, data_entry: false, support: false, marketing: false, operations: true },
  { key: 'manage_ads',         label: 'إدارة الإعلانات والحملات',     cat: 'تشغيلي',  manager: true, finance: false, data_entry: false, support: false, marketing: true,  operations: false },

  // System
  { key: 'view_audit',         label: 'سجل التدقيق',                 cat: 'نظام',    manager: true, finance: false, data_entry: false, support: false, marketing: false, operations: false },
  { key: 'view_db_health',     label: 'صحة قاعدة البيانات',          cat: 'نظام',    manager: true, finance: false, data_entry: false, support: false, marketing: false, operations: false },
  { key: 'create_staff',       label: 'إضافة موظفين جدد',            cat: 'نظام',    manager: true, finance: false, data_entry: false, support: false, marketing: false, operations: false },
]

const PERM_CATEGORIES = ['تجار', 'ملفات', 'مالية', 'تشغيلي', 'نظام']

export default function EmployeesView({ merchants, onRefresh }: { merchants: Merchant[]; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [showPerms, setShowPerms] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState<Department | 'all'>('all')
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', department: 'data_entry' as Department, whatsapp_phone: '' })
  const [saving, setSaving] = useState(false)
  const [editDept, setEditDept] = useState<{ id: string; department: Department } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Only show internal staff (admin + employee), not merchants
  const staff = useMemo(() => merchants.filter(m =>
    ['admin', 'employee'].includes(m.role)
  ).filter(m => {
    if (filterDept !== 'all') {
      const d = ((m as any).department || (m.role === 'admin' ? 'manager' : 'data_entry')) as Department
      if (d !== filterDept) return false
    }
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
  }), [merchants, search, filterDept])

  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of merchants) {
      if (!['admin', 'employee'].includes(m.role)) continue
      const d = (m as any).department || (m.role === 'admin' ? 'manager' : 'data_entry')
      counts[d] = (counts[d] || 0) + 1
    }
    return counts
  }, [merchants])

  async function addStaff() {
    if (!addForm.name.trim() || !addForm.email.trim()) { toastErr('الاسم والبريد مطلوبان'); return }
    if (addForm.password.length < 8) { toastErr('كلمة المرور 8 أحرف على الأقل'); return }
    setSaving(true)
    try {
      const role = DEPT_META[addForm.department].defaultRole
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-merchant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim().toLowerCase(),
          password: addForm.password,
          role,
          whatsapp_phone: addForm.whatsapp_phone.trim() || undefined,
          currency: 'SAR',
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { toastErr(data.error || 'فشل الإضافة'); setSaving(false); return }

      // Set the department after creation
      if (data.merchant_code) {
        await supabase.from('merchants').update({ department: addForm.department }).eq('merchant_code', data.merchant_code)
      }

      toastOk(`✓ تمت إضافة ${DEPT_META[addForm.department].label}: ${addForm.name}`)
      setAddForm({ name: '', email: '', password: '', department: 'data_entry', whatsapp_phone: '' })
      setShowAdd(false); onRefresh()
    } catch (e: any) { toastErr(e.message) }
    setSaving(false)
  }

  async function updateDept(id: string, department: Department) {
    const role = DEPT_META[department].defaultRole
    await supabase.from('merchants').update({ department, role }).eq('id', id)
    setEditDept(null); onRefresh()
    toastOk('تم تحديث القسم')
  }

  async function deleteStaff(m: Merchant) {
    // Prevent deleting last manager
    if (m.role === 'admin') {
      const count = merchants.filter(x => x.role === 'admin').length
      if (count <= 1) { toastErr('لا يمكن حذف آخر مدير'); setDeleteConfirm(null); return }
    }
    await supabase.from('merchants').delete().eq('id', m.id)
    setDeleteConfirm(null); onRefresh()
    toastOk('تم الحذف')
  }

  function deptOf(m: Merchant): Department {
    return ((m as any).department || (m.role === 'admin' ? 'manager' : 'data_entry')) as Department
  }

  return (
    <div>
      <div style={{ marginBottom: 14, padding: 12, background: 'var(--surface2)', borderRadius: 9, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text)' }}>👥 الموظفون الداخليون</strong> — هذا فريق Sellpert (مالية، مدخلي بيانات، دعم، تسويق، إلخ).
        كل تاجر يضيف موظفيه بنفسه من حسابه.
      </div>

      {/* Stats by department */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        {(Object.keys(DEPT_META) as Department[]).map(d => {
          const meta = DEPT_META[d]
          const Icon = meta.Icon
          const count = stats[d] || 0
          const isActive = filterDept === d
          return (
            <div key={d}
              onClick={() => setFilterDept(filterDept === d ? 'all' : d)}
              style={{
                background: 'var(--surface)', border: `1px solid ${isActive ? meta.color : 'var(--border)'}`,
                borderRadius: 10, padding: 12, cursor: 'pointer',
                borderRight: `3px solid ${meta.color}`,
                opacity: filterDept === 'all' || isActive ? 1 : 0.55,
                transition: 'all 0.15s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: meta.color + '22', color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={14} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{count}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 3, lineHeight: 1.5 }}>{meta.sub}</div>
            </div>
          )
        })}
      </div>
      {filterDept !== 'all' && (
        <button onClick={() => setFilterDept('all')} style={{ marginBottom: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          ✕ إزالة الفلتر — عرض كل الأقسام
        </button>
      )}

      {/* Permissions matrix */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div onClick={() => setShowPerms(s => !s)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={14} color="var(--accent)" />
            <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: 0 }}>صلاحيات كل قسم — ماذا يستطيع كل دور؟</h3>
          </div>
          <ChevronDown size={14} style={{ transform: showPerms ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text3)' }} />
        </div>

        {showPerms && (
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            {PERM_CATEGORIES.map(cat => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{cat}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ ...permThStyle, textAlign: 'right', width: '36%' }}>الصلاحية</th>
                      {(Object.keys(DEPT_META) as Department[]).map(d => (
                        <th key={d} style={{ ...permThStyle, color: DEPT_META[d].color, whiteSpace: 'nowrap' }}>{DEPT_META[d].label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DEPT_PERMS.filter(p => p.cat === cat).map(p => (
                      <tr key={p.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={permTdStyle}>{p.label}</td>
                        {(Object.keys(DEPT_META) as Department[]).map(d => (
                          <td key={d} style={{ ...permCheckTd, color: (p as any)[d] ? DEPT_META[d].color : 'var(--text3)' }}>
                            {(p as any)[d] ? '✓' : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--text2)', lineHeight: 1.7 }}>
              💡 <strong>المدير</strong> يدخل من لوحة الأدمن. <strong>الموظفون</strong> يدخلون من لوحة الموظف ويرون فقط الأقسام المسموح بها لقسمهم.
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

      {showAdd && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>إضافة موظف داخلي</div>
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
            <div style={{ gridColumn: 'span 2' }}>
              <label style={S.label}>القسم</label>
              <select style={S.input} value={addForm.department} onChange={e => setAddForm({ ...addForm, department: e.target.value as Department })}>
                {(Object.keys(DEPT_META) as Department[]).map(d => (
                  <option key={d} value={d}>{DEPT_META[d].label} — {DEPT_META[d].sub}</option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.7 }}>
                الدور التلقائي: <strong style={{ color: DEPT_META[addForm.department].color }}>{DEPT_META[addForm.department].defaultRole === 'admin' ? 'مدير' : 'موظف'}</strong> ·
                يدخل من {DEPT_META[addForm.department].defaultRole === 'admin' ? 'لوحة الأدمن' : 'لوحة الموظف'}
              </div>
            </div>
          </div>
          <button style={S.saveBtn} onClick={addStaff} disabled={saving}>
            {saving ? '⟳ جاري الإنشاء...' : '✓ إنشاء حساب'}
          </button>
        </div>
      )}

      {/* Staff table */}
      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['الاسم', 'البريد', 'القسم', 'واتساب', 'تاريخ الإنضمام', 'إجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>لا يوجد موظفون بعد. اضغط "+ إضافة موظف"</td></tr>
              ) : staff.map(m => {
                const d = deptOf(m)
                const meta = DEPT_META[d]
                const DeptIcon = meta?.Icon || Briefcase
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
                      {editDept?.id === m.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select style={{ ...S.input, padding: '4px 8px', fontSize: 11 }} value={editDept.department} onChange={e => setEditDept({ ...editDept, department: e.target.value as Department })}>
                            {(Object.keys(DEPT_META) as Department[]).map(dx => (
                              <option key={dx} value={dx}>{DEPT_META[dx].label}</option>
                            ))}
                          </select>
                          <button style={{ ...S.miniBtn, background: 'var(--accent)', color: '#fff' }} onClick={() => updateDept(m.id, editDept.department)}>✓</button>
                          <button style={S.miniBtn} onClick={() => setEditDept(null)}>✕</button>
                        </div>
                      ) : (
                        <span
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: (meta?.color || '#7c6bff') + '22', color: meta?.color || '#7c6bff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                          onClick={() => setEditDept({ id: m.id, department: d })}
                          title="انقر للتعديل"
                        >
                          <DeptIcon size={11} />{meta?.label || d}
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

const permThStyle: React.CSSProperties = { textAlign: 'center', padding: '6px 6px', fontSize: 10, fontWeight: 800, color: 'var(--text3)' }
const permTdStyle: React.CSSProperties = { padding: '6px 8px', color: 'var(--text)', fontSize: 12 }
const permCheckTd: React.CSSProperties = { padding: '6px 6px', textAlign: 'center', fontSize: 14, fontWeight: 800 }
