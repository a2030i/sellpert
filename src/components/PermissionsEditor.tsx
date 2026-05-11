import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ALL_PERMISSIONS, PERM_CATEGORIES, DEPT_TEMPLATES, DEPT_LABELS, getPermissions, type PermKey, type Department } from '../lib/permissions'
import type { Merchant } from '../lib/supabase'
import { X, Save, Sparkles, Check } from 'lucide-react'
import { toastOk, toastErr } from './Toast'

interface Props {
  employee: Merchant
  onClose: () => void
  onSaved: () => void
}

export default function PermissionsEditor({ employee, onClose, onSaved }: Props) {
  const [perms, setPerms] = useState<Set<PermKey>>(getPermissions(employee))
  const [department, setDepartment] = useState<Department>(((employee as any).department || 'custom') as Department)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setPerms(getPermissions(employee))
    setDepartment(((employee as any).department || 'custom') as Department)
  }, [employee])

  function toggle(k: PermKey) {
    setPerms(p => {
      const n = new Set(p)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  function applyTemplate(d: Department) {
    setDepartment(d)
    setPerms(new Set(DEPT_TEMPLATES[d]))
  }

  function toggleCategory(cat: string, on: boolean) {
    const keys = ALL_PERMISSIONS.filter(p => p.category === cat).map(p => p.key)
    setPerms(p => {
      const n = new Set(p)
      if (on) keys.forEach(k => n.add(k))
      else    keys.forEach(k => n.delete(k))
      return n
    })
  }

  async function save() {
    setSaving(true)
    const arr = Array.from(perms)
    const role = department === 'manager' ? 'admin' : 'employee'
    const { error } = await supabase.from('merchants')
      .update({ permissions: arr, department, role })
      .eq('id', employee.id)
    setSaving(false)
    if (error) toastErr(error.message)
    else { toastOk(`✓ تم حفظ ${arr.length} صلاحية لـ ${employee.name}`); onSaved(); onClose() }
  }

  const visiblePerms = search.trim()
    ? ALL_PERMISSIONS.filter(p => p.label.toLowerCase().includes(search.toLowerCase()))
    : ALL_PERMISSIONS

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>صلاحيات: {employee.name}</h2>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
              {employee.email} · {perms.size} صلاحية محددة من {ALL_PERMISSIONS.length}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn}><X size={16} /></button>
        </div>

        {/* Templates row */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={11} /> ابدأ من قالب جاهز (يمكنك التعديل بعدها)
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(DEPT_LABELS) as Department[]).map(d => (
              <button key={d} onClick={() => applyTemplate(d)} style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 700,
                background: department === d ? 'var(--accent)' : 'var(--surface)',
                color: department === d ? '#fff' : 'var(--text2)',
                border: '1px solid ' + (department === d ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              }}>{DEPT_LABELS[d]}</button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث في الصلاحيات..."
            style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }} />
        </div>

        {/* Body — permissions checklist */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 16px' }}>
          {PERM_CATEGORIES.map(cat => {
            const catPerms = visiblePerms.filter(p => p.category === cat)
            if (catPerms.length === 0) return null
            const allSelected = catPerms.every(p => perms.has(p.key))
            const someSelected = catPerms.some(p => perms.has(p.key))
            return (
              <div key={cat} style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{cat}</div>
                  <button onClick={() => toggleCategory(cat, !allSelected)} style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {allSelected ? 'إلغاء الكل' : someSelected ? 'تحديد الكل' : 'تحديد الكل'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4 }}>
                  {catPerms.map(p => {
                    const on = perms.has(p.key)
                    return (
                      <label key={p.key} onClick={() => toggle(p.key)} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', borderRadius: 7,
                        background: on ? 'rgba(108,92,231,0.10)' : 'var(--surface2)',
                        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                        cursor: 'pointer', fontSize: 12,
                      }}>
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: on ? 'var(--accent)' : 'transparent',
                          border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border2)'),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {on && <Check size={11} color="#fff" strokeWidth={3} />}
                        </div>
                        <span style={{ color: 'var(--text)', flex: 1 }}>{p.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--surface2)' }}>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            <strong style={{ color: 'var(--text)', fontSize: 14 }}>{perms.size}</strong> صلاحية مختارة
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{
              padding: '8px 16px', background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text2)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>إلغاء</button>
            <button onClick={save} disabled={saving} style={{
              padding: '8px 16px', background: 'var(--accent)', border: 'none',
              color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'inherit',
            }}>
              <Save size={13} /> {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,18,40,0.65)', backdropFilter: 'blur(4px)',
  zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const modalStyle: React.CSSProperties = {
  width: '100%', maxWidth: 720, maxHeight: '88vh', background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 14,
  boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const iconBtn: React.CSSProperties = {
  width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--surface2)',
  color: 'var(--text2)', borderRadius: 7, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
}
