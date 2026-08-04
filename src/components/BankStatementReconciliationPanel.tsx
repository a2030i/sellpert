import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Landmark, Loader2, Upload, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import { importArchiveContentType, importArchivePath } from '../lib/importArchive'
import { parseBankStatementFile, type ParsedBankStatement } from '../lib/bankStatement'
import {
  bankReconciliationSummary,
  reconcileBankReceipts,
  type BankMatchStatus,
  type BankTransaction,
  type ConfirmedBankMatch,
} from '../lib/bankReconciliation'
import { reconcileSettlements, type SettlementTransaction } from '../lib/settlementReconciliation'
import { PLATFORM_MAP } from '../lib/constants'

const STATUS: Record<BankMatchStatus, { label:string; detail:string; color:string; bg:string }> = {
  confirmed: { label:'مؤكد من فريقك', detail:'ربط فريقك هذه الحركة البنكية بالتسوية واعتمدها.', color:'var(--success-text)', bg:'var(--success-bg)' },
  reference_match: { label:'وصل ومطابق', detail:'المبلغ ومرجع التسوية متطابقان في كشف البنك.', color:'var(--success-text)', bg:'var(--success-bg)' },
  suggested: { label:'مطابقة محتملة', detail:'المبلغ والتاريخ متوافقان، لكن المرجع غير واضح. راجع ثم أكد.', color:'var(--warning-text)', bg:'var(--warning-bg)' },
  ambiguous: { label:'تحتاج مراجعة', detail:'توجد أكثر من حركة بنكية بالمبلغ نفسه خلال فترة التحويل.', color:'var(--danger-text)', bg:'var(--danger-bg)' },
  missing: { label:'لم يظهر في البنك', detail:'سجلت المنصة التحويل، ولم نجد له حركة مطابقة في الكشف المرفوع.', color:'var(--danger-text)', bg:'var(--danger-bg)' },
  awaiting_provider: { label:'بانتظار تحويل المنصة', detail:'لم تسجل المنصة تحويلًا لهذه التسوية بعد.', color:'var(--warning-text)', bg:'var(--warning-bg)' },
}

function money(value:number, currency='SAR') {
  return new Intl.NumberFormat('ar-SA-u-nu-latn', { style:'currency', currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(value)
}

function date(value:string | null | undefined) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day:'numeric', month:'short', year:'numeric' }) : '—'
}

async function fingerprint(file: File) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

type Notice = { type:'success'|'error'|'info'; text:string }

