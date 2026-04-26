import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import { useMobile } from '../../lib/hooks'
import type { Merchant, AiInsight } from '../../lib/supabase'

export default function AiView({ merchants }: { merchants: Merchant[] }) {
  const isMobile = useMobile()

  const [savedKey, setSavedKey]   = useState('')
  const [keyInput, setKeyInput]   = useState('')
  const [editKey, setEditKey]     = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [keyMsg, setKeyMsg]       = useState('')
  const [keyErr, setKeyErr]       = useState('')

  const [selMode, setSelMode]   = useState<'all' | 'multi' | 'one'>('one')
  const [selOne, setSelOne]     = useState('')
  const [selMulti, setSelMulti] = useState<string[]>([])

  const [analyzing, setAnalyzing]     = useState(false)
  const [analysisErr, setAnalysisErr] = useState('')
  const [results, setResults]         = useState<{ merchant_code: string; insight: AiInsight }[]>([])
  const [activeIdx, setActiveIdx]     = useState(0)
  const [history, setHistory]         = useState<AiInsight[]>([])

  useEffect(() => {
    loadKey()
    if (merchants.length > 0) setSelOne(merchants[0].merchant_code)
  }, [merchants])

  useEffect(() => {
    const codes = getSelectedCodes()
    if (codes.length === 1) loadHistory(codes[0])
    else setHistory([])
  }, [selMode, selOne, selMulti])

  async function loadKey() {
    const { data } = await supabase.from('platform_connections').select('api_key').eq('platform', 'openrouter').eq('is_active', true).maybeSingle()
    if (data?.api_key) setSavedKey(data.api_key)
  }

  async function saveKey() {
    if (!keyInput.trim()) return
    setSavingKey(true); setKeyMsg(''); setKeyErr('')
    const { data: ex } = await supabase.from('platform_connections').select('id').eq('platform', 'openrouter').maybeSingle()
    if (ex) {
      const { error } = await supabase.from('platform_connections').update({ api_key: keyInput.trim(), is_active: true }).eq('id', ex.id)
      if (error) { setKeyErr(error.message); setSavingKey(false); return }
    } else {
      const { error } = await supabase.from('platform_connections').insert({ platform: 'openrouter', label: 'OpenRouter AI', api_key: keyInput.trim(), is_active: true })
      if (error) { setKeyErr(error.message); setSavingKey(false); return }
    }
    setSavedKey(keyInput.trim())
    setKeyInput('')
    setEditKey(false)
    setSavingKey(false)
    setKeyMsg('تم حفظ المفتاح')
    setTimeout(() => setKeyMsg(''), 3000)
  }

  function getSelectedCodes(): string[] {
    if (selMode === 'all') return merchants.map(m => m.merchant_code)
    if (selMode === 'multi') return selMulti
    return selOne ? [selOne] : []
  }

  async function loadHistory(code: string) {
    const { data } = await supabase.from('ai_insights').select('*').eq('merchant_code', code).order('created_at', { ascending: false }).limit(8)
    setHistory(data || [])
    if (data && data.length > 0 && results.length === 0) {
      setResults([{ merchant_code: code, insight: data[0] }])
    }
  }

  async function runAnalysis() {
    const codes = getSelectedCodes()
    if (!codes.length) return
    setAnalyzing(true); setAnalysisErr(''); setResults([])
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-merchant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_codes: codes, mode: 'analysis' }),
      })
      const j = await res.json()
      if (!res.ok || j.error) { setAnalysisErr(j.error || 'خطأ'); return }
      if (j.insight) {
        setResults([{ merchant_code: codes[0], insight: j.insight }])
      } else if (j.results) {
        setResults(j.results.filter((r: any) => r.insight).map((r: any) => ({ merchant_code: r.merchant_code || codes[0], insight: r.insight })))
      }
      setActiveIdx(0)
      if (codes.length === 1) loadHistory(codes[0])
    } catch (e: any) { setAnalysisErr(e.message) }
    finally { setAnalyzing(false) }
  }

  const activeInsight = results[activeIdx]?.insight
  const c = activeInsight?.content as any

  return (
    <div>
      <div style={{ ...S.chartCard, marginBottom: 20, padding: '16px 20px', borderRight: savedKey ? '3px solid var(--accent2)' : '3px solid #ffd166' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{savedKey ? '🔒' : '🔑'}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>مفتاح OpenRouter</div>
              {savedKey ? <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 2 }}>✓ محفوظ · {savedKey.slice(0, 10)}••••••••</div>
                : <div style={{ fontSize: 11, color: '#ffd166', marginTop: 2 }}>غير مضبوط — أدخل مفتاحك من openrouter.ai</div>}
            </div>
          </div>
          <button style={{ ...S.miniBtn, background: savedKey ? 'transparent' : 'rgba(255,209,102,0.15)', borderColor: savedKey ? 'var(--border)' : '#ffd166', color: savedKey ? 'var(--text2)' : '#ffd166' }} onClick={() => { setEditKey(v => !v); setKeyErr('') }}>
            {editKey ? 'إلغاء' : savedKey ? '✏️ تعديل' : '+ إضافة'}
          </button>
        </div>
        {editKey && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <input style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} type="password" placeholder="sk-or-v1-..." value={keyInput} onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveKey()} />
            <button style={{ ...S.btn, padding: '8px 18px' }} onClick={saveKey} disabled={savingKey || !keyInput.trim()}>{savingKey ? '...' : 'حفظ'}</button>
          </div>
        )}
        {keyErr && <div style={{ fontSize: 12, color: '#ff4d6d', marginTop: 8 }}>✗ {keyErr}</div>}
        {keyMsg && <div style={{ fontSize: 12, color: 'var(--accent2)', marginTop: 8 }}>✓ {keyMsg}</div>}
      </div>

      <div style={{ ...S.chartCard, marginBottom: 20, padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 12 }}>اختر التجار للتحليل</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['all', 'multi', 'one'] as const).map(m => (
            <button key={m} onClick={() => setSelMode(m)} style={{ border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: selMode === m ? 'var(--accent)' : 'var(--surface2)', color: selMode === m ? '#fff' : 'var(--text2)' }}>
              {m === 'all' ? `الكل (${merchants.length})` : m === 'multi' ? 'متعدد' : 'تاجر واحد'}
            </button>
          ))}
        </div>
        {selMode === 'one' && (
          <select style={{ ...S.filterSelect, minWidth: 240 }} value={selOne} onChange={e => setSelOne(e.target.value)}>
            {merchants.map(m => <option key={m.id} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>)}
          </select>
        )}
        {selMode === 'multi' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {merchants.map(m => {
              const checked = selMulti.includes(m.merchant_code)
              return (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`, background: checked ? 'rgba(124,107,255,0.12)' : 'var(--surface2)', cursor: 'pointer', fontSize: 12, fontWeight: checked ? 700 : 400, color: checked ? 'var(--accent)' : 'var(--text2)' }}>
                  <input type="checkbox" checked={checked} onChange={() => setSelMulti(prev => checked ? prev.filter(c => c !== m.merchant_code) : [...prev, m.merchant_code])} style={{ display: 'none' }} />
                  {m.name}
                </label>
              )
            })}
          </div>
        )}
        {selMode === 'all' && <div style={{ fontSize: 12, color: 'var(--text3)' }}>سيتم تحليل جميع التجار ({merchants.length} تاجر)</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={{ background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(124,107,255,0.35)', opacity: (analyzing || getSelectedCodes().length === 0) ? 0.6 : 1 }} onClick={runAnalysis} disabled={analyzing || getSelectedCodes().length === 0}>
          {analyzing ? '⟳ جاري التحليل...' : '✨ تشغيل تحليل AI'}
        </button>
        {activeInsight && <span style={{ fontSize: 11, color: 'var(--text3)' }}>آخر تحليل: {new Date(activeInsight.created_at).toLocaleString('ar-SA')}</span>}
      </div>

      {analysisErr && <div style={{ ...S.msgBox, ...S.msgErr, marginBottom: 16 }}>{analysisErr}</div>}

      {results.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {results.map((r, i) => {
            const name = merchants.find(m => m.merchant_code === r.merchant_code)?.name || r.merchant_code
            return (
              <button key={i} onClick={() => setActiveIdx(i)} style={{ border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: activeIdx === i ? 'var(--accent)' : 'var(--surface2)', color: activeIdx === i ? '#fff' : 'var(--text2)' }}>{name}</button>
            )
          })}
        </div>
      )}

      {!activeInsight && !analyzing && (
        <div style={{ ...S.chartCard, padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>لا يوجد تحليل بعد</div>
          <div style={{ fontSize: 12 }}>اختر التجار واضغط "تشغيل تحليل AI"</div>
        </div>
      )}

      {activeInsight && c && (
        <div>
          {c.summary && (
            <div style={{ ...S.chartCard, marginBottom: 16, borderRight: '3px solid var(--accent)', padding: '18px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>ملخص — {merchants.find(m => m.merchant_code === results[activeIdx]?.merchant_code)?.name}</div>
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>{c.summary}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px,1fr))', gap: 14, marginBottom: 16 }}>
            {c.forecast_next_week && (
              <div style={{ ...S.chartCard, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 10 }}>🔮 توقع الأسبوع القادم</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--accent)' }}>{c.forecast_next_week.amount?.toLocaleString()} ر.س</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>ثقة: <strong style={{ color: 'var(--text)' }}>{c.forecast_next_week.confidence}</strong></div>
              </div>
            )}
            {c.best_days?.length > 0 && (
              <div style={{ ...S.chartCard, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 10 }}>📅 أفضل أيام البيع</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {c.best_days.map((d: string, i: number) => <span key={i} style={{ background: 'rgba(0,229,176,0.15)', color: 'var(--accent2)', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>{d}</span>)}
                </div>
              </div>
            )}
            {c.low_stock_alert?.length > 0 && (
              <div style={{ ...S.chartCard, padding: 20, borderRight: '3px solid #ff4d6d' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#ff4d6d', marginBottom: 10 }}>🚨 تحذير مخزون</div>
                {c.low_stock_alert.map((p: string, i: number) => <div key={i} style={{ fontSize: 13, color: '#ff4d6d', marginBottom: 5 }}>• {p}</div>)}
              </div>
            )}
          </div>
          {c.recommendations?.length > 0 && (
            <div style={{ ...S.chartCard, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 14 }}>💡 التوصيات</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {c.recommendations.map((r: string, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 8, background: 'rgba(124,107,255,0.2)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, lineHeight: 1.6 }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 1 && (
        <div style={{ ...S.tableCard, marginTop: 20 }}>
          <div style={S.tableHeader}><div style={S.chartTitle}>📋 سجل التحليلات</div></div>
          <table style={S.table}>
            <thead><tr>{['التاريخ', 'ملخص مختصر', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} style={{ ...S.tr, cursor: 'pointer' }} onClick={() => { setResults([{ merchant_code: selOne, insight: h }]); setActiveIdx(0) }}>
                  <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(h.created_at).toLocaleString('ar-SA')}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(h.content as any).summary?.slice(0, 80) || '—'}</td>
                  <td style={S.td}><span style={{ fontSize: 11, color: activeInsight?.id === h.id ? 'var(--accent)' : 'var(--text3)' }}>{activeInsight?.id === h.id ? '● محدد' : 'عرض'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
