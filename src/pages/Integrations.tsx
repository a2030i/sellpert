import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'

// ─── Salla Card ───────────────────────────────────────────────────────────────

function SallaCard({ merchant }: { merchant: Merchant | null }) {
  const [conn, setConn] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const isConnected = !!merchant?.salla_store_id

  useEffect(() => {
    if (!merchant?.merchant_code) { setLoading(false); return }
    supabase.from('salla_connections').select('*').eq('merchant_code', merchant.merchant_code).maybeSingle()
      .then(({ data }) => { setConn(data); setLoading(false) })
  }, [merchant?.merchant_code])

  async function requestSync() {
    if (!merchant) return; setSyncing(true)
    await supabase.from('sync_queue').insert({ merchant_code: merchant.merchant_code, platform: 'salla', job_type: 'sync_all', priority: 1, status: 'pending', scheduled_at: new Date().toISOString() })
    setMsg('✅ تم جدولة المزامنة — ستظهر البيانات خلال دقيقة'); setSyncing(false)
    setTimeout(() => setMsg(''), 4000)
  }

  if (loading) return null

  return (
    <div style={{ background: isConnected ? 'linear-gradient(135deg,rgba(0,184,148,0.06),rgba(94,204,138,0.04))' : 'var(--surface)', border: `1px solid ${isConnected ? 'rgba(0,184,148,0.25)' : 'var(--border)'}`, borderRadius: 16, padding: '20px 24px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: isConnected ? 'linear-gradient(90deg,#5ecc8a,#00b894)' : 'var(--border2)', borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>🟢</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>سلة</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: isConnected ? 'rgba(0,184,148,0.1)' : 'rgba(232,64,64,0.08)', color: isConnected ? '#00b894' : '#e84040', border: `1px solid ${isConnected ? 'rgba(0,184,148,0.25)' : 'rgba(232,64,64,0.15)'}` }}>
                {isConnected ? '✓ متصل' : 'غير مربوط'}
              </span>
            </div>
            {isConnected && conn
              ? <div style={{ fontSize: 12, color: 'var(--text2)' }}><span style={{ fontWeight: 600 }}>{conn.store_name}</span>{conn.store_domain && <span style={{ color: 'var(--text3)', marginRight: 6 }}>· {conn.store_domain}</span>}</div>
              : <div style={{ fontSize: 12, color: 'var(--text3)' }}>ثبّت تطبيق Sellpert من متجر تطبيقات سلة</div>
            }
          </div>
        </div>
        {isConnected
          ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {msg && <span style={{ fontSize: 12, color: '#00b894', fontWeight: 600 }}>{msg}</span>}
              <button onClick={requestSync} disabled={syncing} style={{ background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.25)', color: '#00b894', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>
                {syncing ? '⟳ جارٍ...' : '⟳ مزامنة الآن'}
              </button>
            </div>
          : <a href="https://salla.sa/apps" target="_blank" rel="noopener noreferrer" style={{ background: 'linear-gradient(135deg,#00b894,#00d4a8)', border: 'none', color: '#fff', padding: '11px 22px', borderRadius: 12, fontSize: 13, fontWeight: 800, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              🟢 تثبيت التطبيق في سلة
            </a>
        }
      </div>
    </div>
  )
}

// ─── Managed Platform Status Card (Noon / Trendyol / Amazon) ─────────────────

function ManagedPlatformCard({ merchant, platform, lastUpload }: { merchant: Merchant | null; platform: string; lastUpload?: { uploaded_at: string; detected_report: string } | null }) {
  const color = PLATFORM_COLORS[platform] || '#7c6bff'
  const label = PLATFORM_MAP[platform] || platform
  const emoji = ({ noon: '🟡', trendyol: '🟠', amazon: '📦' } as Record<string, string>)[platform] || '🛒'
  const isLinked = !!lastUpload

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${color}30`, borderRadius: 16, padding: '18px 22px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: color, borderRadius: '16px 16px 0 0', opacity: 0.7 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: color + '15', border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{emoji}</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                background: isLinked ? 'rgba(0,184,148,0.1)' : 'var(--surface2)',
                color: isLinked ? '#00b894' : 'var(--text3)',
                border: `1px solid ${isLinked ? 'rgba(0,184,148,0.25)' : 'var(--border)'}` }}>
                {isLinked ? '✓ يتم تحديثه' : 'بانتظار التفعيل'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {isLinked
                ? <>آخر تحديث: <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{relativeTime(lastUpload!.uploaded_at)}</span> · {lastUpload!.detected_report}</>
                : 'فريق Sellpert يستلم تقاريرك ويحدّث بياناتك يدوياً'
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `منذ ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${Math.floor(h / 24)} يوم`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Integrations({ merchant }: { merchant: Merchant | null }) {
  const [uploads, setUploads] = useState<Record<string, { uploaded_at: string; detected_report: string }>>({})

  useEffect(() => {
    if (!merchant?.merchant_code) return
    supabase.from('platform_file_uploads')
      .select('platform, uploaded_at, detected_report')
      .eq('merchant_code', merchant.merchant_code)
      .order('uploaded_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return
        const map: typeof uploads = {}
        for (const r of data) {
          if (!map[r.platform]) map[r.platform] = { uploaded_at: r.uploaded_at, detected_report: r.detected_report || '' }
        }
        setUploads(map)
      })
  }, [merchant?.merchant_code])

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>ربط المنصات</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>سلة بربط مباشر — باقي المنصات يستلم فريق Sellpert تقاريرها ويحدّث بياناتك تلقائياً</p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>ربط مباشر</div>
        <SallaCard merchant={merchant} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>منصات مُدارة</div>
        <ManagedPlatformCard merchant={merchant} platform="noon"     lastUpload={uploads.noon} />
        <ManagedPlatformCard merchant={merchant} platform="trendyol" lastUpload={uploads.trendyol} />
        <ManagedPlatformCard merchant={merchant} platform="amazon"   lastUpload={uploads.amazon} />
      </div>

      <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(124,107,255,0.05)', border: '1px solid rgba(124,107,255,0.15)' }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          💡 <b>كيف يعمل التحديث؟</b> أرسل تقارير المنصات الرسمية إلى فريق Sellpert (واتساب أو البريد) ويتم استيرادها واستخراج الطلبات والمنتجات والإعلانات والتسويات تلقائياً ضمن لوحتك.
        </div>
      </div>
    </div>
  )
}
