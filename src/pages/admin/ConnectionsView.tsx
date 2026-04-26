import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import type { Merchant, PlatformConnection } from '../../lib/supabase'

export default function ConnectionsView({ merchants, onRefresh }: { merchants: Merchant[]; onRefresh: () => void }) {
  const [loading, setLoading] = useState(true)

  const [waConn, setWaConn]         = useState<PlatformConnection | null>(null)
  const [waChannels, setWaChannels] = useState<any[]>([])
  const [waTemplates, setWaTemplates] = useState<any[]>([])
  const [waLoading, setWaLoading]   = useState(false)
  const [waForm, setWaForm]         = useState({ label: 'Respondly', api_key: '', base_url: '' })
  const [waSaving, setWaSaving]     = useState(false)
  const [waEditKey, setWaEditKey]   = useState(false)
  const [waQr, setWaQr]             = useState<{ instance_name: string; qr_code: string | null; status: string; loading: boolean } | null>(null)
  const waQrPollRef                 = useRef<ReturnType<typeof setInterval> | null>(null)
  const [waEvents, setWaEvents]     = useState<Record<string, { enabled: boolean; template: string | null }>>({
    sync_complete: { enabled: true,  template: null },
    low_stock:     { enabled: false, template: null },
    new_order:     { enabled: true,  template: null },
    ai_ready:      { enabled: false, template: null },
    daily_report:  { enabled: false, template: null },
  })

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: found } = await supabase.from('platform_connections').select('*').eq('platform', 'respondly').limit(1).maybeSingle()
    setWaConn(found || null)
    if (found?.extra?.events) setWaEvents(found.extra.events)
    setLoading(false)
    // Auto-load channels if already connected
    if (found) setTimeout(() => loadWaInfoWith(found), 100)
  }

  async function loadWaInfoWith(conn: any) {
    setWaLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: conn.id }),
      })
      const data = await res.json()
      if (data.ok) { setWaChannels(data.channels || []); setWaTemplates(data.templates || []) }
      else setMsg({ type: 'err', text: data.error || 'فشل الاتصال بـ Respondly' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setWaLoading(false)
  }

  async function saveWaConnection() {
    if (!waForm.api_key.trim()) { setMsg({ type: 'err', text: 'API Key مطلوب' }); return }
    setWaSaving(true)
    const extra: Record<string, any> = {}
    if (waForm.base_url.trim()) extra.base_url = waForm.base_url.trim()
    extra.events = waEvents

    if (waConn) {
      const { error } = await supabase.from('platform_connections').update({ api_key: waForm.api_key.trim(), label: waForm.label || 'Respondly', extra }).eq('id', waConn.id)
      setWaSaving(false)
      if (error) { setMsg({ type: 'err', text: error.message }); return }
    } else {
      const { data: inserted, error } = await supabase.from('platform_connections').insert({ platform: 'respondly', label: waForm.label || 'Respondly', api_key: waForm.api_key.trim(), is_active: true, extra }).select().maybeSingle()
      setWaSaving(false)
      if (error) { setMsg({ type: 'err', text: error.message }); return }
      setWaConn(inserted)
    }
    setWaEditKey(false)
    setMsg({ type: 'ok', text: '✓ تم حفظ إعدادات Respondly' })
    await loadData()
    loadWaInfo()
  }

  async function loadWaInfo() {
    const conn = waConn || (await supabase.from('platform_connections').select('*').eq('platform', 'respondly').eq('is_active', true).limit(1).maybeSingle()).data
    if (!conn) return
    setWaLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: conn.id }),
      })
      const data = await res.json()
      if (data.ok) { setWaChannels(data.channels || []); setWaTemplates(data.templates || []) }
      else setMsg({ type: 'err', text: data.error || 'فشل الاتصال بـ Respondly' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setWaLoading(false)
  }

  async function saveWaDefaultChannel(channelId: string) {
    if (!waConn) return
    const extra = { ...(waConn.extra || {}), channel_id: channelId }
    const { error } = await supabase.from('platform_connections').update({ extra }).eq('id', waConn.id)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: '✓ تم تحديد القناة الافتراضية' })
    loadData()
  }

  async function saveWaEvents() {
    if (!waConn) return
    const extra = { ...(waConn.extra || {}), events: waEvents }
    const { error } = await supabase.from('platform_connections').update({ extra }).eq('id', waConn.id)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: '✓ تم حفظ إعدادات الأحداث' })
    loadData()
  }

  async function waCall(action: string, extra: Record<string, any> = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: waConn?.id, action, ...extra }),
    })
    return res.json()
  }

  async function startQrConnect() {
    if (!waConn) return
    setWaQr({ instance_name: '', qr_code: null, status: 'creating', loading: true })
    const data = await waCall('create_instance')
    if (data.error) {
      setWaQr(null)
      const isPermission = data.error.includes('صلاحية') || data.error.includes('403')
      setMsg({ type: 'err', text: isPermission ? '⛔ الـ API Token لا يملك صلاحية whatsapp — تأكد من تفعيل صلاحية "whatsapp" في لوحة Respondly' : `خطأ: ${data.error}` })
      return
    }
    const instName = data.instance_name
    let qrCode = data.qr_code || null
    if (!qrCode && instName) {
      const qrData = await waCall('get_qr', { instance_name: instName })
      qrCode = qrData.qr_code || null
    }
    setWaQr({ instance_name: instName, qr_code: qrCode, status: 'waiting', loading: false })
    startQrPolling(instName)
  }

  function startQrPolling(instName: string) {
    if (waQrPollRef.current) clearInterval(waQrPollRef.current)
    waQrPollRef.current = setInterval(async () => {
      const statusData = await waCall('status')
      const ch = (statusData.channels || []).find((c: any) => c.evolution_instance_name === instName)
      if (ch?.live_status === 'open' || ch?.is_connected) {
        clearInterval(waQrPollRef.current!)
        waQrPollRef.current = null
        setWaQr(null)
        setMsg({ type: 'ok', text: '✅ تم ربط الرقم بنجاح!' })
        loadWaInfo()
        return
      }
      const qrData = await waCall('get_qr', { instance_name: instName })
      if (qrData.qr_code) setWaQr(prev => prev ? { ...prev, qr_code: qrData.qr_code, status: 'waiting' } : null)
    }, 4000)
  }

  async function deleteChannel(instName: string) {
    const data = await waCall('delete_instance', { instance_name: instName })
    if (data.error) { setMsg({ type: 'err', text: data.error }); return }
    setMsg({ type: 'ok', text: '✓ تم حذف الرقم' })
    loadWaInfo()
  }

  useEffect(() => () => { if (waQrPollRef.current) clearInterval(waQrPollRef.current) }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>⟳ جاري التحميل...</div>

  return (
    <div>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {msg.text}
          <button style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginRight: 10 }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* WHATSAPP */}
      {(
        <div>
          {(!waConn || waEditKey) ? (
            <div style={{ ...S.formCard, borderColor: '#25D366' }}>
              <div style={{ ...S.formTitle, color: '#25D366' }}>📱 ربط Respondly واتساب</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={S.label}>اسم مرجعي</label>
                  <input style={S.input} value={waForm.label} onChange={e => setWaForm({ ...waForm, label: e.target.value })} placeholder="Respondly" />
                </div>
                <div>
                  <label style={S.label}>API Key *</label>
                  <input style={{ ...S.input, fontFamily: 'monospace', fontSize: 12 }} type="password" value={waForm.api_key} onChange={e => setWaForm({ ...waForm, api_key: e.target.value })} placeholder="rsp_live_xxxxxxxxxxxx" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={S.saveBtn} onClick={saveWaConnection} disabled={waSaving}>{waSaving ? '⟳ جاري الحفظ...' : '✓ حفظ وربط'}</button>
                {waEditKey && <button style={S.miniBtn} onClick={() => setWaEditKey(false)}>إلغاء</button>}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--surface2)', border: '1.5px solid #25D36633', marginBottom: 20 }}>
              <span style={{ fontSize: 20 }}>🟢</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Respondly مربوط</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'monospace' }}>{waConn.api_key?.slice(0, 12)}••••••••</div>
              </div>
              <button style={S.miniBtn} onClick={() => { setWaForm({ label: waConn.label, api_key: '', base_url: waConn.extra?.base_url || '' }); setWaEditKey(true) }}>✏️ تعديل</button>
              <button style={{ ...S.miniBtn, color: '#25D366', borderColor: '#25D366' }} onClick={loadWaInfo} disabled={waLoading}>{waLoading ? '⟳' : '🔄 تحديث'}</button>
            </div>
          )}

          {waConn && !waEditKey && (
            <>
              {waLoading && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>⟳ جاري جلب البيانات من Respondly...</div>}
              {!waLoading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                  <div style={S.tableCard}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>📱 القنوات</span>
                      <button style={{ ...S.miniBtn, background: '#25D366', color: '#fff', borderColor: '#25D366', fontSize: 12 }} onClick={startQrConnect} disabled={!!waQr}>{waQr ? '⟳ جاري...' : '➕ ربط رقم جديد'}</button>
                    </div>
                    {waQr && (
                      <div style={{ padding: 20, borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                        {waQr.loading || waQr.status === 'creating' ? (
                          <div style={{ color: 'var(--text3)', fontSize: 13 }}>⟳ جاري إنشاء الجلسة...</div>
                        ) : waQr.qr_code ? (
                          <>
                            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>امسح QR بتطبيق واتساب</div>
                            <img src={waQr.qr_code.startsWith('data:') ? waQr.qr_code : `data:image/png;base64,${waQr.qr_code}`} alt="WhatsApp QR" style={{ width: 200, height: 200, borderRadius: 12, border: '2px solid #25D366' }} />
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>واتساب ← النقاط الثلاث ← الأجهزة المرتبطة ← ربط جهاز</div>
                          </>
                        ) : (
                          <div style={{ color: 'var(--text3)', fontSize: 13 }}>⟳ جاري تحديث QR...</div>
                        )}
                        <button style={{ ...S.miniBtn, marginTop: 12, color: 'var(--red)' }} onClick={() => { if (waQrPollRef.current) clearInterval(waQrPollRef.current); setWaQr(null) }}>إلغاء</button>
                      </div>
                    )}
                    {waChannels.length === 0 && !waQr ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>لا توجد قنوات بعد</div>
                    ) : waChannels.map((ch: any) => {
                      const isDefault = waConn.extra?.channel_id === ch.id
                      const isConnected = ch.is_connected || ch.live_status === 'open'
                      return (
                        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: isDefault ? '#25D36608' : 'transparent' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? '#25D366' : 'var(--text3)', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{ch.display_phone || ch.business_name || ch.evolution_instance_name || ch.id}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{isConnected ? 'متصل' : 'غير متصل'}</div>
                          </div>
                          <button style={{ ...S.miniBtn, ...(isDefault ? { background: '#25D366', color: '#fff', borderColor: '#25D366' } : {}), fontSize: 11 }} onClick={() => saveWaDefaultChannel(ch.id)}>{isDefault ? '✓ افتراضي' : 'اختر'}</button>
                          {ch.evolution_instance_name && <button style={{ ...S.miniBtn, color: 'var(--red)', fontSize: 11 }} onClick={() => deleteChannel(ch.evolution_instance_name)}>🗑</button>}
                        </div>
                      )
                    })}
                  </div>
                  <div style={S.tableCard}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>📋 القوالب</div>
                    {waTemplates.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>لا توجد قوالب — الإرسال كرسائل نصية</div> : (
                      <div style={{ maxHeight: 280, overflowY: 'auto' as const }}>
                        {waTemplates.map((t: any, i: number) => (
                          <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.language} — {t.status}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={S.tableCard}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>⚡ الأحداث والإشعارات</div>
                <table style={S.table}>
                  <thead><tr>{['الحدث', 'التوضيح', 'مفعّل', 'القالب'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {([
                      ['sync_complete', 'مزامنة ناجحة',     'بعد كل مزامنة'          ],
                      ['low_stock',     'مخزون منخفض',       'عند انخفاض المخزون'     ],
                      ['new_order',     'طلب جديد',          'عند وصول طلب'           ],
                      ['ai_ready',      'تحليل ذكي جاهز',    'بعد اكتمال التحليل'     ],
                      ['daily_report',  'تقرير يومي',        'تقرير يومي تلقائي'      ],
                    ] as const).map(([key, label, desc]) => (
                      <tr key={key} style={S.tr}>
                        <td style={{ ...S.td, fontWeight: 700 }}>{label}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{desc}</td>
                        <td style={S.td}>
                          <div style={{ width: 40, height: 22, borderRadius: 11, background: waEvents[key]?.enabled ? '#25D366' : 'var(--surface3)', cursor: 'pointer', position: 'relative' as const, transition: 'background 0.2s' }}
                            onClick={() => setWaEvents(prev => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key]?.enabled } }))}>
                            <div style={{ position: 'absolute' as const, top: 3, left: waEvents[key]?.enabled ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                          </div>
                        </td>
                        <td style={S.td}>
                          <select style={{ ...S.input, fontSize: 11, padding: '4px 8px', width: 180 }} value={waEvents[key]?.template || ''} onChange={e => setWaEvents(prev => ({ ...prev, [key]: { ...prev[key], template: e.target.value || null } }))}>
                            <option value="">رسالة نصية</option>
                            {waTemplates.map((t: any) => <option key={t.name} value={t.name}>{t.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '12px 16px' }}>
                  <button style={S.saveBtn} onClick={saveWaEvents}>✓ حفظ إعدادات الأحداث</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}

