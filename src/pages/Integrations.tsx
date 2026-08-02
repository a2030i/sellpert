import { lazy, Suspense, useState, useEffect } from 'react'
import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import MarketplaceConnections from './admin/MarketplaceConnections'

const SHOW_MANAGED_MARKETPLACES = false
const MERCHANT_FILE_IMPORT_ENABLED = false
const MerchantFileImport = lazy(() => import('./admin/ImportFilesView'))
const FILE_UPLOAD_PLATFORMS = [
  { key: 'amazon', label: 'Amazon', status: 'مدعوم' },
  { key: 'noon', label: 'Noon', status: 'مدعوم' },
  { key: 'salla', label: 'سلة', status: 'تُضاف التعريفات دوريًا' },
  { key: 'zid', label: 'زد', status: 'تُضاف التعريفات دوريًا' },
] as const

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
    setMsg('تمت جدولة المزامنة — ستظهر البيانات خلال دقيقة'); setSyncing(false)
    setTimeout(() => setMsg(''), 4000)
  }

  if (loading) return null

  return (
    <div style={{ background: isConnected ? 'linear-gradient(135deg,var(--success-bg),rgba(94,204,138,0.04))' : 'var(--surface)', border: `1px solid ${isConnected ? 'var(--success-bg)' : 'var(--border)'}`, borderRadius: 16, padding: '20px 24px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: isConnected ? 'linear-gradient(90deg,#5ecc8a,var(--green))' : 'var(--border2)', borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--success-bg)', border: '1px solid var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>🟢</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>سلة</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: isConnected ? 'var(--success-bg)' : 'var(--danger-bg)', color: isConnected ? 'var(--success-text)' : 'var(--danger-text)', border: `1px solid ${isConnected ? 'var(--success-bg)' : 'var(--danger-bg)'}` }}>
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
              {msg && <span style={{ fontSize: 12, color: 'var(--success-text)', fontWeight: 600 }}>{msg}</span>}
              <button onClick={requestSync} disabled={syncing} style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)', color: 'var(--success-text)', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: syncing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', animation: syncing ? 'spin 0.9s linear infinite' : 'none' }}>⟳</span>
                {syncing ? 'جارٍ المزامنة...' : 'مزامنة الآن'}
                <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
              </button>
            </div>
          : <a href="https://salla.sa/apps" target="_blank" rel="noopener noreferrer" style={{ background: 'linear-gradient(135deg,var(--green),#00d4a8)', border: 'none', color: '#fff', padding: '11px 22px', borderRadius: 12, fontSize: 13, fontWeight: 800, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              🟢 تثبيت التطبيق في سلة
            </a>
        }
      </div>
    </div>
  )
}

// ─── Managed Platform Status Card (Noon / Trendyol / Amazon) ─────────────────

// لون حسب عمر البيانات: أخضر ≤ يومين · أصفر ≤ أسبوع · أحمر أكثر
function freshTone(age: number) {
  if (age <= 2) return { bg: 'var(--success-bg)', fg: 'var(--success-text)', word: 'محدّثة' }
  if (age <= 7) return { bg: 'var(--warning-bg)', fg: 'var(--warning-text)', word: `متأخرة ${age} يوم` }
  return { bg: 'var(--danger-bg)', fg: 'var(--danger-text)', word: `متأخرة ${age} يوم` }
}
function fmtDataDate(d: string) {
  return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' })
}

