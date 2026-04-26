import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'

export default function Settings({ merchant, onUpdate }: { merchant: Merchant | null; onUpdate: (m: Merchant) => void }) {
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [name, setName] = useState(merchant?.name || '')
  const [phone, setPhone] = useState(merchant?.whatsapp_phone || '')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setMsg({ type: 'err', text: 'الحجم الأقصى 2MB' }); return }
    if (!file.type.startsWith('image/')) { setMsg({ type: 'err', text: 'يجب أن يكون الملف صورة' }); return }

    setUploading(true); setMsg(null)
    try {
      const ext  = file.name.split('.').pop()
      const path = `logos/${merchant!.merchant_code}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('merchant-assets')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from('merchant-assets').getPublicUrl(path)
      const { data: updated, error: dbErr } = await supabase
        .from('merchants').update({ logo_url: publicUrl }).eq('id', merchant!.id).select().maybeSingle()
      if (dbErr) throw dbErr

      onUpdate(updated as Merchant)
      setMsg({ type: 'ok', text: '✅ تم رفع اللوغو بنجاح' })
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message })
    }
    setUploading(false)
  }

  async function saveProfile() {
    if (!name.trim()) { setMsg({ type: 'err', text: 'الاسم مطلوب' }); return }
    setSaving(true); setMsg(null)
    try {
      const { data: updated, error } = await supabase
        .from('merchants')
        .update({ name: name.trim(), whatsapp_phone: phone.trim() || null })
        .eq('id', merchant!.id)
        .select().maybeSingle()
      if (error) throw error
      onUpdate(updated as Merchant)
      setMsg({ type: 'ok', text: '✅ تم حفظ البيانات' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setSaving(false)
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h2 style={S.title}>الإعدادات</h2>
        <p style={S.sub}>بيانات الحساب والمظهر</p>
      </div>

      {msg && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: 13, fontWeight: 600,
          background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)',
          color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}`,
        }}>{msg.text}</div>
      )}

      {/* Logo */}
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
              {uploading ? '⟳ جاري الرفع...' : '📷 رفع صورة'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>PNG أو JPG · الحد الأقصى 2MB</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadLogo} />
          </div>
        </div>
      </div>

      {/* Profile */}
      <div style={S.card}>
        <div style={S.cardTitle}>بيانات الحساب</div>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>الاسم</label>
          <input style={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="اسم المتجر" />
        </div>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>رقم واتساب (للإشعارات)</label>
          <input style={S.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+966XXXXXXXXX" dir="ltr" />
        </div>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>البريد الإلكتروني</label>
          <input style={{ ...S.input, opacity: 0.6, cursor: 'not-allowed' }} value={merchant?.email || ''} disabled />
        </div>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>كود التاجر</label>
          <input style={{ ...S.input, opacity: 0.6, cursor: 'not-allowed', fontFamily: 'monospace' }} value={merchant?.merchant_code || ''} disabled />
        </div>
        <button style={S.saveBtn} onClick={saveProfile} disabled={saving}>
          {saving ? '⟳ جاري الحفظ...' : '✓ حفظ التغييرات'}
        </button>
      </div>

      {/* Plan */}
      <div style={S.card}>
        <div style={S.cardTitle}>الخطة الحالية</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{
            padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 700,
            background: merchant?.subscription_plan === 'elite' ? 'rgba(255,209,102,0.15)' :
                        merchant?.subscription_plan === 'pro'   ? 'rgba(124,107,255,0.15)' : 'var(--surface2)',
            color: merchant?.subscription_plan === 'elite' ? '#ffd166' :
                   merchant?.subscription_plan === 'pro'   ? 'var(--accent)' : 'var(--text2)',
            border: `1px solid ${merchant?.subscription_plan === 'elite' ? 'rgba(255,209,102,0.3)' :
                                  merchant?.subscription_plan === 'pro'   ? 'rgba(124,107,255,0.3)' : 'var(--border)'}`,
          }}>
            {merchant?.subscription_plan === 'elite' ? '👑 Elite' :
             merchant?.subscription_plan === 'pro'   ? '⭐ Pro'   : '🆓 Free'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            {merchant?.subscription_plan === 'free' ? 'للترقية تواصل مع الفريق' : 'خطتك النشطة'}
          </span>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '32px', maxWidth: 600, margin: '0 auto', minHeight: '100vh' },
  header: { marginBottom: 28 },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub: { fontSize: 13, color: 'var(--text2)', marginTop: 4 },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: '20px 24px', marginBottom: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 18, color: 'var(--text)' },
  logoPreview: {
    width: 72, height: 72, borderRadius: 14, flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', overflow: 'hidden', border: '1px solid var(--border)',
  },
  uploadBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none',
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
}

