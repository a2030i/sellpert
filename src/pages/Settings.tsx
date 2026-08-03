import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useEffect } from 'react'
import type { Merchant } from '../lib/supabase'
import { AlertTriangle, CalendarClock, Download, ShieldCheck, X } from 'lucide-react'

type ClosureRequest = {
  id: string
  status: 'pending' | 'cancelled' | 'closed'
  reason?: string | null
  requested_at: string
  scheduled_for: string
}

export default function Settings({ merchant, onUpdate }: { merchant: Merchant | null; onUpdate: (m: Merchant) => void }) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [name, setName] = useState(merchant?.name || '')
  const [phone, setPhone] = useState(merchant?.whatsapp_phone || '')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [closureLoading, setClosureLoading] = useState(false)
  const [closureRequest, setClosureRequest] = useState<ClosureRequest | null>(null)
  const [showClosure, setShowClosure] = useState(false)
  const [closureReason, setClosureReason] = useState('')
  const [closureConfirmation, setClosureConfirmation] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const isOwner = merchant?.role === 'merchant' && !merchant?.owner_merchant_code

  useEffect(() => {
    setName(merchant?.name || '')
    setPhone(merchant?.whatsapp_phone || '')
  }, [merchant?.id, merchant?.name, merchant?.whatsapp_phone])

  useEffect(() => {
    if (!isOwner) return
    supabase.functions.invoke('account-lifecycle', { body: { action: 'status' } })
      .then(({ data, error }) => {
        if (!error) setClosureRequest((data?.request as ClosureRequest | null) || null)
      })
  }, [isOwner, merchant?.merchant_code])

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setMsg({ type: 'err', text: 'الحجم الأقصى 2MB' }); return }
    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
    if (!allowedTypes.has(file.type)) { setMsg({ type: 'err', text: 'الصيغ المدعومة: PNG وJPG وWebP فقط' }); return }

    setUploading(true); setMsg(null)
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `logos/${merchant!.merchant_code}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('merchant-assets')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from('merchant-assets').getPublicUrl(path)
      const { error: dbErr } = await supabase.rpc('update_my_store_profile', {
        p_logo_url: publicUrl,
        p_merchant_code: merchant!.merchant_code,
      })
      if (dbErr) throw dbErr

      onUpdate({ ...merchant!, logo_url: publicUrl })
      setMsg({ type: 'ok', text: 'تم رفع شعار المتجر بنجاح' })
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message })
    }
    setUploading(false)
  }

  async function saveProfile() {
    if (!name.trim()) { setMsg({ type: 'err', text: 'الاسم مطلوب' }); return }
    setSaving(true); setMsg(null)
    try {
      const { data: updated, error } = await supabase.rpc('update_my_store_profile', {
        p_name: name.trim(),
        p_whatsapp_phone: phone.trim(),
        p_merchant_code: merchant!.merchant_code,
      })
      if (error) throw error
      onUpdate({ ...merchant!, ...(updated as Partial<Merchant>) })
      setMsg({ type: 'ok', text: 'تم حفظ بيانات المتجر بنجاح' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setSaving(false)
  }

  async function sendPasswordReset() {
    const accountEmail = merchant?.account_email || merchant?.email
    if (!accountEmail) return
    setResetting(true); setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(accountEmail, {
      redirectTo: `${window.location.origin}/auth/recovery`,
    })
    setMsg(error
      ? { type: 'err', text: 'تعذر إرسال رابط تغيير كلمة المرور: ' + error.message }
      : { type: 'ok', text: 'تم إرسال رابط تغيير كلمة المرور إلى بريدك الإلكتروني.' })
    setResetting(false)
  }

  async function copyMerchantCode() {
    if (!merchant?.merchant_code) return
    await navigator.clipboard.writeText(merchant.merchant_code)
    setMsg({ type: 'ok', text: 'تم نسخ رمز المتجر.' })
  }

  async function exportStoreData() {
    setExporting(true); setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('account-lifecycle', { body: { action: 'export' } })
      if (error) throw error
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `sellpert-${merchant?.merchant_code}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
      setMsg({ type: 'ok', text: 'تم تجهيز نسخة بيانات المتجر وتنزيلها إلى جهازك.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: 'تعذر تجهيز نسخة البيانات: ' + (e?.message || 'حاول مرة أخرى.') })
    }
    setExporting(false)
  }

  async function requestClosure() {
    if (closureConfirmation !== 'إغلاق الحساب') {
      setMsg({ type: 'err', text: 'اكتب «إغلاق الحساب» لتأكيد الطلب.' }); return
    }
    setClosureLoading(true); setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('account-lifecycle', {
        body: { action: 'request-closure', reason: closureReason },
      })
      if (error) throw error
      setClosureRequest(data.request as ClosureRequest)
      setShowClosure(false); setClosureConfirmation(''); setClosureReason('')
      setMsg({ type: 'ok', text: 'تم تسجيل طلب الإغلاق. يمكنك إلغاء الطلب خلال 30 يومًا.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: 'تعذر تسجيل طلب الإغلاق: ' + (e?.message || 'حاول مرة أخرى.') })
    }
    setClosureLoading(false)
  }

  async function cancelClosure() {
    setClosureLoading(true); setMsg(null)
    try {
      const { error } = await supabase.functions.invoke('account-lifecycle', { body: { action: 'cancel-closure' } })
      if (error) throw error
      setClosureRequest(null)
      setMsg({ type: 'ok', text: 'تم إلغاء طلب الإغلاق وسيبقى المتجر نشطًا.' })
    } catch (e: any) {
      setMsg({ type: 'err', text: 'تعذر إلغاء الطلب: ' + (e?.message || 'حاول مرة أخرى.') })
    }
    setClosureLoading(false)
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h2 style={S.title}>إعدادات المتجر</h2>
        <p style={S.sub}>حدّث هوية المتجر وبيانات التواصل وأمان الحساب.</p>
      </div>

      {msg && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13, fontWeight: 600,
          background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)',
          color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)',
          border: `1px solid ${msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'}`,
        }}>{msg.text}</div>
      )}

      <div style={S.identityCard}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5 }}>المتجر الحالي</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{merchant?.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{merchant?.email}</div>
        </div>
        <button type="button" onClick={copyMerchantCode} style={S.codeBtn} title="نسخ رمز المتجر">
          <span style={{ color: 'var(--text3)', fontSize: 10 }}>رمز المتجر</span>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>{merchant?.merchant_code}</strong>
        </button>
      </div>

      <div style={S.grid}>
      <div style={S.card}>
        <div style={S.cardTitle}>شعار المتجر</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={S.logoPreview}>
            {merchant?.logo_url
              ? <img src={merchant.logo_url} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14 }} />
              : <span style={{ fontSize: 28, fontWeight: 800 }}>{merchant?.name?.[0] || 'T'}</span>
            }
          </div>
          <div>
            <button style={S.uploadBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'جاري الرفع...' : 'اختيار شعار'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>PNG أو JPG أو WebP · الحد الأقصى 2MB</div>
            <input aria-label="اختيار شعار المتجر" ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadLogo} />
          </div>
        </div>
      </div>

      {/* Profile */}
      <div style={S.card}>
        <div style={S.cardTitle}>بيانات المتجر والتواصل</div>
        <div style={S.fieldGroup}>
          <label htmlFor="merchant-name" style={S.fieldLabel}>اسم المتجر</label>
          <input id="merchant-name" style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="اسم المتجر" />
        </div>
        <div style={S.fieldGroup}>
          <label htmlFor="merchant-phone" style={S.fieldLabel}>رقم واتساب للإشعارات</label>
          <input id="merchant-phone" style={S.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+966XXXXXXXXX" dir="ltr" />
        </div>
        <div style={S.fieldGroup}>
          <label htmlFor="merchant-email" style={S.fieldLabel}>البريد الإلكتروني</label>
          <input id="merchant-email" style={{ ...S.input, opacity: 0.6, cursor: 'not-allowed' }} value={merchant?.email || ''} disabled />
        </div>
        <button style={S.saveBtn} onClick={saveProfile} disabled={saving}>
          {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
        </button>
      </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>أمان الحساب</div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>كلمة المرور</div>
            <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6 }}>سنرسل رابطًا آمنًا إلى {merchant?.account_email || merchant?.email} لتعيين كلمة مرور جديدة.</div>
          </div>
          <button type="button" style={S.secondaryBtn} onClick={sendPasswordReset} disabled={resetting}>
            {resetting ? 'جاري الإرسال...' : 'إرسال رابط تغيير كلمة المرور'}
          </button>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>بيانات المتجر والخصوصية</div>
        <div style={S.actionRow}>
          <div style={S.actionLead}>
            <span style={S.actionIcon}><Download size={19} /></span>
            <div>
              <div style={S.actionTitle}>تنزيل نسخة من بيانات المتجر</div>
              <div style={S.actionSub}>ملف منظم يشمل المنتجات والطلبات والمخزون والتقارير ونتائج الاستيراد، دون مفاتيح الربط أو الأسرار.</div>
            </div>
          </div>
          {isOwner
            ? <button type="button" style={S.secondaryBtn} onClick={exportStoreData} disabled={exporting}>{exporting ? 'جاري التجهيز...' : 'تنزيل البيانات'}</button>
            : <span style={S.ownerOnly}>متاح لمالك المتجر فقط</span>}
        </div>
        <div style={S.legalLinks}>
          <ShieldCheck size={16} />
          <a href="/privacy">سياسة الخصوصية</a><span>·</span><a href="/terms">شروط الاستخدام</a>
        </div>
      </div>

      <div style={{ ...S.card, borderColor: 'rgba(220,38,38,.25)' }}>
        <div style={{ ...S.cardTitle, color: 'var(--red)' }}>إدارة إغلاق الحساب</div>
        {closureRequest ? (
          <div style={S.pendingClosure}>
            <div style={S.actionLead}>
              <span style={{ ...S.actionIcon, color: '#b45309', background: '#fff7ed' }}><CalendarClock size={19} /></span>
              <div>
                <div style={S.actionTitle}>طلب الإغلاق قيد الانتظار</div>
                <div style={S.actionSub}>سيُغلق الوصول إلى المتجر في {new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(new Date(closureRequest.scheduled_for))}. يمكنك إلغاء الطلب حتى ذلك الوقت.</div>
              </div>
            </div>
            <button type="button" style={S.secondaryBtn} onClick={cancelClosure} disabled={closureLoading}>{closureLoading ? 'جاري الإلغاء...' : 'إلغاء طلب الإغلاق'}</button>
          </div>
        ) : (
          <div style={S.actionRow}>
            <div>
              <div style={S.actionTitle}>إغلاق مساحة العمل</div>
              <div style={S.actionSub}>يبدأ الإغلاق بعد مهلة استرجاع مدتها 30 يومًا. يمكنك تنزيل بياناتك وإلغاء الطلب في أي وقت قبل الموعد.</div>
            </div>
            {isOwner
              ? <button type="button" style={S.dangerBtn} onClick={() => setShowClosure(true)}>طلب إغلاق الحساب</button>
              : <span style={S.ownerOnly}>متاح لمالك المتجر فقط</span>}
          </div>
        )}
      </div>

      {showClosure && (
        <div style={S.modalBackdrop} role="presentation" onMouseDown={e => e.target === e.currentTarget && setShowClosure(false)}>
          <div style={S.modal} role="dialog" aria-modal="true" aria-labelledby="closure-title">
            <button type="button" aria-label="إغلاق النافذة" style={S.modalClose} onClick={() => setShowClosure(false)}><X size={18} /></button>
            <span style={S.warningIcon}><AlertTriangle size={23} /></span>
            <h3 id="closure-title" style={S.modalTitle}>طلب إغلاق حساب المتجر</h3>
            <p style={S.modalText}>لن يتوقف حسابك الآن. تبدأ مهلة استرجاع لمدة 30 يومًا، وخلالها يمكنك إلغاء الطلب من هذه الصفحة. بعد الموعد يتوقف وصول المالك وجميع الموظفين.</p>
            <label style={S.fieldLabel} htmlFor="closure-reason">سبب الإغلاق (اختياري)</label>
            <textarea id="closure-reason" style={{ ...S.input, minHeight: 76, resize: 'vertical' }} value={closureReason} onChange={e => setClosureReason(e.target.value)} maxLength={1000} />
            <label style={{ ...S.fieldLabel, marginTop: 14 }} htmlFor="closure-confirmation">للتأكيد اكتب: إغلاق الحساب</label>
            <input id="closure-confirmation" style={S.input} value={closureConfirmation} onChange={e => setClosureConfirmation(e.target.value)} autoComplete="off" />
            <div style={S.modalActions}>
              <button type="button" style={S.secondaryBtn} onClick={() => setShowClosure(false)}>تراجع</button>
              <button type="button" style={{ ...S.dangerBtn, opacity: closureConfirmation === 'إغلاق الحساب' && !closureLoading ? 1 : .55 }} onClick={requestClosure} disabled={closureConfirmation !== 'إغلاق الحساب' || closureLoading}>{closureLoading ? 'جاري التسجيل...' : 'تأكيد طلب الإغلاق'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 'clamp(16px, 4vw, 32px)', maxWidth: 920, margin: '0 auto', minHeight: '100vh' },
  header: { marginBottom: 28 },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub: { fontSize: 13, color: 'var(--text2)', marginTop: 4 },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '20px 24px', marginBottom: 16,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 },
  identityCard: { background: 'linear-gradient(135deg,rgba(15,149,140,.10),rgba(15,149,140,.03))', border: '1px solid rgba(15,149,140,.22)', borderRadius: 16, padding: '18px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  codeBtn: { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 10, padding: '9px 13px', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', cursor: 'pointer', fontFamily: 'inherit' },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 18, color: 'var(--text)' },
  logoPreview: {
    width: 72, height: 72, borderRadius: 14, flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', overflow: 'hidden', border: '1px solid var(--border)',
  },
  uploadBtn: {
    background: 'var(--accent-strong)', color: '#fff', border: 'none',
    padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  input: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '11px 14px', color: 'var(--text)',
    fontSize: 14, width: '100%', outline: 'none', boxSizing: 'border-box',
  },
  saveBtn: {
    background: 'var(--accent2)', color: '#111', border: 'none',
    padding: '11px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginTop: 4,
  },
  secondaryBtn: { background: 'var(--surface2)', color: 'var(--accent)', border: '1px solid var(--border)', padding: '10px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  actionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' },
  actionLead: { display: 'flex', alignItems: 'flex-start', gap: 12, flex: '1 1 420px' },
  actionIcon: { width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--accent)', background: 'rgba(15,149,140,.09)' },
  actionTitle: { fontSize: 13.5, fontWeight: 800, marginBottom: 4 },
  actionSub: { fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.75, maxWidth: 610 },
  ownerOnly: { fontSize: 12, fontWeight: 700, color: 'var(--text3)', padding: '8px 11px', background: 'var(--surface2)', borderRadius: 8 },
  legalLinks: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 17, paddingTop: 14, borderTop: '1px solid var(--border)', color: 'var(--text3)', fontSize: 12.5 },
  pendingClosure: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.28)', borderRadius: 12, padding: 14 },
  dangerBtn: { background: '#b42318', color: '#fff', border: '1px solid #b42318', padding: '10px 16px', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.58)', display: 'grid', placeItems: 'center', padding: 18 },
  modal: { position: 'relative', width: '100%', maxWidth: 520, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, boxShadow: '0 30px 80px rgba(0,0,0,.28)', padding: 26 },
  modalClose: { position: 'absolute', left: 16, top: 16, width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', display: 'grid', placeItems: 'center', cursor: 'pointer' },
  warningIcon: { width: 46, height: 46, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#b42318', background: '#fff1f0', marginBottom: 14 },
  modalTitle: { fontFamily: 'var(--font-heading)', fontSize: 20, margin: '0 0 9px' },
  modalText: { fontSize: 13, color: 'var(--text2)', lineHeight: 1.8, marginBottom: 18 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 20 },
}