function ManagedPlatformCard({ platform, lastUpload, fresh }: { merchant?: Merchant | null; platform: string; lastUpload?: { uploaded_at: string; detected_report: string } | null; fresh?: { last_data_date: string; age_days: number } | null }) {
  const color = PLATFORM_COLORS[platform] || '#0f958c'
  const label = PLATFORM_MAP[platform] || platform
  const emoji = ({ noon: '🟡', trendyol: '🟠', amazon: '📦' } as Record<string, string>)[platform] || '🛒'
  const isLinked = !!lastUpload
  const tone = fresh ? freshTone(fresh.age_days) : null

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${color}30`, borderRadius: 16, padding: '18px 22px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: color, borderRadius: '16px 16px 0 0', opacity: 0.7 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: color + '15', border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{emoji}</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
              {/* الشارة تعكس عمر البيانات الفعلي لا وقت الرفع — لا لون أخضر دائم يوهم بالتحديث */}
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                background: tone ? tone.bg : 'var(--surface2)',
                color: tone ? tone.fg : 'var(--text3)',
                border: `1px solid ${tone ? tone.bg : 'var(--border)'}` }}>
                {tone ? tone.word : (isLinked ? 'بانتظار المعالجة' : 'بانتظار التفعيل')}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {fresh
                ? <>بيانات حتى <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{fmtDataDate(fresh.last_data_date)}</span>{lastUpload && <span style={{ color: 'var(--text3)' }}> · آخر ملف {relativeTime(lastUpload.uploaded_at)}</span>}</>
                : isLinked
                  ? <>استُلم ملف {relativeTime(lastUpload!.uploaded_at)} — جارٍ استخراج البيانات</>
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
  const [fresh, setFresh] = useState<Record<string, { last_data_date: string; age_days: number }>>({})
  const [showFileUpload, setShowFileUpload] = useState(false)

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
    supabase.rpc('data_freshness', { p_merchant_code: merchant.merchant_code })
      .then(({ data }) => {
        const map: typeof fresh = {}
        for (const r of (data || []) as any[]) map[r.platform] = { last_data_date: r.last_data_date, age_days: r.age_days }
        setFresh(map)
      })
  }, [merchant?.merchant_code])

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>ربط المنصات</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>أدِر اتصالات منصات البيع وتابع حالة المزامنة من مكان واحد.</p>
      </div>

      {merchant ? (
        <MarketplaceConnections
          merchants={[merchant]}
          lockedMerchantCode={merchant.merchant_code}
          compactHeader
        />
      ) : null}

      {merchant ? <section style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <FileSpreadsheet size={20} color="var(--accent)" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>رفع ملفات المنصات</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.7 }}>استخدم ملفات Excel أو CSV الرسمية حتى يكتمل الربط المباشر. يتعرف النظام على التقرير تلقائيًا.</div>
            </div>
          </div>
          <button disabled={!MERCHANT_FILE_IMPORT_ENABLED} onClick={() => setShowFileUpload(value => !value)} style={{ background: showFileUpload ? 'var(--surface2)' : 'var(--accent-strong)', border: '1px solid var(--border)', color: showFileUpload ? 'var(--text)' : '#fff', padding: '9px 15px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: MERCHANT_FILE_IMPORT_ENABLED ? 'pointer' : 'not-allowed', opacity: MERCHANT_FILE_IMPORT_ENABLED ? 1 : .55, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {showFileUpload ? <X size={15} /> : <Upload size={15} />}
            {showFileUpload ? 'إغلاق' : MERCHANT_FILE_IMPORT_ENABLED ? 'رفع ملفات الآن' : 'قريبًا'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 8, marginTop: 16 }}>
          {FILE_UPLOAD_PLATFORMS.map(item => <div key={item.key} style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{item.label}</div>
            <div style={{ fontSize: 10, color: item.status === 'مدعوم' ? 'var(--success-text)' : 'var(--text3)', marginTop: 3 }}>{item.status}</div>
          </div>)}
        </div>
        {MERCHANT_FILE_IMPORT_ENABLED && showFileUpload ? <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <Suspense fallback={<div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>جاري تجهيز أداة رفع الملفات...</div>}>
            <MerchantFileImport merchants={[merchant]} lockedMerchantCode={merchant.merchant_code} merchantMode allowedPlatforms={['amazon', 'noon', 'salla', 'zid']} />
          </Suspense>
        </div> : null}
      </section> : null}

      {SHOW_MANAGED_MARKETPLACES && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>منصات مُدارة</div>
        <ManagedPlatformCard merchant={merchant} platform="noon"     lastUpload={uploads.noon}     fresh={fresh.noon} />
        <ManagedPlatformCard merchant={merchant} platform="trendyol" lastUpload={uploads.trendyol} fresh={fresh.trendyol} />
        <ManagedPlatformCard merchant={merchant} platform="amazon"   lastUpload={uploads.amazon}   fresh={fresh.amazon} />
      </div>}

      <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(15,149,140,0.05)', border: '1px solid rgba(15,149,140,0.15)' }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          <b>المزامنة المباشرة:</b> عند ربط Trendyol تُسحب الطلبات والمنتجات والمخزون والمرتجعات والتسويات تلقائيًا، ويمكنك تشغيل المزامنة ومتابعة نتيجتها من بطاقة الاتصال.
        </div>
      </div>
    </div>
  )
}
