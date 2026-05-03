import { useState, useMemo, useEffect } from 'react'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { parsePlatformFile, type ParseResult } from '../../lib/platformParsers'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Loader2, ArrowRight, Save, Archive, Info, Link2 } from 'lucide-react'

// ─── File guides per platform ────────────────────────────────────────────────
type Importance = 'critical' | 'recommended' | 'optional'
interface FileGuide {
  kind: string
  label: string
  icon: string
  desc: string
  importance: Importance
  dependsOn?: string
  dependsNote?: string
}

const FILE_GUIDES: Record<string, FileGuide[]> = {
  noon: [
    { kind: 'noon_sales',    label: 'تقرير المبيعات',         icon: '💰', desc: 'كل الطلبات المشحونة والمسلّمة — يحدّث جدول الطلبات والإيرادات', importance: 'critical' },
    { kind: 'noon_products', label: 'تقرير الأصناف Live',     icon: '📦', desc: 'كاتالوج المنتجات + الأسعار + المخزون FBN/Xdock', importance: 'critical' },
    { kind: 'noon_asn',      label: 'إرسالية للمستودع (ASN)', icon: '🚚', desc: 'ما أرسلته إلى مستودع نون قبل استلامه', importance: 'recommended' },
    { kind: 'noon_grn',      label: 'تقرير الاستلام (GRN)',   icon: '📥', desc: 'ما استلمه نون فعلياً + الأصناف المرفوضة من الجودة', importance: 'recommended', dependsOn: 'noon_asn', dependsNote: 'يُفضّل رفع ASN قبله ليربط بياناته' },
    { kind: 'noon_ads',      label: 'تقرير الإعلانات',         icon: '📣', desc: 'أداء حملات الإعلانات (Campaign × SKU × Query)', importance: 'optional' },
  ],
  trendyol: [
    { kind: 'trendyol_sales',     label: 'مبيعات حسب المنتج (Sales by Product)', icon: '💰', desc: 'لقطة دورية للمنتجات + أسباب الإلغاءات والمرتجعات', importance: 'critical' },
    { kind: 'trendyol_products',  label: 'الكاتالوج (Products)',                  icon: '📦', desc: 'تفاصيل المنتجات + الصور + الأوصاف + المخزون', importance: 'critical' },
    { kind: 'trendyol_statement', label: 'كشف الحساب (Account Statement)',        icon: '🧾', desc: 'حركة الحساب: عمولات + مدفوعات + خصومات', importance: 'recommended' },
    { kind: 'trendyol_ads',       label: 'تقرير إعلانات المنتج',                   icon: '📣', desc: 'أداء الحملات الإعلانية على تراندايول', importance: 'optional' },
    { kind: 'trendyol_deals',     label: 'عروض Super/Mega Deal',                  icon: '🎯', desc: 'فرص الأسعار التنافسية المقترحة من تراندايول', importance: 'optional' },
  ],
  amazon: [
    { kind: 'amazon_transactions', label: 'تقرير المعاملات',          icon: '💰', desc: 'الطلبات والرسوم وصافي المبالغ', importance: 'critical' },
    { kind: 'amazon_inventory',    label: 'مخزون FBA',                icon: '📦', desc: 'المخزون المتاح في مستودعات أمازون لكل ASIN', importance: 'critical' },
    { kind: 'amazon_settlement',   label: 'تقرير التسوية (Settlement)', icon: '🧾', desc: 'تسويات الدفعات الدورية وتفصيل الرسوم', importance: 'recommended' },
    { kind: 'amazon_ads',          label: 'إعلانات Sponsored Products', icon: '📣', desc: 'أداء حملات Sponsored Products على مستوى الـ Ad Group', importance: 'optional' },
  ],
}

