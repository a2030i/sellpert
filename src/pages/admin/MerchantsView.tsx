import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../lib/passwordPolicy'
import { S, fmt } from './adminShared'
import type { Merchant, PlatformCredential } from '../../lib/supabase'
import BulkOpsBar from '../../components/BulkOpsBar'
import { Activity } from 'lucide-react'
import { hasPermission } from '../../lib/permissions'

type SellpertFeeType = 'none' | 'percentage' | 'fixed'
type ContractTerm = { merchant_code:string; sellpert_fee_type:SellpertFeeType; sellpert_fee_value:number }
type ContractEditor = { merchant:Merchant; feeType:SellpertFeeType; feeValue:string }

export default function MerchantsView({ currentUser, merchants, gmvByMerchant, credentials, onRefresh, onImpersonate, onOpenTimeline }: any) {
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<{ id: string; role: string } | null>(null)
  const [contractTerms, setContractTerms] = useState<Record<string,ContractTerm>>({})
  const [contractEditor, setContractEditor] = useState<ContractEditor|null>(null)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())
  const canCreate = hasPermission(currentUser, 'create_merchants')
  const canEdit = hasPermission(currentUser, 'edit_merchants')
  const canDelete = hasPermission(currentUser, 'delete_merchants')
  const canImpersonate = hasPermission(currentUser, 'impersonate')
  const canUseCrm = hasPermission(currentUser, 'crm')
  const canBulkOperate = canEdit || canDelete

  useEffect(() => {
    let cancelled = false
    supabase.from('merchant_contract_terms').select('merchant_code,sellpert_fee_type,sellpert_fee_value').then(({data,error}) => {
      if (cancelled) return
      if (error) { console.error('load Sellpert contract terms', error); return }
      const byMerchant:Record<string,ContractTerm> = {}
      for (const term of (data||[]) as ContractTerm[]) byMerchant[term.merchant_code] = term
      setContractTerms(byMerchant)
    })
    return () => { cancelled = true }
  }, [merchants.length])

  function toggleSelect(code: string) {
    setSelectedCodes(s => {
      const next = new Set(s)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }
  function toggleSelectAll(codes: string[]) {
    setSelectedCodes(s => {
      if (codes.every(c => s.has(c))) {
        const next = new Set(s)
        codes.forEach(c => next.delete(c))
        return next
      }
      const next = new Set(s)
      codes.forEach(c => next.add(c))
      return next
    })
  }

  // Only show actual merchants (role='merchant') here — staff are in EmployeesView
  const filtered = merchants
    .filter((m: Merchant) => m.role === 'merchant')
    .filter((m: Merchant) =>
      m.name?.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase()) ||
      m.merchant_code?.toLowerCase().includes(search.toLowerCase())
    )

  function credCount(code: string) {
    return credentials.filter((c: PlatformCredential) => c.merchant_code === code && c.is_active).length
  }

  async function addMerchant() {
    if (!addForm.name.trim() || !addForm.email.trim()) { setMsg({ type: 'err', text: 'الاسم والبريد الإلكتروني مطلوبان' }); return }
    if (!isStrongPassword(addForm.password)) { setMsg({ type: 'err', text: PASSWORD_POLICY_MESSAGE }); return }
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
        setMsg({ type: 'ok', text: `تمت إضافة ${addForm.name} — الكود: ${data.merchant_code}` })
        setAddForm({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
        setShowAdd(false); onRefresh()
      }
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setSaving(false)
  }

  async function deleteMerchant(id: string) {
    const target = merchants.find((m: Merchant) => m.id === id)
    if (target && target.role === 'admin') {
      const adminCount = merchants.filter((m: Merchant) => m.role === 'admin').length
      if (adminCount <= 1) { setMsg({ type: 'err', text: 'لا يمكن حذف آخر مدير' }); setDeleteConfirm(null); return }
    }
    await supabase.from('merchants').delete().eq('id', id)
    setDeleteConfirm(null); onRefresh()
  }

  async function updateRole(id: string, role: string) {
    await supabase.from('merchants').update({ role }).eq('id', id)
    setEditRole(null); onRefresh()
  }

  function editContract(merchant:Merchant) {
    const current = contractTerms[merchant.merchant_code]
    setContractEditor({ merchant, feeType:current?.sellpert_fee_type||'none', feeValue:String(current?.sellpert_fee_value||0) })
    setMsg(null)
  }

  async function saveContractTerm() {
    if (!contractEditor || !canEdit) return
    const value = contractEditor.feeType === 'none' ? 0 : Number(contractEditor.feeValue)
    if (!Number.isFinite(value) || value < 0 || (contractEditor.feeType === 'percentage' && value > 100)) {
      setMsg({ type:'err', text:'أدخل قيمة عمولة صحيحة؛ النسبة يجب أن تكون بين 0% و100% والمبلغ الثابت صفرًا أو أكثر.' })
      return
    }
    setSaving(true)
    const payload = { merchant_code:contractEditor.merchant.merchant_code, sellpert_fee_type:contractEditor.feeType, sellpert_fee_value:value, updated_at:new Date().toISOString() }
    const {data,error} = await supabase.from('merchant_contract_terms').upsert(payload,{onConflict:'merchant_code'}).select('merchant_code,sellpert_fee_type,sellpert_fee_value').maybeSingle()
    setSaving(false)
    if (error || !data) { setMsg({ type:'err', text:error?.message||'تعذر حفظ عمولة Sellpert' }); return }
    const saved = data as ContractTerm
    setContractTerms(current=>({...current,[saved.merchant_code]:saved}))
    setContractEditor(null)
    setMsg({ type:'ok', text:`تم حفظ عمولة Sellpert لمتجر ${contractEditor.merchant.name}: ${contractLabel(saved)}` })
  }

  function impersonate(merchant: Merchant) {
    onImpersonate(merchant)
  }

  async function wipeData(m: Merchant) {
    const ok = confirm(
      `مسح كامل لبيانات ${m.name}؟\n\n` +
      `سيتم حذف:\n` +
      `• كل الملفات المرفوعة\n` +
      `• الطلبات، المنتجات، المخزون\n` +
      `• المعاملات المالية، الإعلانات، المرتجعات\n` +
      `• كل البيانات المشتقة\n\n` +
      `لا يمكن التراجع. اكتب "مسح" للتأكيد.`
    )
    if (!ok) return
    const word = prompt('اكتب "مسح" للتأكيد:')
    if (word !== 'مسح') { setMsg({ type: 'err', text: 'تم الإلغاء' }); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('wipe_merchant_data', { p_merchant_code: m.merchant_code })
    setSaving(false)
    if (error) setMsg({ type: 'err', text: error.message })
    else {
      setMsg({ type: 'ok', text: `تم مسح بيانات ${m.name} — ${data?.uploads || 0} ملف محذوف` })
      onRefresh()
    }
  }

  return (
    <div>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {msg.text}
          <button aria-label="إغلاق الرسالة" style={{ marginRight: 12, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }} onClick={() => setMsg(null)}>إغلاق</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input style={{ ...S.searchInput, flex: 1 }} placeholder="ابحث بالاسم أو الإيميل أو الكود..." value={search} onChange={e => setSearch(e.target.value)} />
        {canCreate && <button style={S.addBtn} onClick={() => { setShowAdd(!showAdd); setMsg(null) }}>{showAdd ? 'إلغاء' : 'إضافة'}</button>}
      </div>

      {showAdd && canCreate && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>إضافة تاجر جديد</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, padding: 8, background: 'var(--surface2)', borderRadius: 6 }}>
            لإضافة موظف أو مدير، اذهب إلى قسم <strong>"الموظفون"</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { key: 'name',           label: 'الاسم الكامل',       placeholder: 'متجر النور',        type: 'text'     },
              { key: 'email',          label: 'البريد الإلكتروني',  placeholder: 'merchant@example.com', type: 'email'  },
              { key: 'password',       label: 'كلمة المرور',        placeholder: '12 حرفًا، حرف ورقم ورمز',  type: 'password' },
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
            {/* الدور دائماً تاجر هنا */}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={S.saveBtn} onClick={addMerchant} disabled={saving}>{saving ? 'جاري الإنشاء...' : 'إضافة وإنشاء حساب'}</button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>سيتم إنشاء حساب دخول فوري</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'إجمالي التجار', value: merchants.filter((m: Merchant) => m.role === 'merchant').length, color: 'var(--accent2)' },
          { label: 'لديهم تكاملات', value: merchants.filter((m: Merchant) => m.role === 'merchant' && credentials.some((c: PlatformCredential) => c.merchant_code === m.merchant_code && c.is_active)).length, color: 'var(--accent)' },
          { label: 'بدون تكاملات', value: merchants.filter((m: Merchant) => m.role === 'merchant' && !credentials.some((c: PlatformCredential) => c.merchant_code === m.merchant_code && c.is_active)).length, color: '#f59e0b' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {canBulkOperate && <BulkOpsBar
        selected={Array.from(selectedCodes)}
        onClear={() => setSelectedCodes(new Set())}
        onDone={() => { setSelectedCodes(new Set()); onRefresh() }}
      />}

      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: 30 }}>
                  {canBulkOperate && <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((m: Merchant) => selectedCodes.has(m.merchant_code))}
                    onChange={() => toggleSelectAll(filtered.map((m: Merchant) => m.merchant_code))}
                  />}
                </th>
                {['التاجر', 'البريد الإلكتروني', 'الكود', 'الدور', 'العملة', 'عمولة Sellpert', 'تكاملات', 'GMV الكلي', 'تاريخ الانضمام', 'إجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد نتائج</td></tr>
              ) : filtered.map((m: Merchant) => (
                <tr key={m.id} style={S.tr}>
                  <td style={S.td}>
                    {canBulkOperate && <input
                      type="checkbox"
                      checked={selectedCodes.has(m.merchant_code)}
                      onChange={() => toggleSelect(m.merchant_code)}
                    />}
                  </td>
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
                        </select>
                        <button style={{ ...S.miniBtn, background: 'var(--accent)' }} onClick={() => updateRole(m.id, editRole.role)}>حفظ</button>
                        <button style={S.miniBtn} onClick={() => setEditRole(null)}>إلغاء</button>
                      </div>
                    ) : (
                      <span style={{ ...S.roleBadge, background: 'rgba(0,229,176,0.1)', color: 'var(--accent2)', cursor: canEdit ? 'pointer' : 'default' }} onClick={() => canEdit && setEditRole({ id: m.id, role: m.role })}>
                        {m.role === 'merchant' ? 'تاجر' : m.role === 'employee' ? 'موظف' : 'مدير'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{m.currency}</td>
                  <td style={S.td}>
                    <button
                      type="button"
                      aria-label={`تعديل عمولة Sellpert لمتجر ${m.name}`}
                      style={{ ...S.miniBtn, color:contractTerms[m.merchant_code]?.sellpert_fee_type === 'none' || !contractTerms[m.merchant_code] ? 'var(--text3)' : 'var(--accent-strong)', cursor:canEdit?'pointer':'default' }}
                      onClick={() => canEdit && editContract(m)}
                      disabled={!canEdit}
                    >
                      {contractLabel(contractTerms[m.merchant_code])}
                    </button>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: credCount(m.merchant_code) > 0 ? 'var(--accent2)' : 'var(--text3)' }}>{credCount(m.merchant_code)} / 3</span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent2)' }}>{fmt(gmvByMerchant[m.merchant_code] || 0)}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{new Date(m.created_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</td>
                  <td style={S.td}>
                    {deleteConfirm === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={() => deleteMerchant(m.id)}>تأكيد الحذف</button>
                        <button style={S.miniBtn} onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {onOpenTimeline && canUseCrm && (
                          <button
                            style={{ ...S.miniBtn, background: 'rgba(0,184,148,0.1)', color: 'var(--accent2)', border: '1px solid rgba(0,184,148,0.25)' }}
                            onClick={() => onOpenTimeline(m.merchant_code)}
                            title="السجل والملاحظات"
                          >
                            <Activity size={11} style={{ display: 'inline-block', verticalAlign: 'middle' }} /> السجل
                          </button>
                        )}
                        {m.role === 'merchant' && canImpersonate ? (
                          <button
                            style={{ ...S.miniBtn, background: 'rgba(108,92,231,0.1)', color: 'var(--accent)', border: '1px solid rgba(108,92,231,0.25)' }}
                            onClick={() => impersonate(m)}
                            title="عرض حساب التاجر"
                          >
                            عرض
                          </button>
                        ) : null}
                        {m.role === 'merchant' && canDelete && (
                          <button
                            style={{ ...S.miniBtn, background: 'rgba(232,64,64,0.08)', color: 'var(--red)', border: '1px solid rgba(232,64,64,0.25)' }}
                            onClick={() => wipeData(m)}
                            title="مسح كل بيانات الملفات لهذا التاجر"
                          >
                            مسح البيانات
                          </button>
                        )}
                        {canDelete && <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConfirm(m.id)}>حذف</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {contractEditor && (
        <div role="dialog" aria-modal="true" aria-label={`عمولة Sellpert لمتجر ${contractEditor.merchant.name}`} style={{ position:'fixed', inset:0, zIndex:1600, display:'grid', placeItems:'center', padding:20, background:'rgba(7,27,43,.42)', backdropFilter:'blur(3px)' }} onMouseDown={event=>{if(event.currentTarget===event.target&&!saving)setContractEditor(null)}}>
          <div style={{ width:'min(460px,100%)', padding:24, border:'1px solid var(--border)', borderRadius:16, background:'var(--surface)', boxShadow:'0 24px 70px rgba(7,27,43,.24)' }}>
            <div style={{ fontSize:17, fontWeight:800 }}>عمولة Sellpert</div>
            <div style={{ marginTop:5, color:'var(--text3)', fontSize:12 }}>{contractEditor.merchant.name} · تطبّق على جميع منتجات التاجر حسب العقد.</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:20 }}>
              <div>
                <label style={S.label}>طريقة الاحتساب</label>
                <select aria-label="طريقة احتساب عمولة Sellpert" style={S.input} value={contractEditor.feeType} onChange={event=>setContractEditor(current=>current?{...current,feeType:event.target.value as SellpertFeeType,feeValue:event.target.value==='none'?'0':current.feeValue}:current)}>
                  <option value="none">بدون عمولة — صفر</option>
                  <option value="percentage">نسبة من سعر المنتج</option>
                  <option value="fixed">مبلغ ثابت لكل منتج</option>
                </select>
              </div>
              <div>
                <label style={S.label}>{contractEditor.feeType==='percentage'?'النسبة %':contractEditor.feeType==='fixed'?'المبلغ الثابت':'القيمة'}</label>
                <input aria-label="قيمة عمولة Sellpert" style={S.input} type="number" min="0" max={contractEditor.feeType==='percentage'?100:undefined} step="0.01" disabled={contractEditor.feeType==='none'} value={contractEditor.feeValue} onChange={event=>setContractEditor(current=>current?{...current,feeValue:event.target.value}:current)}/>
              </div>
            </div>
            <div style={{ marginTop:12, padding:10, borderRadius:9, background:'var(--surface2)', color:'var(--text3)', fontSize:11, lineHeight:1.7 }}>القيمة تُخصم كما هي وفق العقد، ولا يضيف النظام ضريبة عليها تلقائيًا. التاجر يستطيع رؤيتها في حساب الربحية ولا يستطيع تعديلها.</div>
            <div style={{ display:'flex', gap:9, marginTop:18 }}>
              <button style={S.saveBtn} disabled={saving} onClick={saveContractTerm}>{saving?'جارٍ الحفظ…':'حفظ العقد'}</button>
              <button style={S.miniBtn} disabled={saving} onClick={()=>setContractEditor(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function contractLabel(term?:ContractTerm) {
  if (!term || term.sellpert_fee_type === 'none' || Number(term.sellpert_fee_value) === 0) return 'بدون عمولة'
  const value = Number(term.sellpert_fee_value).toLocaleString('en-US',{maximumFractionDigits:2})
  return term.sellpert_fee_type === 'percentage' ? `${value}%` : `${value} ر.س`
}