export default function BankStatementReconciliationPanel({ merchantCode, transactions, year, month }: {
  merchantCode:string
  transactions:SettlementTransaction[]
  year:number
  month:number
}) {
  const isMobile = useMobile()
  const inputRef = useRef<HTMLInputElement>(null)
  const [bankRows, setBankRows] = useState<BankTransaction[]>([])
  const [confirmed, setConfirmed] = useState<ConfirmedBankMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParsedBankStatement | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const db = supabase as any

  const start = useMemo(() => {
    const d = new Date(Date.UTC(year, month - 1, 1)); d.setUTCDate(d.getUTCDate() - 7)
    return d.toISOString().slice(0, 10)
  }, [year, month])
  const end = useMemo(() => {
    const d = new Date(Date.UTC(year, month, 0)); d.setUTCDate(d.getUTCDate() + 21)
    return d.toISOString().slice(0, 10)
  }, [year, month])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: rows, error: rowsError }, { data: matches, error: matchesError }] = await Promise.all([
      db.from('bank_transactions').select('id,transaction_date,value_date,description,reference,debit,credit,net_amount,currency')
        .eq('merchant_code', merchantCode).gte('transaction_date', start).lte('transaction_date', end)
        .order('transaction_date', { ascending:false }).limit(2500),
      db.from('settlement_bank_matches').select('id,bank_transaction_id,platform,settlement_id,expected_amount,confirmed_at')
        .eq('merchant_code', merchantCode).order('confirmed_at', { ascending:false }).limit(1000),
    ])
    if (rowsError || matchesError) setNotice({ type:'error', text:'تعذر تحميل المطابقة البنكية. أعد المحاولة.' })
    setBankRows((rows || []) as BankTransaction[])
    setConfirmed((matches || []) as ConfirmedBankMatch[])
    setLoading(false)
  }, [db, merchantCode, start, end])

  useEffect(() => { void load() }, [load])

  const settlements = useMemo(() => reconcileSettlements(transactions).groups, [transactions])
  const results = useMemo(() => reconcileBankReceipts(settlements, bankRows, confirmed), [settlements, bankRows, confirmed])
  const summary = useMemo(() => bankReconciliationSummary(results, bankRows), [results, bankRows])

  async function selectFile(selected: File | undefined) {
    if (!selected) return
    setNotice(null); setFile(null); setPreview(null)
    try {
      const parsed = await parseBankStatementFile(selected)
      setFile(selected); setPreview(parsed)
    } catch (error) {
      setNotice({ type:'error', text:error instanceof Error ? error.message : 'تعذر قراءة كشف البنك.' })
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function importStatement() {
    if (!file || !preview || saving) return
    setSaving(true); setNotice(null)
    let uploadId = ''
    let storagePath = ''
    try {
      const fileFingerprint = await fingerprint(file)
      const { data: duplicate } = await db.from('platform_file_uploads').select('id,uploaded_at,rows_inserted')
        .eq('merchant_code', merchantCode).eq('fingerprint', fileFingerprint).eq('file_type', 'bank_statement')
        .eq('status', 'success').order('uploaded_at', { ascending:false }).limit(1).maybeSingle()
      if (duplicate) {
        setNotice({ type:'info', text:`هذا الكشف مستورد مسبقًا (${Number(duplicate.rows_inserted || 0).toLocaleString('ar-SA-u-nu-latn')} حركة). لم نكرر البيانات.` })
        setFile(null); setPreview(null); if (inputRef.current) inputRef.current.value = ''
        await load(); return
      }

      const { data: { user } } = await supabase.auth.getUser()
      const { data: audit, error: auditError } = await db.from('platform_file_uploads').insert({
        merchant_code:merchantCode, platform:'bank', file_name:file.name, file_type:'bank_statement',
        file_size:file.size, uploaded_by:user?.email || user?.id || null, status:'processing',
        detected_report:'كشف حساب بنكي', fingerprint:fileFingerprint,
      }).select('id').single()
      if (auditError || !audit?.id) throw new Error('تعذر إنشاء سجل خاص لكشف البنك.')
      uploadId = audit.id
      storagePath = importArchivePath(merchantCode, uploadId, file.name)
      const { error: archiveError } = await supabase.storage.from('merchant-imports').upload(storagePath, file, {
        upsert:false, contentType:importArchiveContentType(file.name),
      })
      if (archiveError) throw new Error('تعذر حفظ نسخة المصدر الخاصة؛ لم نستورد أي حركة.')
      const { error: pathError } = await db.from('platform_file_uploads').update({ storage_path:storagePath }).eq('id', uploadId)
      if (pathError) throw new Error('تعذر ربط ملف المصدر بسجل الاستيراد.')
      const { data, error } = await db.rpc('commit_my_bank_statement', { p_upload_id:uploadId, p_rows:preview.rows })
      if (error) throw new Error(error.message || 'تعذر استيراد كشف البنك.')
      setNotice({ type:'success', text:`تم استيراد ${Number(data?.inserted || preview.rows.length).toLocaleString('ar-SA-u-nu-latn')} حركة وإعادة المطابقة.` })
      setFile(null); setPreview(null); if (inputRef.current) inputRef.current.value = ''
      await load()
    } catch (error) {
      if (uploadId) await db.from('platform_file_uploads').update({ status:'failed', error_message:error instanceof Error ? error.message.slice(0, 1000) : 'فشل الاستيراد', finished_at:new Date().toISOString() }).eq('id', uploadId)
      if (storagePath) await supabase.storage.from('merchant-imports').remove([storagePath])
      setNotice({ type:'error', text:error instanceof Error ? error.message : 'تعذر استيراد كشف البنك.' })
    } finally {
      setSaving(false)
    }
  }

  async function confirmSuggestion(resultIndex:number) {
    const result = results[resultIndex]
    if (!result?.bankTransaction) return
    setConfirming(result.settlement.reference); setNotice(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await db.from('settlement_bank_matches').insert({
      merchant_code:merchantCode,
      bank_transaction_id:result.bankTransaction.id,
      platform:result.settlement.platform,
      settlement_id:result.settlement.reference,
      expected_amount:result.settlement.transferRecorded,
      confirmed_by:user?.id,
    })
    if (error) setNotice({ type:'error', text:'تعذر اعتماد المطابقة. قد تكون الحركة مرتبطة بتسوية أخرى.' })
    else { setNotice({ type:'success', text:'تم اعتماد وصول التحويل وربطه بالتسوية.' }); await load() }
    setConfirming('')
  }

  async function removeConfirmation(matchId:string, reference:string) {
    setConfirming(reference); setNotice(null)
    const { error } = await db.from('settlement_bank_matches').delete().eq('id', matchId).eq('merchant_code', merchantCode)
    if (error) setNotice({ type:'error', text:'تعذر إلغاء الاعتماد.' })
    else { setNotice({ type:'success', text:'ألغيت المطابقة اليدوية ويمكن مراجعتها من جديد.' }); await load() }
    setConfirming('')
  }

  return <section aria-label="المطابقة مع كشف البنك" style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, marginBottom:20, overflow:'hidden' }}>
    <div style={{ padding:isMobile ? 14 : '16px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>
      <div style={{ maxWidth:700 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}><Landmark size={18} aria-hidden="true"/><h3 style={{ margin:0, fontSize:15, fontWeight:850 }}>التأكد من وصول التحويلات للبنك</h3></div>
        <p style={{ margin:'5px 0 0', color:'var(--text3)', fontSize:11, lineHeight:1.7 }}>ارفع كشف الحساب الصادر من البنك. نحفظه داخل مساحة متجرك الخاصة، ونقارن الحركات الدائنة بتحويلات المنصات دون حفظ رقم الحساب كاملًا.</p>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm" hidden onChange={event => void selectFile(event.target.files?.[0])}/>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={saving} style={buttonStyle}>
        <Upload size={14} aria-hidden="true"/> رفع كشف البنك
      </button>
    </div>

    {notice ? <div role="status" style={{ margin:'12px 14px 0', padding:'10px 12px', borderRadius:9, fontSize:11, fontWeight:700,
      background:notice.type === 'error' ? 'var(--danger-bg)' : notice.type === 'success' ? 'var(--success-bg)' : 'var(--info-bg)',
      color:notice.type === 'error' ? 'var(--danger-text)' : notice.type === 'success' ? 'var(--success-text)' : 'var(--text2)' }}>{notice.text}</div> : null}

    {preview && file ? <div style={{ margin:'12px 14px 0', border:'1px solid var(--border)', borderRadius:10, padding:12, background:'var(--surface2)' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:9 }}><FileSpreadsheet size={20} color="var(--accent)" aria-hidden="true"/><div>
          <div style={{ fontSize:12, fontWeight:800 }}>{file.name}</div>
          <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>{preview.rows.length.toLocaleString('ar-SA-u-nu-latn')} حركة · {date(preview.periodStart)} — {date(preview.periodEnd)}</div>
          <div style={{ fontSize:10, color:'var(--text2)', marginTop:3 }}>إيداعات {money(preview.totalCredits)} · سحوبات {money(preview.totalDebits)}</div>
          {preview.warnings.map(warning => <div key={warning} style={{ color:'var(--warning-text)', fontSize:9, marginTop:3 }}>{warning}</div>)}
        </div></div>
        <div style={{ display:'flex', gap:7 }}>
          <button type="button" onClick={() => { setFile(null); setPreview(null); if (inputRef.current) inputRef.current.value = '' }} disabled={saving} style={{ ...buttonStyle, background:'var(--surface)' }}><XCircle size={14}/> إلغاء</button>
          <button type="button" onClick={() => void importStatement()} disabled={saving} style={{ ...buttonStyle, background:'var(--accent)', color:'#fff', borderColor:'var(--accent)' }}>
            {saving ? <Loader2 size={14} className="spin-icon"/> : <CheckCircle2 size={14}/>} {saving ? 'جارٍ الاستيراد…' : 'استيراد ومطابقة'}
          </button>
        </div>
      </div>
    </div> : null}

    {loading ? <div style={{ padding:30, textAlign:'center', color:'var(--text3)', fontSize:11 }}><Loader2 size={18} className="spin-icon"/> جارٍ فحص الحركات البنكية…</div> : bankRows.length === 0 ? <div style={{ padding:'24px 16px', textAlign:'center' }}>
      <div style={{ fontSize:13, fontWeight:800 }}>لم يُرفع كشف بنك لهذه الفترة</div>
      <div style={{ color:'var(--text3)', fontSize:10, lineHeight:1.7, marginTop:4 }}>تبقى تحويلات المنصة «مسجلة لدى المنصة» وليست مؤكدة الوصول حتى ترفع كشف البنك.</div>
    </div> : <>
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4,1fr)', borderTop:'1px solid var(--border)', borderBottom:'1px solid var(--border)', marginTop:12 }}>
        {[
          ['وصل ومؤكد',summary.confirmed,'مرجع ومبلغ مطابقان أو اعتماد فريقك'],
          ['بانتظار تأكيدك',summary.suggested,'مبلغ وتاريخ متوافقان'],
          ['تحتاج مراجعة',summary.needsReview,'تحويل مفقود أو أكثر من احتمال'],
          ['إيداعات غير مرتبطة',summary.unmatchedCredits,'قد تكون من مصادر أخرى'],
        ].map(([label,value,detail], index) => <div key={String(label)} style={{ padding:'13px 15px', borderLeft:!isMobile && index < 3 ? '1px solid var(--border)' : undefined, borderBottom:isMobile && index < 2 ? '1px solid var(--border)' : undefined }}>
          <div style={{ fontSize:9, color:'var(--text3)' }}>{label}</div><div style={{ fontSize:18, fontWeight:850, marginTop:3 }}>{String(value)}</div><div style={{ fontSize:9, color:'var(--text3)', marginTop:2 }}>{detail}</div>
        </div>)}
      </div>
      <div style={{ padding:isMobile ? 10 : '12px 14px', display:'grid', gap:8 }}>
        {results.slice(0, 20).map((result, index) => {
          const meta = STATUS[result.status]
          return <div key={`${result.settlement.platform}:${result.settlement.reference}`} style={{ border:'1px solid var(--border)', borderRadius:10, padding:'11px 12px', background:'var(--surface2)', display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(160px,1.2fr) repeat(3,minmax(110px,.8fr)) auto', gap:10, alignItems:'center' }}>
            <div><div style={{ fontSize:11, fontWeight:800 }}>{PLATFORM_MAP[result.settlement.platform] || result.settlement.platform} · تسوية {result.settlement.reference}</div><div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{meta.detail}</div></div>
            <div><div style={labelStyle}>تحويل المنصة</div><div style={valueStyle}>{money(result.settlement.transferRecorded)}</div></div>
            <div><div style={labelStyle}>الحركة البنكية</div><div style={valueStyle}>{result.bankTransaction ? money(Number(result.bankTransaction.credit || result.bankTransaction.net_amount || 0), result.bankTransaction.currency || 'SAR') : '—'}</div></div>
            <div><div style={labelStyle}>تاريخ الوصول</div><div style={valueStyle}>{date(result.bankTransaction?.value_date || result.bankTransaction?.transaction_date)}</div></div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:isMobile ? 'flex-start' : 'flex-end', gap:6 }}>
              <span style={{ padding:'4px 9px', borderRadius:20, background:meta.bg, color:meta.color, fontSize:9, fontWeight:800 }}>{meta.label}</span>
              {result.status === 'suggested' ? <button type="button" disabled={confirming === result.settlement.reference} onClick={() => void confirmSuggestion(index)} style={smallButton}>تأكيد المطابقة</button> : null}
              {result.status === 'confirmed' && result.manualMatchId ? <button type="button" disabled={confirming === result.settlement.reference} onClick={() => void removeConfirmation(result.manualMatchId!, result.settlement.reference)} style={smallButton}>إلغاء الاعتماد</button> : null}
            </div>
          </div>
        })}
      </div>
    </>}
    <style>{`.spin-icon{animation:spin .8s linear infinite}`}</style>
  </section>
}

const buttonStyle = { display:'inline-flex', alignItems:'center', gap:6, border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', color:'var(--text2)', padding:'8px 11px', fontSize:10, fontWeight:800, fontFamily:'inherit', cursor:'pointer' } as const
const smallButton = { ...buttonStyle, padding:'5px 8px', fontSize:9, background:'var(--surface)' } as const
const labelStyle = { fontSize:9, color:'var(--text3)', marginBottom:3 } as const
const valueStyle = { fontSize:11, color:'var(--text)', fontWeight:800, fontFamily:'var(--font-data)' } as const
