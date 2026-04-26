import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, fmt } from './adminShared'
import type { Merchant, PlatformCredential } from '../../lib/supabase'

export default function MerchantsView({ merchants, gmvByMerchant, credentials, onRefresh, onImpersonate }: any) {
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<{ id: string; role: string } | null>(null)

  const filtered = merchants.filter((m: Merchant) =>
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.email?.toLowerCase().includes(search.toLowerCase()) ||
    m.merchant_code?.toLowerCase().includes(search.toLowerCase())
  )

  function credCount(code: string) {
    return credentials.filter((c: PlatformCredential) => c.merchant_code === code && c.is_active).length
  }

  async function addMerchant() {
    if (!addForm.name.trim() || !addForm.email.trim()) { setMsg({ type: 'err', text: 'الاسم والبريد الإلكتروني مطلوبان' }); return }
    if (!addForm.password.trim() || addForm.password.length < 8) { setMsg({ type: 'err', text: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }); return }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-merchant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addForm.name.trim(), email: addForm.email.trim().toLowerCase(), password: addForm.password, currency: addForm.currency, role: addForm.role, whatsapp_phone: addForm.whatsapp_phone.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setMsg({ type: 'err', text: data.error || 'خطأ في الإنشاء' }) }
      else {
        setMsg({ type: 'ok', text: `✓ تمت إضافة ${addForm.name} — الكود: ${data.merchant_code}` })
        setAddForm({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
        setShowAdd(false); onRefresh()
      }
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setSaving(false)
  }

  async function deleteMerchant(id: string) {
    const target = merchants.find((m: Merchant) => m.id === id)
    if (target && ['admin', 'super_admin'].includes(target.role)) {
      const adminCount = merchants.filter((m: Merchant) => ['admin', 'super_admin'].includes(m.role)).length
      if (adminCount <= 1) { setMsg({ type: 'err', text: 'لا يمكن حذف آخر مدير' }); setDeleteConfirm(null); return }
    }
    await supabase.from('merchants').delete().eq('id', id)
    setDeleteConfirm(null); onRefresh()
  }

  async function updateRole(id: string, role: string) {
    await supabase.from('merchants').update({ role }).eq('id', id)
    setEditRole(null); onRefresh()
  }

  function impersonate(merchant: Merchant) {
    onImpersonate(merchant)
  }

  return (
    <div>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginRight: 12, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input style={{ ...S.searchInput, flex: 1 }} placeholder="ابحث بالاسم أو الإيميل أو الكود..." value={search} onChange={e => setSearch(e.target.value)} />
        <button style={S.addBtn} onClick={() => { setShowAdd(!showAdd); setMsg(null) }}>{showAdd ? '✕ إلغاء' : '+ إضافة'}</button>
      </div>

      {showAdd && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>إضافة تاجر / مدير جديد</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { key: 'name',           label: 'الاسم الكامل',       placeholder: 'متجر النور',        type: 'text'     },
              { key: 'email',          label: 'البريد الإلكتروني',  placeholder: 'merchant@example.com', type: 'email'  },
              { key: 'password',       label: 'كلمة المرور',        placeholder: '8 أحرف على الأقل',  type: 'password' },
              { key: 'whatsapp_phone', label: 'واتساب (اختياري)',   placeholder: '+966501234567',      type: 'text'     },
            ].map(f => (
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                <input style={S.input} type={f.type} placeholder={f.placeholder} value={(addForm as any)[f.key]} onChange={e => setAddForm({ ...addForm, [f.key]: e.target.value })} />
              </div>
            ))}
            <div>
              <label style={S.label}>العملة</label>
              <select style={S.input} value={addForm.currency} onChange={e => setAddForm({ ...addForm, currency: e.target.value })}>
                <option value="SAR">ر.س — ريال سعودي</option>
                <option value="AED">د.إ — درهم إماراتي</option>
                <option value="USD">$ — دولار</option>
              </select>
            </div>
            <div>
              <label style={S.label}>الدور</label>
              <select style={S.input} value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })}>
                <option value="merchant">تاجر</option>
                <option value="employee">موظف</option>
                <option value="admin">مدير</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={S.saveBtn} onClick={addMerchant} disabled={saving}>{saving ? '⟳ جاري الإنشاء...' : '✓ إضافة وإنشاء حساب'}</button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>سيتم إنشاء حساب دخول فوري</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'إجمالي', value: merchants.length, color: 'var(--text)' },
          { label: 'تجار', value: merchants.filter((m: Merchant) => m.role === 'merchant').length, color: 'var(--accent2)' },
          { label: 'موظفون', value: merchants.filter((m: Merchant) => m.role === 'employee').length, color: '#f59e0b' },
          { label: 'مدراء', value: merchants.filter((m: Merchant) => m.role === 'admin' || m.role === 'super_admin').length, color: 'var(--accent)' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['التاجر', 'البريد الإلكتروني', 'الكود', 'الدور', 'العملة', 'تكاملات', 'GMV الكلي', 'تاريخ الانضمام', 'إجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد نتائج</td></tr>
              ) : filtered.map((m: Merchant) => (
                <tr key={m.id} style={S.tr}>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,var(--accent),var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.name?.[0] || '?'}</div>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{m.email}</td>
                  <td style={S.td}><span style={S.codeTag}>{m.merchant_code}</span></td>
                  <td style={S.td}>
                    {editRole?.id === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select style={{ ...S.input, padding: '4px 8px', fontSize: 11 }} value={editRole.role} onChange={e => setEditRole({ ...editRole, role: e.target.value })}>
                          <option value="merchant">تاجر</option>
                          <option value="employee">موظف</option>
                          <option value="admin">مدير</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <button style={{ ...S.miniBtn, background: 'var(--accent)' }} onClick={() => updateRole(m.id, editRole.role)}>✓</button>
                        <button style={S.miniBtn} onClick={() => setEditRole(null)}>✕</button>
                      </div>
                    ) : (
                      <span style={{ ...S.roleBadge, background: m.role === 'merchant' ? 'rgba(0,229,176,0.1)' : m.role === 'employee' ? 'rgba(245,158,11,0.1)' : 'rgba(124,107,255,0.15)', color: m.role === 'merchant' ? 'var(--accent2)' : m.role === 'employee' ? '#f59e0b' : 'var(--accent)', cursor: 'pointer' }} onClick={() => setEditRole({ id: m.id, role: m.role })}>
                        {m.role === 'merchant' ? 'تاجر' : m.role === 'employee' ? 'موظف' : m.role === 'admin' ? 'مدير' : 'Super Admin'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{m.currency}</td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: credCount(m.merchant_code) > 0 ? 'var(--accent2)' : 'var(--text3)' }}>{credCount(m.merchant_code)} / 3</span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent2)' }}>{fmt(gmvByMerchant[m.merchant_code] || 0)}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{new Date(m.created_at).toLocaleDateString('ar-SA')}</td>
                  <td style={S.td}>
                    {deleteConfirm === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={() => deleteMerchant(m.id)}>تأكيد الحذف</button>
                        <button style={S.miniBtn} onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {m.role === 'merchant' || m.role === 'employee' ? (
                          <button
                            style={{ ...S.miniBtn, background: 'rgba(108,92,231,0.1)', color: 'var(--accent)', border: '1px solid rgba(108,92,231,0.25)' }}
                            onClick={() => impersonate(m)}
                            title="عرض حساب التاجر"
                          >
                            👁 عرض
                          </button>
                        ) : null}
                        <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConfirm(m.id)}>🗑 حذف</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
