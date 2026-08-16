import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { CheckCircle2, CloudCog, Database, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

type TrialConnection = {
  platform: 'amazon'
  mode: 'shadow' | 'live'
  status: 'pending' | 'active' | 'error' | 'disabled'
  is_enabled: boolean
  token_configured: boolean
  last_sync_at: string | null
  last_error: string | null
  records_seen: number
  records_matched: number
  records_new: number
  excel_files_preserved: number
}

export default function OmnifulAmazonTrialCard({ merchantCode }: { merchantCode: string }) {
  const [connection, setConnection] = useState<TrialConnection | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await callOmniful({ action: 'status', merchant_code: merchantCode })
      setConnection(result.connection || null)
      setAvailable(Boolean(result.available))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('غير مفعلة') || message.includes('404')) setAvailable(false)
      else setNotice(message || 'تعذر قراءة حالة تجربة Omniful')
    }
  }, [merchantCode])

  useEffect(() => { void load() }, [load])

  async function sync() {
    setBusy(true)
    setNotice('')
    try {
      const result = await callOmniful({ action: 'sync', merchant_code: merchantCode })
      setNotice(`تمت المقارنة: ${formatNumber(result.matched_excel)} مطابق مع Excel و${formatNumber(result.new_shadow)} جديد للمراجعة.`)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر تشغيل تجربة Omniful')
    } finally {
      setBusy(false)
    }
  }

  if (available === false || (available === null && !notice)) return null
  if (!connection) return notice ? <div style={styles.error}>{notice}</div> : null

  const ready = connection.token_configured && connection.status !== 'disabled'
  return <article style={styles.card}>
    <div style={styles.topLine} />
    <div style={styles.body}>
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.logo}><CloudCog size={22} /></div>
          <div>
            <div style={styles.title}>Amazon عبر Omniful</div>
            <div style={styles.subtitle}>تجربة موازية آمنة لعطارة شمول</div>
          </div>
        </div>
        <div style={styles.badges}>
          <span style={styles.shadowBadge}>Shadow</span>
          <span style={styles.excelBadge}><ShieldCheck size={12} /> Excel مستمر</span>
        </div>
      </div>

      <div style={styles.safetyBox}>
        <Database size={18} color="var(--accent)" />
        <div>
          <strong>لا تغيير على بيانات Amazon الحالية</strong>
          <span>Omniful يقارن أرقام الطلبات فقط، ولا يكتب فوق ملفات Excel ولا يضاعف المبيعات.</span>
        </div>
      </div>

      <div style={styles.metrics}>
        <Metric label="ملفات Excel محفوظة" value={connection.excel_files_preserved} />
        <Metric label="طلبات Omniful" value={connection.records_seen} />
        <Metric label="متطابقة مع Excel" value={connection.records_matched} />
        <Metric label="جديدة للمراجعة" value={connection.records_new} />
      </div>

      {connection.last_error ? <div style={styles.error}>{connection.last_error}</div> : null}
      {notice ? <div style={notice.startsWith('تمت') ? styles.success : styles.error}>{notice}</div> : null}

      <div style={styles.footer}>
        <div style={styles.statusText}>
          {connection.last_sync_at
            ? <><CheckCircle2 size={15} color="var(--success-text)" /> آخر مقارنة {formatDate(connection.last_sync_at)}</>
            : ready ? 'جاهز لأول مقارنة' : 'بانتظار إكمال إعداد Omniful المركزي'}
        </div>
        <button type="button" onClick={() => void sync()} disabled={busy || !ready} style={{ ...styles.button, opacity: busy || !ready ? 0.55 : 1 }}>
          {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          {busy ? 'جاري جلب Amazon…' : 'تشغيل مقارنة تجريبية'}
        </button>
      </div>
    </div>
  </article>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div style={styles.metric}><span>{label}</span><strong>{formatNumber(value)}</strong></div>
}

async function callOmniful(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-omniful-amazon`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.access_token || ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}

function formatNumber(value: unknown) { return Number(value || 0).toLocaleString('en-US') }
function formatDate(value: string) {
  return new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' })
}

const styles: Record<string, CSSProperties> = {
  card: { maxWidth: 760, marginTop: 14, background: 'var(--surface)', border: '1px solid rgba(255,153,0,.35)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' },
  topLine: { height: 3, background: 'linear-gradient(90deg,#ff9900,#192a3e)' },
  body: { padding: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  titleGroup: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'rgba(255,153,0,.12)', color: '#c87300' },
  title: { fontSize: 15, fontWeight: 850, color: 'var(--text)' },
  subtitle: { marginTop: 3, fontSize: 11, color: 'var(--text3)' },
  badges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  shadowBadge: { borderRadius: 20, padding: '4px 9px', fontSize: 10, fontWeight: 800, background: 'rgba(25,42,62,.09)', color: 'var(--text2)' },
  excelBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 20, padding: '4px 9px', fontSize: 10, fontWeight: 800, background: 'var(--success-bg)', color: 'var(--success-text)' },
  safetyBox: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, padding: 12, borderRadius: 11, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, lineHeight: 1.7 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginTop: 12 },
  metric: { padding: '10px 11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--text3)', fontSize: 10 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 14 },
  statusText: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)' },
  button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 14px', border: 0, borderRadius: 9, background: '#192a3e', color: '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' },
  success: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 11 },
  error: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 11 },
}
