import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import type { Merchant } from '../../lib/supabase'
import { UserPlus, Trash2, Settings, Briefcase, Crown, ChevronDown, Sparkles, Check } from 'lucide-react'
import { toastOk, toastErr } from '../../components/Toast'
import PermissionsEditor from '../../components/PermissionsEditor'
import { ALL_PERMISSIONS, PERM_CATEGORIES, DEPT_TEMPLATES, DEPT_LABELS, getPermissions, type Department, type PermKey } from '../../lib/permissions'

export default function EmployeesView({ merchants, onRefresh }: { merchants: Merchant[]; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [editPerms, setEditPerms] = useState<Merchant | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [addForm, setAddForm] = useState({
    name: '', email: '', password: '', whatsapp_phone: '',
    department: 'data_entry' as Department,
    perms: new Set<PermKey>(DEPT_TEMPLATES['data_entry']),
  })

  function applyTemplateInForm(d: Department) {
    setAddForm(f => ({ ...f, department: d, perms: new Set(DEPT_TEMPLATES[d]) }))
  }
  function toggleAddPerm(k: PermKey) {
    setAddForm(f => {
      const n = new Set(f.perms)
      if (n.has(k)) n.delete(k); else n.add(k)
      return { ...f, perms: n, department: 'custom' }
    })
  }

  const staff = useMemo(() => merchants.filter(m =>
    ['admin', 'employee'].includes(m.role)
  ).filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return m.name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
  }), [merchants, search])

  async function addStaff() {
    if (!addForm.name.trim() || !addForm.email.trim()) { toastErr('الاسم والبريد مطلوبان'); return }
    if (addForm.password.length < 8) { toastErr('كلمة المرور 8 أحرف على الأقل'); return }
    setSaving(true)
    try {
      const role = addForm.department === 'manager' ? 'admin' : 'employee'
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

      // Save permissions + department
      if (data.merchant_code) {
        await supabase.from('merchants').update({
          department: addForm.department,
          permissions: Array.from(addForm.perms),
        }).eq('merchant_code', data.merchant_code)
      }

      toastOk(`✓ تمت إضافة ${addForm.name} (${addForm.perms.size} صلاحية)`)
      setAddForm({ name: '', email: '', password: '', whatsapp_phone: '', department: 'data_entry', perms: new Set(DEPT_TEMPLATES['data_entry']) })
      setShowAdd(false); onRefresh()
    } catch (e: any) { toastErr(e.message) }
    setSaving(false)
  }

  async function deleteStaff(m: Merchant) {
    if (m.role === 'admin') {
      const count = merchants.filter(x => x.role === 'admin').length
      if (count <= 1) { toastErr('لا يمكن حذف آخر مدير'); setDeleteConfirm(null); return }
    }
    // الحذف عبر دالة Edge موثّقة: تحذف مستخدم Auth وصف الموظف معاً —
    // الحذف المباشر للصف كان يترك مستخدم Auth يتيماً يستطيع تسجيل الدخول
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-employee`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_auth', auth_id: m.id }),
    })
    const data = await res.json().catch(() => ({}))
    setDeleteConfirm(null)
    if (!res.ok || data.error) { toastErr(data.error || 'فشل الحذف'); return }
    onRefresh()
    toastOk('تم الحذف')
  }

  function deptOf(m: Merchant): Department {
    return ((m as any).department || (m.role === 'admin' ? 'manager' : 'custom')) as Department
  }

  return (
    <div>
      {/* Intro */}
      <div style={{ marginBottom: 14, padding: 12, background: 'var(--surface2)', borderRadius: 9, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text)' }}>👥 الموظفون الداخليون</strong> — فريقك في Sellpert.
        كل موظف له <strong>صلاحيات مخصصة</strong> تقرّر ما يستطيع رؤيته/تعديله.
        يمكنك البدء من قالب جاهز للقسم ثم التعديل.
        <br/>
        <span style={{ color: 'var(--text3)' }}>كل تاجر يدير موظفيه بنفسه من حسابه.</span>
      </div>

      {/* Add bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <input style={{ ...S.searchInput, flex: 1 }} placeholder="ابحث بالاسم أو البريد..." value={search} onChange={e => setSearch(e.target.value)} />
        <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? '✕ إلغاء' : <><UserPlus size={14} style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }} /> إضافة موظف</>}
        </button>
      </div>

      {/* Add form with inline permissions */}
      {showAdd && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>موظف جديد + صلاحياته</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
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
          </div>

          {/* Templates */}
          <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 9, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={11} /> ابدأ من قالب (اختياري — يمكنك التعديل بعدها)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(Object.keys(DEPT_LABELS) as Department[]).map(d => {
                const active = addForm.department === d
                return (
                  <button key={d} onClick={() => applyTemplateInForm(d)} style={{
                    padding: '5px 12px', fontSize: 11, fontWeight: 700,
                    background: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? '#fff' : 'var(--text2)',
                    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                    borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{DEPT_LABELS[d]}</button>
                )
              })}
            </div>
          </div>

          {/* Permission checklist */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ ...S.label, marginBottom: 0 }}>الصلاحيات المخصصة</label>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                <strong style={{ color: 'var(--accent)' }}>{addForm.perms.size}</strong> / {ALL_PERMISSIONS.length} مختارة
              </span>
            </div>
            {PERM_CATEGORIES.map(cat => {
              const catPerms = ALL_PERMISSIONS.filter(p => p.category === cat)
              return (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 }}>{cat}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
                    {catPerms.map(p => {
                      const on = addForm.perms.has(p.key)
                      return (
                        <label key={p.key} onClick={() => toggleAddPerm(p.key)} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', borderRadius: 7,
                          background: on ? 'rgba(108,92,231,0.10)' : 'var(--surface)',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                          cursor: 'pointer', fontSize: 12,
                        }}>
                          <div style={{
                            width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                            background: on ? 'var(--accent)' : 'transparent',
                            border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border2)'),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {on && <Check size={10} color="#fff" strokeWidth={3} />}
                          </div>
                          <span style={{ color: 'var(--text)' }}>{p.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={S.saveBtn} onClick={addStaff} disabled={saving}>
              {saving ? '⟳ جاري الإنشاء...' : '✓ إنشاء حساب'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {addForm.department === 'manager'
                ? '⚠ سيكون مدير — وصول كامل للنظام'
                : `سيدخل من لوحة الموظف ويرى ${addForm.perms.size} ميزة فقط`}
            </span>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['الاسم', 'البريد', 'القسم/الدور', 'الصلاحيات', 'إجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>لا يوجد موظفون بعد. اضغط "+ إضافة موظف"</td></tr>
              ) : staff.map(m => {
                const dept = deptOf(m)
                const myPerms = getPermissions(m)
                const isManager = m.role === 'admin'
                return (
                  <tr key={m.id} style={S.tr}>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: isManager ? 'linear-gradient(135deg, #7c6bff, #9f8fff)' : 'linear-gradient(135deg, #f59e0b, #fbbf24)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {isManager ? <Crown size={14} /> : <Briefcase size={14} />}
                        </div>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{m.email}</td>
                    <td style={S.td}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 9px', borderRadius: 5,
                        background: isManager ? 'rgba(124,107,255,0.15)' : 'rgba(245,158,11,0.12)',
                        color: isManager ? 'var(--accent)' : '#f59e0b',
                        fontWeight: 700, fontSize: 11,
                      }}>
                        {DEPT_LABELS[dept] || dept}
                      </span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
                          <div style={{
                            height: '100%',
                            width: `${(myPerms.size / ALL_PERMISSIONS.length) * 100}%`,
                            background: isManager ? '#7c6bff' : myPerms.size > 10 ? '#00b894' : myPerms.size > 3 ? '#f59e0b' : 'var(--text3)',
                          }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', minWidth: 60, fontFamily: 'monospace' }}>
                          {isManager ? 'كل الصلاحيات' : `${myPerms.size} / ${ALL_PERMISSIONS.length}`}
                        </span>
                      </div>
                    </td>
                    <td style={S.td}>
                      {deleteConfirm === m.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={() => deleteStaff(m)}>تأكيد</button>
                          <button style={S.miniBtn} onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!isManager && (
                            <button
                              style={{ ...S.miniBtn, background: 'rgba(108,92,231,0.1)', color: 'var(--accent)', border: '1px solid rgba(108,92,231,0.25)' }}
                              onClick={() => setEditPerms(m)}
                              title="تخصيص الصلاحيات"
                            >
                              <Settings size={11} style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }} /> صلاحيات
                            </button>
                          )}
                          <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConfirm(m.id)}>
                            <Trash2 size={11} style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }} /> حذف
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editPerms && (
        <PermissionsEditor employee={editPerms} onClose={() => setEditPerms(null)} onSaved={onRefresh} />
      )}
    </div>
  )
}