const IMPORTANCE_META: Record<Importance, { label: string; color: string }> = {
  critical:    { label: 'أساسي',    color: '#e84040' },
  recommended: { label: 'موصى به',  color: '#ff9900' },
  optional:    { label: 'اختياري', color: '#7c6bff' },
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'لم يُرفع بعد'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)   return 'الآن'
  if (m < 60)  return `قبل ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24)  return `قبل ${h} ساعة`
  const d = Math.floor(h / 24)
  if (d < 30)  return `قبل ${d} يوم`
  const mo = Math.floor(d / 30)
  return `قبل ${mo} شهر`
}

// ─── Expand zip → file list — يتحقّق من الامتداد ومن الـ signature ──────────
async function expandIfZip(file: File): Promise<File[]> {
  const looksLikeZipByName = /\.zip$/i.test(file.name)
  // Read first 4 bytes to detect PK signature (zip files start with 0x50 0x4B 0x03 0x04)
  let isZipByContent = false
  let buf: ArrayBuffer | null = null
  try {
    buf = await file.arrayBuffer()
    const sig = new Uint8Array(buf.slice(0, 4))
    isZipByContent = sig[0] === 0x50 && sig[1] === 0x4B && (sig[2] === 0x03 || sig[2] === 0x05) && (sig[3] === 0x04 || sig[3] === 0x06)
  } catch { /* ignore */ }

  // xlsx files are also PK-based archives — only treat as zip if extension says so OR if it's a .zip without the proper xlsx structure (we'll validate by trying)
  if (!looksLikeZipByName && !isZipByContent) return [file]
  if (!looksLikeZipByName) {
    // Only check content if extension is missing/wrong; xlsx must NOT be expanded
    if (/\.(xlsx|xlsm|xltx)$/i.test(file.name)) return [file]
  }

  try {
    const zip = await JSZip.loadAsync(buf || await file.arrayBuffer())
    const out: File[] = []
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      if (!/\.(csv|xlsx|xls|txt|tsv)$/i.test(entry.name)) continue
      const blob = await entry.async('blob')
      const cleanName = entry.name.split('/').pop() || entry.name
      out.push(new File([blob], cleanName, { type: blob.type }))
    }
    return out.length ? out : [file]
  } catch {
    return [file]
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Merchant = { merchant_code: string; name: string; role: string }
type Stage = 'queued' | 'parsing' | 'parsed' | 'validating' | 'saving' | 'saved' | 'failed' | 'rejected'

interface FileEntry {
  id: string
  file: File
  stage: Stage
  parsed?: ParseResult
  validation?: { ok: boolean; warnings: string[]; errors: string[] }
  result?: { inserted: number; updated: number; errors: string[] }
  progress: number  // 0..100
  startedAt?: number
  finishedAt?: number
}

const PLATFORMS = [
  { value: 'noon',     label: 'نون',         emoji: '🟡' },
  { value: 'trendyol', label: 'تراندايول',   emoji: '🟠' },
  { value: 'amazon',   label: 'أمازون',      emoji: '📦' },
]

// ─── Utility: validate that detected kind matches expected platform ──────────
function validateMatch(parsed: ParseResult, expectedPlatform: string): FileEntry['validation'] {
  const warnings: string[] = []
  const errors: string[] = []
  if (parsed.error) {
    errors.push(parsed.error)
    return { ok: false, warnings, errors }
  }
  if (parsed.kind === 'unknown') {
    errors.push('نوع الملف غير معروف — تأكد من اسم الملف وأعمدته')
    return { ok: false, warnings, errors }
  }
  if (parsed.platform !== expectedPlatform) {
    errors.push(`الملف من منصة "${parsed.platform}" بينما المختار "${expectedPlatform}"`)
    return { ok: false, warnings, errors }
  }
  // Sanity checks per kind
  for (const p of parsed.payloads) {
    if (p.rows.length === 0) warnings.push(`جدول ${p.table}: لا توجد صفوف`)
  }
  return { ok: errors.length === 0, warnings, errors }
}

// ─── Save logic with progress callback ───────────────────────────────────────
async function saveParsedResult(
  parsed: ParseResult,
  merchantCode: string,
  uploadId: string,
  onProgress: (pct: number, message: string) => void
): Promise<{ inserted: number; updated: number; errors: string[] }> {
  const errors: string[] = []
  let inserted = 0
  const updated = 0
  const total = parsed.payloads.reduce((a, p) => a + p.rows.length, 0) || 1

  // Special handling for ASN parent-child relationship
  if (parsed.kind === 'noon_asn') {
    const headerPayload = parsed.payloads.find(p => p.table === 'inbound_shipments')
    const itemsPayload = parsed.payloads.find(p => p.table === 'inbound_shipment_items')
    if (headerPayload && itemsPayload) {
      onProgress(10, 'حفظ بيانات الإرسالية الرئيسية…')
      const { data: parentRows, error: pErr } = await supabase
        .from('inbound_shipments')
        .upsert(headerPayload.rows, { onConflict: headerPayload.conflict, ignoreDuplicates: false })
        .select('id, asn_number')
      if (pErr) errors.push(`الإرسالية: ${pErr.message}`)
      else inserted += parentRows?.length || 0

      const map: Record<string, string> = {}
      for (const r of parentRows || []) map[r.asn_number] = r.id
      const itemsToInsert = itemsPayload.rows
        .map((it: any) => ({ ...it, shipment_id: map[it._asn_number], _asn_number: undefined }))
        .filter((it: any) => it.shipment_id)
        .map(({ _asn_number, ...rest }: any) => rest)

      if (itemsToInsert.length) {
        onProgress(60, `حفظ ${itemsToInsert.length} صنف داخل الإرسالية…`)
        for (let i = 0; i < itemsToInsert.length; i += 500) {
          const slice = itemsToInsert.slice(i, i + 500)
          const { error: iErr } = await supabase.from('inbound_shipment_items').insert(slice)
          if (iErr) errors.push(`الأصناف: ${iErr.message}`)
          else inserted += slice.length
          onProgress(60 + Math.round((i / itemsToInsert.length) * 35), `حُفظ ${Math.min(i + 500, itemsToInsert.length)}/${itemsToInsert.length}…`)
        }
      }
      // تحديث سجل التدقيق للـ ASN
      await supabase.from('platform_file_uploads').update({
        rows_processed: total, rows_inserted: inserted,
        status: errors.length ? 'partial' : 'success',
        error_message: errors.length ? errors.join(' | ').slice(0, 500) : null,
        finished_at: new Date().toISOString(),
      }).eq('id', uploadId)
      onProgress(100, 'اكتمل')
      return { inserted, updated, errors }
    }
  }

  // Standard payloads
  let processed = 0
  for (const payload of parsed.payloads) {
    if (payload.rows.length === 0) continue
    onProgress(Math.round((processed / total) * 95), `معالجة ${arabicTable(payload.table)} (${payload.rows.length} صف)…`)

    // Chunked insert
    const CHUNK = 500
    for (let i = 0; i < payload.rows.length; i += CHUNK) {
      const slice = payload.rows.slice(i, i + CHUNK)
      let err: any
      if (payload.conflict) {
        const { error } = await supabase.from(payload.table).upsert(slice, { onConflict: payload.conflict, ignoreDuplicates: false })
        err = error
      } else {
        const { error } = await supabase.from(payload.table).insert(slice)
        err = error
      }
      if (err) {
        errors.push(`${payload.table}: ${err.message}`)
      } else {
        inserted += slice.length
      }
      processed += slice.length
      onProgress(Math.round((processed / total) * 95), `معالجة ${arabicTable(payload.table)}: ${Math.min(processed, total)}/${total}`)
    }
  }

  // Update upload audit
  await supabase.from('platform_file_uploads').update({
    rows_processed: total, rows_inserted: inserted,
    status: errors.length ? 'partial' : 'success',
    error_message: errors.length ? errors.join(' | ').slice(0, 500) : null,
    finished_at: new Date().toISOString(),
  }).eq('id', uploadId)

  onProgress(100, errors.length ? 'اكتمل مع تحذيرات' : 'اكتمل بنجاح')
  return { inserted, updated, errors }
}

const TABLE_LABELS: Record<string, string> = {
  orders: 'الطلبات', products: 'المنتجات', inventory: 'المخزون',
  inbound_shipments: 'الإرساليات', inbound_shipment_items: 'أصناف الإرساليات',
  goods_received: 'الاستلام', ad_metrics: 'الإعلانات',
  account_transactions: 'المعاملات المالية',
  product_performance_snapshots: 'لقطات أداء المنتج',
  performance_data: 'الأداء اليومي',
}
function arabicTable(t: string) { return TABLE_LABELS[t] || t }

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ImportFilesView({ merchants }: { merchants: Merchant[] }) {
  const [merchantCode, setMerchantCode] = useState<string>('')
  const [platform, setPlatform]         = useState<string>('noon')
  const [files, setFiles]               = useState<FileEntry[]>([])
  const [busy, setBusy]                 = useState(false)
  const snapshotDate                    = new Date().toISOString().split('T')[0]
  const [globalMsg, setGlobalMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [lastUploads, setLastUploads]   = useState<Record<string, { uploaded_at: string; status: string; rows_inserted: number }>>({})

  // ── Fetch last upload date per file kind for current merchant + platform ──
  useEffect(() => {
    if (!merchantCode || !platform) { setLastUploads({}); return }
    let cancelled = false
    supabase.from('platform_file_uploads')
      .select('file_type, uploaded_at, status, rows_inserted')
      .eq('merchant_code', merchantCode)
      .eq('platform', platform)
      .order('uploaded_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled || !data) return
        const map: typeof lastUploads = {}
        for (const r of data) {
          const k = (r as any).file_type
          if (k && !map[k]) map[k] = { uploaded_at: r.uploaded_at, status: r.status, rows_inserted: r.rows_inserted || 0 }
        }
        setLastUploads(map)
      })
    return () => { cancelled = true }
  }, [merchantCode, platform, files])

  const merchant = useMemo(() => merchants.find(m => m.merchant_code === merchantCode), [merchants, merchantCode])
  const color = PLATFORM_COLORS[platform] || '#7c6bff'
  const platformObj = PLATFORMS.find(p => p.value === platform)

  // Progress for the whole batch
  const overallProgress = useMemo(() => {
    if (files.length === 0) return 0
    return Math.round(files.reduce((a, f) => a + f.progress, 0) / files.length)
  }, [files])

  const allValid = files.length > 0 && files.every(f => f.validation?.ok)
  const anyParsing = files.some(f => f.stage === 'parsing' || f.stage === 'validating')
  const pendingSave = files.some(f => f.stage === 'parsed')
  const allDone = files.length > 0 && files.every(f => f.stage === 'saved' || f.stage === 'rejected' || f.stage === 'failed')

  // ── Add files (parse + validate) — يفك ZIP تلقائياً ────────────────────────
  async function onAddFiles(picked: FileList | null) {
    if (!picked || !merchantCode) return
    const expanded: File[] = []
    for (const f of Array.from(picked)) {
      const inner = await expandIfZip(f)
      expanded.push(...inner)
    }
    if (expanded.length === 0) {
      setGlobalMsg({ type: 'err', text: 'لا توجد ملفات صالحة (CSV/Excel) داخل الـ ZIP' })
      return
    }
    const newEntries: FileEntry[] = expanded.map((file, i) => ({
      id: `${Date.now()}-${i}`, file, stage: 'parsing', progress: 0,
    }))
    setFiles(p => [...p, ...newEntries])
    setGlobalMsg(null)

    for (const entry of newEntries) {
      try {
        const parsed = await parsePlatformFile(entry.file, merchantCode, snapshotDate)
        const validation = validateMatch(parsed, platform)
        const isOk = validation?.ok ?? false
        setFiles(p => p.map(f => f.id === entry.id ? {
          ...f, parsed, validation,
          stage: isOk ? 'parsed' : 'rejected',
          progress: isOk ? 5 : 0,
        } : f))
      } catch (e: any) {
        setFiles(p => p.map(f => f.id === entry.id ? {
          ...f, stage: 'failed', validation: { ok: false, warnings: [], errors: [e.message] },
        } : f))
      }
    }
  }

  function removeFile(id: string) {
    setFiles(p => p.filter(f => f.id !== id))
  }

  function clearAll() {
    setFiles([])
    setGlobalMsg(null)
  }

  // ── Save all valid files ───────────────────────────────────────────────────
  async function saveAll() {
    if (!merchantCode || files.length === 0) return
    setBusy(true); setGlobalMsg(null)

    const validFiles = files.filter(f => f.validation?.ok && f.parsed)
    let totalInserted = 0
    const allErrors: string[] = []

    for (const entry of validFiles) {
      // Insert audit row
      const { data: audit } = await supabase.from('platform_file_uploads').insert({
        merchant_code: merchantCode, platform, file_name: entry.file.name,
        file_type: entry.parsed!.kind, file_size: entry.file.size,
        detected_report: entry.parsed!.label, status: 'processing',
      }).select('id').single()
      const uploadId = audit?.id || ''

      setFiles(p => p.map(f => f.id === entry.id ? { ...f, stage: 'saving', progress: 5, startedAt: Date.now() } : f))

      const result = await saveParsedResult(entry.parsed!, merchantCode, uploadId, (pct, _msg) => {
        setFiles(p => p.map(f => f.id === entry.id ? { ...f, progress: pct } : f))
      })

      totalInserted += result.inserted
      allErrors.push(...result.errors.map(e => `${entry.file.name}: ${e}`))

      setFiles(p => p.map(f => f.id === entry.id ? {
        ...f,
        stage: result.errors.length === 0 ? 'saved' : 'failed',
        result,
        progress: 100,
        finishedAt: Date.now(),
      } : f))
    }

    // إعادة بناء أداء التاجر بعد الاستيراد
    if (totalInserted > 0) {
      try {
        await supabase.rpc('rebuild_performance_data', { p_merchant_code: merchantCode })
      } catch (e: any) {
        allErrors.push(`أداء: ${e.message}`)
      }
    }

    setBusy(false)
    setGlobalMsg(allErrors.length === 0
      ? { type: 'ok',  text: `✅ تم حفظ ${totalInserted.toLocaleString()} صف من ${validFiles.length} ملف · تم تحديث الأداء اليومي` }
      : { type: 'err', text: `⚠️ تم حفظ ${totalInserted.toLocaleString()} صف · ${allErrors.length} أخطاء — راجع الملفات أدناه` })
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📥 استيراد ملفات المنصات</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>اختر التاجر والمنصة ثم ارفع الملفات الرسمية المُصدّرة من بوابة البائع</p>
      </div>

      {/* ── Step 1+2: Merchant & Platform ── */}
      <div style={{ ...S.formCard, padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
          <div>
            <label style={S.label}>1️⃣ التاجر</label>
            <select value={merchantCode} onChange={e => { setMerchantCode(e.target.value); clearAll() }}
              style={{ ...S.input, fontSize: 13 }}>
              <option value="">— اختر التاجر —</option>
              {merchants.filter(m => m.role === 'merchant').map(m => (
                <option key={m.merchant_code} value={m.merchant_code}>
                  {m.name} ({m.merchant_code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.label}>2️⃣ المنصة</label>
            <select value={platform} onChange={e => { setPlatform(e.target.value); clearAll() }}
              style={{ ...S.input, fontSize: 13, color: color, fontWeight: 700 }}>
              {PLATFORMS.map(p => (
                <option key={p.value} value={p.value}>{p.emoji} {p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.label}>تاريخ الرفع</label>
            <div style={{ ...S.input, fontSize: 13, background: 'var(--surface2)', color: 'var(--text2)', display: 'flex', alignItems: 'center' }}>
              📅 {new Date().toLocaleDateString('ar-SA')}
            </div>
          </div>
        </div>

        {!merchantCode && (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 9, background: 'rgba(255,153,0,0.06)', border: '1px solid rgba(255,153,0,0.2)', color: '#ff9900', fontSize: 12 }}>
            ⚠️ اختر التاجر أولاً قبل رفع الملفات
          </div>
        )}
      </div>

      {/* ── Step 2.5: Checklist guide for selected platform ── */}
      {merchantCode && (
        <FileChecklist platform={platform} color={color} lastUploads={lastUploads} pendingKinds={files.filter(f => f.parsed?.kind).map(f => f.parsed!.kind)} />
      )}

      {/* ── Step 3: Upload zone ── */}
      {merchantCode && (
        <div style={{ ...S.formCard, padding: 20, borderColor: color + '30', borderTop: `3px solid ${color}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>3️⃣ ارفع الملفات</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {merchant?.name} · {platformObj?.emoji} {platformObj?.label} · يتم اكتشاف نوع كل ملف تلقائياً
              </div>
            </div>
            <label style={{
              ...S.btn, background: color, color: '#fff', cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Upload size={14} />
              اختيار الملفات
              <input type="file" multiple accept=".csv,.xlsx,.xls,.txt,.tsv,.zip"
                style={{ display: 'none' }} disabled={busy}
                onChange={e => { onAddFiles(e.target.files); e.target.value = '' }} />
            </label>
          </div>

          {/* Drop hint */}
          {files.length === 0 && (
            <DropZone color={color} onDrop={onAddFiles} disabled={busy} />
          )}

          {/* File list */}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {files.map(f => <FileCard key={f.id} entry={f} color={color} onRemove={removeFile} canRemove={!busy} />)}
            </div>
          )}

          {/* Overall progress */}
          {anyParsing && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} />
              جاري قراءة وتحليل الملفات…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {busy && files.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
                <span>التقدّم الإجمالي</span>
                <span style={{ fontWeight: 700, color: color }}>{overallProgress}%</span>
              </div>
              <ProgressBar pct={overallProgress} color={color} />
            </div>
          )}
        </div>
      )}

      {/* ── Validation summary + Save ── */}
      {files.length > 0 && (
        <div style={{ ...S.formCard, padding: 18, position: 'sticky', bottom: 12, background: 'var(--surface)', boxShadow: '0 -2px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text2)' }}>
              <Stat label="ملفات" value={files.length} />
              <Stat label="جاهز" value={files.filter(f => f.stage === 'parsed' || f.stage === 'saved').length} color="#00b894" />
              <Stat label="مرفوض" value={files.filter(f => f.stage === 'rejected' || f.stage === 'failed').length} color="#e84040" />
              <Stat label="إجمالي الصفوف" value={files.reduce((a, f) => a + (f.parsed?.payloads.reduce((b, p) => b + p.rows.length, 0) || 0), 0)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={clearAll} disabled={busy} style={{ ...S.miniBtn, padding: '9px 16px', fontSize: 13 }}>
                {allDone ? 'انتهيت — إفراغ القائمة' : 'إفراغ القائمة'}
              </button>
              {(pendingSave || busy) && (
                <button onClick={saveAll} disabled={busy || !allValid || anyParsing || !pendingSave}
                  style={{ ...S.btn, background: allValid && !busy && pendingSave ? color : 'var(--surface2)', color: allValid && !busy && pendingSave ? '#fff' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8, opacity: busy ? 0.6 : 1 }}>
                  {busy ? <><Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} /> جاري الحفظ…</> : <><Save size={14} /> حفظ الكل</>}
                </button>
              )}
              {allDone && !busy && (
                <span style={{ ...S.btn, background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.3)', color: '#00b894', display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}>
                  <CheckCircle2 size={14} /> اكتمل
                </span>
              )}
            </div>
          </div>
          {!allValid && files.length > 0 && !anyParsing && !allDone && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#e84040' }}>
              ⚠️ بعض الملفات بها أخطاء — لا يمكن الحفظ حتى تُحلّ أو تُحذف
            </div>
          )}
        </div>
      )}

      {/* ── Global message ── */}
      {globalMsg && (
        <div style={{ ...S.msgBox, ...(globalMsg.type === 'ok' ? S.msgOk : S.msgErr) }}>
          <span>{globalMsg.text}</span>
          <button onClick={() => setGlobalMsg(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── File Checklist (per platform) ───────────────────────────────────────────
function FileChecklist({ platform, color, lastUploads, pendingKinds }: {
  platform: string; color: string;
  lastUploads: Record<string, { uploaded_at: string; status: string; rows_inserted: number }>;
  pendingKinds: string[];
}) {
  const guides = FILE_GUIDES[platform] || []
  if (guides.length === 0) return null

  return (
    <div style={{ ...S.formCard, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Info size={16} color={color} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>الملفات المتوقّعة لهذه المنصة</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>
        دليل سريع لكل تقرير: ماذا يفعل، آخر مرة رُفع، وأي ملف يعتمد على ملف آخر
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {guides.map(g => {
          const last  = lastUploads[g.kind]
          const isPending = pendingKinds.includes(g.kind)
          const importance = IMPORTANCE_META[g.importance]
          const dependsLast = g.dependsOn ? lastUploads[g.dependsOn] : null
          const dependsMissing = !!g.dependsOn && !dependsLast && !pendingKinds.includes(g.dependsOn)

          return (
            <div key={g.kind} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
              background: isPending ? color + '08' : 'var(--surface2)',
              border: `1px solid ${isPending ? color + '30' : 'var(--border)'}`,
              borderRadius: 10, transition: 'all 0.15s',
            }}>
              {/* Status dot */}
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8,
                background: last ? '#00b89415' : 'var(--surface)',
                border: `1px solid ${last ? '#00b89440' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              }}>
                {last ? <CheckCircle2 size={14} color="#00b894" /> : g.icon}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{g.icon} {g.label}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
                    background: importance.color + '15', color: importance.color, border: `1px solid ${importance.color}30`,
                  }}>{importance.label}</span>
                  {isPending && (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: color + '20', color: color }}>
                      ⏳ في القائمة
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{g.desc}</div>

                {/* Dependency */}
                {g.dependsOn && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: dependsMissing ? '#ff9900' : 'var(--text3)' }}>
                    <Link2 size={11} />
                    <span>{g.dependsNote}</span>
                    {dependsMissing && <span style={{ color: '#ff9900', fontWeight: 700 }}>⚠ غير مرفوع بعد</span>}
                  </div>
                )}
              </div>

              {/* Last upload info */}
              <div style={{ flexShrink: 0, textAlign: 'left', minWidth: 110 }}>
                {last ? (
                  <>
                    <div style={{ fontSize: 11, color: '#00b894', fontWeight: 700 }}>{relativeTime(last.uploaded_at)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{last.rows_inserted.toLocaleString()} صف</div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>لم يُرفع بعد</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function DropZone({ color, onDrop, disabled }: { color: string; onDrop: (files: FileList) => void; disabled: boolean }) {
  const [drag, setDrag] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (!disabled) onDrop(e.dataTransfer.files) }}
      style={{
        border: `2px dashed ${drag ? color : 'var(--border)'}`,
        borderRadius: 14, padding: '32px 24px', textAlign: 'center',
        background: drag ? color + '08' : 'var(--surface2)',
        transition: 'all 0.15s', cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 10 }}>
        <FileSpreadsheet size={32} color={drag ? color : 'var(--text3)' as any} />
        <Archive size={32} color={drag ? color : 'var(--text3)' as any} />
      </div>
      <div style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 600 }}>اسحب الملفات هنا أو اضغط زر الاختيار</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>CSV / Excel / ZIP — يفك الـ ZIP تلقائياً ويعالج كل ملف داخله</div>
    </div>
  )
}

function FileCard({ entry, color, onRemove, canRemove }: { entry: FileEntry; color: string; onRemove: (id: string) => void; canRemove: boolean }) {
  const v = entry.validation
  const p = entry.parsed
  const stageInfo = stageMeta(entry.stage)

  return (
    <div style={{
      border: `1px solid ${stageInfo.borderColor}`, borderRadius: 12,
      background: stageInfo.bg, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <stageInfo.Icon size={18} style={{ color: stageInfo.color, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.file.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {(entry.file.size / 1024).toFixed(1)} KB
              {p && <> · <span style={{ color: color, fontWeight: 700 }}>{p.label}</span></>}
              {p && p.payloads.length > 0 && <> · {p.payloads.reduce((a, x) => a + x.rows.length, 0)} صف</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: stageInfo.color, padding: '3px 10px', borderRadius: 20, background: stageInfo.color + '15' }}>
            {stageInfo.label}
          </span>
          {canRemove && (
            <button onClick={() => onRemove(entry.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {(entry.stage === 'saving' || entry.stage === 'parsing') && (
        <div style={{ marginTop: 10 }}>
          <ProgressBar pct={entry.progress} color={color} />
        </div>
      )}

      {/* Validation errors */}
      {v && v.errors.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(232,64,64,0.08)', border: '1px solid rgba(232,64,64,0.2)' }}>
          {v.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: '#e84040', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={11} /> {e}
            </div>
          ))}
        </div>
      )}
      {v && v.warnings.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#ff9900' }}>
          {v.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Parsed summary */}
      {p && p.payloads.length > 0 && entry.stage !== 'rejected' && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {p.payloads.map((pl, i) => (
            <span key={i} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>
              {arabicTable(pl.table)}: <b style={{ color: 'var(--text)' }}>{pl.rows.length}</b>
            </span>
          ))}
        </div>
      )}

      {/* Save result */}
      {entry.result && (
        <div style={{ marginTop: 8, fontSize: 11, color: entry.result.errors.length ? '#e84040' : '#00b894', fontWeight: 600 }}>
          {entry.result.errors.length === 0
            ? <><CheckCircle2 size={11} style={{ verticalAlign: 'middle' }} /> حُفظ {entry.result.inserted.toLocaleString()} صف</>
            : <>⚠ حُفظ {entry.result.inserted.toLocaleString()} · أخطاء: {entry.result.errors.slice(0, 2).join(' | ')}</>
          }
        </div>
      )}
    </div>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: 'width 0.25s ease', borderRadius: 3 }} />
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--text)' }}>{value.toLocaleString()}</span>
    </div>
  )
}

function stageMeta(stage: Stage) {
  switch (stage) {
    case 'queued':    return { label: 'في الانتظار', Icon: ArrowRight,    color: '#8891b4', bg: 'var(--surface2)',                            borderColor: 'var(--border)' }
    case 'parsing':   return { label: 'تحليل…',      Icon: Loader2,       color: '#7c6bff', bg: 'rgba(124,107,255,0.04)',                     borderColor: 'rgba(124,107,255,0.2)' }
    case 'parsed':    return { label: 'جاهز للحفظ',  Icon: CheckCircle2,  color: '#00b894', bg: 'rgba(0,184,148,0.04)',                       borderColor: 'rgba(0,184,148,0.2)' }
    case 'validating':return { label: 'تحقق…',        Icon: Loader2,       color: '#7c6bff', bg: 'rgba(124,107,255,0.04)',                     borderColor: 'rgba(124,107,255,0.2)' }
    case 'saving':    return { label: 'حفظ…',         Icon: Loader2,       color: '#ff9900', bg: 'rgba(255,153,0,0.04)',                       borderColor: 'rgba(255,153,0,0.2)' }
    case 'saved':     return { label: 'تم الحفظ',     Icon: CheckCircle2,  color: '#00b894', bg: 'rgba(0,184,148,0.06)',                       borderColor: 'rgba(0,184,148,0.3)' }
    case 'rejected':  return { label: 'مرفوض',        Icon: AlertTriangle, color: '#e84040', bg: 'rgba(232,64,64,0.04)',                       borderColor: 'rgba(232,64,64,0.2)' }
    case 'failed':    return { label: 'فشل',          Icon: AlertTriangle, color: '#e84040', bg: 'rgba(232,64,64,0.06)',                       borderColor: 'rgba(232,64,64,0.3)' }
  }
}
