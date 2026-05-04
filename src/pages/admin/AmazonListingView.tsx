import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import { fmtRelative } from '../../lib/formatters'
import { toastOk, toastErr } from '../../components/Toast'
import { exportToExcel } from '../../lib/excel'
import { Package, Download, CheckCircle2, AlertCircle, Plus } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string }

export default function AmazonListingView({ merchants }: { merchants: Merchant[] }) {
  const [merchantCode, setMerchantCode] = useState('')
  const [productType, setProductType] = useState('SEASONING')
  const [products, setProducts] = useState<any[]>([])
  const [browseNodes, setBrowseNodes] = useState<any[]>([])
  const [template, setTemplate] = useState<any>(null)
  const [drafts, setDrafts] = useState<any[]>([])
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [draftData, setDraftData] = useState<any>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('amazon_listing_templates').select('*').eq('product_type', productType).maybeSingle().then(({ data }) => setTemplate(data))
    supabase.from('amazon_browse_nodes').select('*').eq('product_type', productType).then(({ data }) => setBrowseNodes(data || []))
  }, [productType])

  useEffect(() => {
    if (!merchantCode) return
    supabase.from('products').select('*').eq('merchant_code', merchantCode).limit(200).then(({ data }) => setProducts(data || []))
    supabase.from('amazon_listing_drafts').select('*').eq('merchant_code', merchantCode).order('created_at', { ascending: false }).then(({ data }) => setDrafts(data || []))
  }, [merchantCode])

  function startNew(product: any) {
    setSelectedProduct(product)
    // Pre-fill from product
    setDraftData({
      sku: product.sku || '',
      item_name: product.name || '',
      brand: product.brand || '',
      product_id_type: 'EAN',
      product_id: product.barcode || '',
      manufacturer: product.brand || '',
      main_image_url: product.image_url || '',
      product_description: product.description || '',
      bullet_point_1: '',
      recommended_browse_node: '',
    })
  }

  async function saveDraft() {
    if (!selectedProduct || !merchantCode) return
    setSaving(true)
    const required: string[] = template?.required_fields || []
    const missing = required.filter(f => !draftData[f])
    const status = missing.length === 0 ? 'ready' : 'draft'
    await supabase.from('amazon_listing_drafts').upsert({
      merchant_code: merchantCode,
      product_id: selectedProduct.id,
      product_type: productType,
      browse_node_id: draftData.recommended_browse_node || null,
      data: draftData,
      validation_status: status,
      missing_required: missing,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'merchant_code,product_id,product_type' as any })
    setSaving(false)
    if (missing.length === 0) toastOk('✓ المسودة جاهزة للتصدير')
    else toastErr(`ناقص: ${missing.join(', ')}`)
    const { data: d2 } = await supabase.from('amazon_listing_drafts').select('*').eq('merchant_code', merchantCode).order('created_at', { ascending: false })
    setDrafts(d2 || [])
  }

  function exportTemplate() {
    if (drafts.filter(d => d.validation_status === 'ready').length === 0) {
      toastErr('لا توجد مسودات جاهزة للتصدير')
      return
    }
    const ready = drafts.filter(d => d.validation_status === 'ready')
    const rows = ready.map(d => ({
      SKU: d.data.sku,
      'Product Type': productType,
      'Listing Action': 'Create or Replace (Full Update)',
      'Item Name': d.data.item_name,
      'Brand Name': d.data.brand,
      'Product Id Type': d.data.product_id_type,
      'Product Id': d.data.product_id,
      'Manufacturer': d.data.manufacturer,
      'Main Image URL': d.data.main_image_url,
      'Product Description': d.data.product_description,
      'Bullet Point 1': d.data.bullet_point_1,
      'Recommended Browse Nodes': d.data.recommended_browse_node,
    }))
    exportToExcel(rows, `amazon-${productType.toLowerCase()}-listings-${new Date().toISOString().split('T')[0]}`, productType)
    toastOk(`✓ صُدِّر ${rows.length} قائمة`)
  }

  const required: string[] = template?.required_fields || []
  const fields: any = template?.field_definitions || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📤 مولّد قوائم Amazon</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>أنشئ قوائم منتجات بصيغة Amazon Flat File جاهزة للرفع على Seller Central</p>
      </div>

      {/* Selectors */}
      <div style={{ ...S.formCard, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label style={S.label}>التاجر</label>
            <select value={merchantCode} onChange={e => setMerchantCode(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
              <option value="">— اختر التاجر —</option>
              {merchants.filter(m => m.role === 'merchant').map(m => (
                <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.label}>نوع المنتج (Product Type)</label>
            <select value={productType} onChange={e => setProductType(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
              <option value="SEASONING">SEASONING (توابل وبهارات)</option>
            </select>
          </div>
        </div>
        {template && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, color: 'var(--text2)' }}>
            <b>الحقول المطلوبة ({required.length}):</b> {required.join(' · ')}
          </div>
        )}
      </div>

      {merchantCode && !selectedProduct && (
        <>
          {/* Existing drafts */}
          {drafts.length > 0 && (
            <div style={{ ...S.formCard, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>المسودات ({drafts.length})</div>
                <button onClick={exportTemplate} style={{ background: '#ff9900', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                  <Download size={14} /> تصدير الجاهزة
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drafts.map(d => {
                  const prod = products.find(p => p.id === d.product_id)
                  const ready = d.validation_status === 'ready'
                  return (
                    <div key={d.id} style={{
                      padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                    }} onClick={() => prod && startNew({ ...prod })}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{prod?.name || 'منتج محذوف'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{fmtRelative(d.updated_at)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {ready ? <CheckCircle2 size={16} color="#00b894" /> : <AlertCircle size={16} color="#ff9900" />}
                        <span style={{ fontSize: 11, fontWeight: 700, color: ready ? '#00b894' : '#ff9900' }}>
                          {ready ? 'جاهز' : `ناقص ${(d.missing_required || []).length}`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Products */}
          <div style={{ ...S.formCard, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>اختر منتج لإضافته للقائمة</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {products.map(p => (
                <button key={p.id} onClick={() => startNew(p)} style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)', padding: 12, borderRadius: 8,
                  cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace' }}>{p.sku || '—'} · {p.barcode || 'بدون باركود'}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Editor */}
      {selectedProduct && (
        <div style={{ ...S.formCard, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}><Package size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} /> {selectedProduct.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>SKU: {selectedProduct.sku || '—'}</div>
            </div>
            <button onClick={() => setSelectedProduct(null)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>← العودة</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {Object.entries(fields).map(([k, def]: any) => {
              const isRequired = required.includes(k)
              const val = draftData[k] || ''
              const accepted = def.accepted as string[] | undefined
              return (
                <div key={k}>
                  <label style={{ ...S.label, color: isRequired ? '#e84040' : 'var(--text2)' }}>
                    {def.label || k} {isRequired && <span style={{ color: '#e84040' }}>*</span>}
                  </label>
                  {k === 'recommended_browse_node' ? (
                    <select value={val} onChange={e => setDraftData({ ...draftData, [k]: e.target.value })} style={{ ...S.input, fontSize: 12 }}>
                      <option value="">— اختر فئة —</option>
                      {browseNodes.map(n => <option key={n.node_id} value={n.node_id}>{n.path_ar}</option>)}
                    </select>
                  ) : accepted && accepted.length < 10 ? (
                    <select value={val} onChange={e => setDraftData({ ...draftData, [k]: e.target.value })} style={{ ...S.input, fontSize: 12 }}>
                      <option value="">—</option>
                      {accepted.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : (
                    <input value={val} onChange={e => setDraftData({ ...draftData, [k]: e.target.value })} placeholder={def.example || ''} style={{ ...S.input, fontSize: 12 }} />
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={saveDraft} disabled={saving} style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> {saving ? 'حفظ...' : 'حفظ المسودة'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
