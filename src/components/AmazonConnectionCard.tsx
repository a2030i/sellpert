import { useCallback, useEffect, useRef, useState } from 'react'
import SellingAccountChooser from './SellingAccountChooser'
import { ExternalLink, Unplug } from 'lucide-react'
import {
  AMAZON_MARKETPLACE_NAMES,
  callAmazonConnect,
  readAmazonCallback,
  type AmazonConnectionStatus,
} from '../lib/amazonConnection'

const AMAZON_COLOR = '#ff9900'

type Notice = { type: 'ok' | 'err'; text: string } | null

export default function AmazonConnectionCard({ merchantCode, onStatusChange }: {
  merchantCode: string
  onStatusChange?: (merchantCode: string, status: AmazonConnectionStatus | null) => void
}) {
  const [accountId, setAccountId] = useState('')
  const [status, setStatus] = useState<AmazonConnectionStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<'start' | 'complete' | 'disconnect' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const completionStarted = useRef(false)

  const load = useCallback(async () => {
    setLoadError('')
    onStatusChange?.(merchantCode, null)
    try {
      const nextStatus = await callAmazonConnect({ action: 'status', merchant_code: merchantCode })
      setStatus(nextStatus)
      onStatusChange?.(merchantCode, nextStatus)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'تعذر تحميل حالة ربط أمازون')
    }
  }, [merchantCode, onStatusChange])

  // Amazon redirects the seller back to /integrations/amazon/callback.
  useEffect(() => {
    const callback = readAmazonCallback(window.location.pathname, window.location.search)
    if (!callback) { void load(); return }
    // Remove Amazon's one-time parameters from the address bar and history.
    window.history.replaceState(null, '', '/integrations')
    if (callback === 'incomplete') {
      setNotice({ type: 'err', text: 'لم يكتمل الربط من جهة أمازون. ابدأ الربط من جديد.' })
      void load()
      return
    }
    if (completionStarted.current) return
    completionStarted.current = true
    setBusy('complete')
    callAmazonConnect({ action: 'complete', merchant_code: merchantCode, ...callback })
      .then(() => setNotice({ type: 'ok', text: 'تم ربط حساب أمازون بنجاح.' }))
      .catch(error => setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر إكمال ربط أمازون' }))
      .finally(() => { setBusy(null); void load() })
  }, [load, merchantCode])

  async function start() {
    setBusy('start'); setNotice(null)
    try {
      const result = await callAmazonConnect({ action: 'start', merchant_code: merchantCode, marketplace_account_id: accountId })
      if (typeof result?.consent_url !== 'string' || !result.consent_url.startsWith('https://sellercentral.amazon.')) {
        throw new Error('تعذر تجهيز رابط الربط')
      }
      window.location.assign(result.consent_url)
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر بدء ربط أمازون' })
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm('إلغاء ربط حساب أمازون من سيلبرت؟ يمكنك أيضًا إلغاء الإذن من حسابك في أمازون: الإعدادات ← إدارة التطبيقات.')) return
    setBusy('disconnect'); setNotice(null)
    try {
      await callAmazonConnect({ action: 'disconnect', merchant_code: merchantCode, marketplace_account_id: accountId })
      setNotice({ type: 'ok', text: 'تم إلغاء ربط أمازون.' })
      await load()
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر إلغاء الربط' })
    } finally { setBusy(null) }
  }

  const connection = status?.connections?.find(row => row.marketplace_account_id === accountId) || null
  const connected = Boolean(connection?.is_active)
  const markets = (connection?.marketplaces || []).map(m => AMAZON_MARKETPLACE_NAMES[m.country] || m.name || m.country).join('، ')

  return <article aria-busy={busy !== null || (!status && !loadError)} style={{ maxWidth: 'var(--integration-card-max-width, 760px)', marginTop: 'var(--integration-section-gap, 16px)', background: 'var(--surface)', border: `1px solid ${connected ? `${AMAZON_COLOR}66` : 'var(--border)'}`, borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
    <div style={{ height: 3, background: connected ? AMAZON_COLOR : 'var(--border2)' }} />
    <div style={{ padding: 18 }}>
      <div className="amazon-connection-header">
        <div className="amazon-connection-logo" aria-hidden style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: `${AMAZON_COLOR}18`, color: '#b36b00', fontWeight: 900 }}>A</div>
        <div className="amazon-connection-copy">
          <strong>Amazon</strong>
          <div style={{ color: 'var(--text2)', fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>
            ربط مباشر بسوق أمازون السعودية بالريال السعودي. تُحدَّث الطلبات والمعاملات المالية تلقائيًا كل ٣٠ دقيقة تقريبًا. يُسحب سجل آخر ١٢ شهرًا بدءًا من الأحدث، وقد يستغرق السحب الأول عدة ساعات. الأسواق الأخرى غير مشمولة حاليًا.
          </div>
        </div>
        <span className="amazon-connection-status" style={{ borderRadius: 20, padding: '3px 9px', fontSize: 10, fontWeight: 800, background: connected ? `${AMAZON_COLOR}24` : 'var(--surface2)', color: connected ? '#8a5200' : 'var(--text2)', whiteSpace: 'nowrap' }}>
          {busy === 'complete' ? 'جارٍ الربط…' : loadError ? 'تعذر التحقق' : !status ? 'جارٍ التحقق…' : connected ? 'متصل' : 'غير مربوط'}
        </span>
      </div>

      <SellingAccountChooser merchantCode={merchantCode} platform="amazon" disabled={Boolean(busy)} value={accountId} onChange={account => { setAccountId(account?.id || ''); setNotice(null) }} allowCreate={Boolean(status?.app_configured) && !busy} />
      {connected && connection ? <dl style={{ margin: '14px 0 0', fontSize: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
        <dt style={{ color: 'var(--text2)' }}>معرّف البائع</dt><dd style={{ margin: 0 }} className="latin-number">{connection.seller_id}</dd>
        <dt style={{ color: 'var(--text2)' }}>الأسواق</dt><dd style={{ margin: 0 }}>{markets || '—'}</dd>
        <dt style={{ color: 'var(--text2)' }}>تاريخ الربط</dt><dd style={{ margin: 0 }}>{formatDate(connection.connected_at)}</dd>
        <dt style={{ color: 'var(--text2)' }}>آخر مزامنة</dt><dd style={{ margin: 0 }}>{connection.last_sync_at ? formatDate(connection.last_sync_at) : 'بانتظار أول مزامنة'}</dd>
      </dl> : null}

      {loadError ? <div style={{ marginTop: 12 }}><p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger-text)' }}>{loadError}</p><button type="button" onClick={() => void load()} disabled={busy !== null} style={{ ...dangerButton(busy !== null), marginTop: 8, color: 'var(--text)', borderColor: 'var(--border)' }}>إعادة التحقق من الربط</button></div> : null}
      {status && !status.app_configured && !connected ? <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text2)' }}>الربط المباشر مع أمازون قيد التجهيز وسيتاح قريبًا.</p> : null}
      {notice ? <p role={notice.type === 'err' ? 'alert' : 'status'} style={{ margin: '12px 0 0', fontSize: 12, fontWeight: 700, color: notice.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>{notice.text}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {!connected && status?.app_configured ? <button type="button" onClick={start} disabled={busy !== null || !accountId} style={primaryButton(busy !== null)}>
          <ExternalLink size={15} /> {busy === 'start' ? 'جارٍ التحويل إلى أمازون…' : 'ربط حساب أمازون'}
        </button> : null}
        {connected ? <button type="button" onClick={disconnect} disabled={busy !== null} style={dangerButton(busy !== null)}>
          <Unplug size={15} /> {busy === 'disconnect' ? 'جارٍ الإلغاء…' : 'إلغاء الربط'}
        </button> : null}
      </div>
    </div>
  </article>
}

function primaryButton(disabled: boolean) {
  return { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--accent-strong)', color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 } as const
}

function dangerButton(disabled: boolean) {
  return { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: '1px solid var(--danger-bg)', background: 'var(--surface)', color: 'var(--danger-text)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 } as const
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
