import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { Truck, PackageCheck, AlertTriangle, Search } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string }

interface Shipment {
  id: string
  asn_number: string
  warehouse_code: string | null
  expected_qty: number
  delivered_qty: number
  variance: number
  status: string
  delivery_date: string | null
  created_at: string
  platform: string
  merchant_code: string
}

interface GrnRow {
  id: string
  asn_number: string | null
  sku: string | null
  partner_sku: string | null
  barcode: string | null
  grn_quantity: number
  qc_status: string
  reject_reason: string | null
  grn_date: string | null
  warehouse_code: string | null
  platform: string
  merchant_code: string
}

export default function InboundView({ merchants }: { merchants: Merchant[] }) {
  const [merchantCode, setMerchantCode] = useState('')
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [grns, setGrns] = useState<GrnRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (merchantCode) load() }, [merchantCode])

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: g }] = await Promise.all([
      supabase.from('inbound_shipments').select('*').eq('merchant_code', merchantCode).order('created_at', { ascending: false }),
      supabase.from('goods_received').select('*').eq('merchant_code', merchantCode).order('grn_date', { ascending: false }),
    ])
    setShipments((s as Shipment[]) || [])
    setGrns((g as GrnRow[]) || [])
    setLoading(false)
  }

  const totals = useMemo(() => ({
    shipments: shipments.length,
    expected:  shipments.reduce((a, s) => a + (s.expected_qty || 0), 0),
    delivered: shipments.reduce((a, s) => a + (s.delivered_qty || 0), 0),
    variance:  shipments.reduce((a, s) => a + (s.variance || 0), 0),
    grnRows:   grns.length,
    qcFail:    grns.filter(g => g.qc_status === 'failed').length,
    qcFailQty: grns.filter(g => g.qc_status === 'failed').reduce((a, g) => a + g.grn_quantity, 0),
  }), [shipments, grns])

  const filteredGrns = useMemo(() => {
    if (!search) return grns
    const q = search.toLowerCase()
    return grns.filter(g => (g.sku || '').toLowerCase().includes(q) || (g.barcode || '').toLowerCase().includes(q) || (g.asn_number || '').toLowerCase().includes(q))
  }, [grns, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>🚚 الإرساليات والاستلام</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>متابعة ASN (ما أُرسل للمستودع) و GRN (ما استُلم فعلياً) لكل تاجر</p>
      </div>

      {/* Merchant selector */}
      <div style={{ ...S.formCard, padding: 18 }}>
        <label style={S.label}>التاجر</label>
        <select value={merchantCode} onChange={e => setMerchantCode(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
          <option value="">— اختر التاجر —</option>
          {merchants.filter(m => m.role === 'merchant').map(m => (
            <option key={m.merchant_code} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>
          ))}
        </select>
      </div>

      {merchantCode && !loading && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiCard label="الإرساليات" value={totals.shipments} icon={<Truck size={20} />} color="#7c6bff" />
            <KpiCard label="إجمالي المتوقع" value={totals.expected} sub="قطعة" color="#4cc9f0" />
            <KpiCard label="المُستلم فعلياً" value={totals.delivered} sub="قطعة" color="#00b894" />
            <KpiCard label="الفرق" value={totals.variance} sub={totals.variance >= 0 ? 'زيادة' : 'نقص'} color={totals.variance < 0 ? '#e84040' : '#00b894'} />
          </div>

          {/* QC alerts */}
          {totals.qcFail > 0 && (
            <div style={{ ...S.formCard, padding: 18, borderColor: 'rgba(232,64,64,0.3)', background: 'rgba(232,64,64,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={20} color="#e84040" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#e84040' }}>تنبيه فحص الجودة</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                    {totals.qcFail} صنف رُفض ({totals.qcFailQty} قطعة) — راجع الأسباب أدناه
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shipments table */}
          {shipments.length > 0 && (
            <div style={{ ...S.tableCard }}>
              <div style={S.tableHeader}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>📦 الإرساليات (ASN)</div>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{shipments.length} إرسالية</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {['ASN', 'المنصة', 'المستودع', 'التاريخ', 'متوقع', 'مُستلم', 'الفرق', 'الحالة'].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map(s => {
                      const color = PLATFORM_COLORS[s.platform] || '#7c6bff'
                      const variancePct = s.expected_qty > 0 ? Math.round((s.variance / s.expected_qty) * 100) : 0
                      return (
                        <tr key={s.id} style={S.tr}>
                          <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 700 }}>{s.asn_number}</td>
                          <td style={{ ...S.td, color, fontWeight: 700 }}>{PLATFORM_MAP[s.platform] || s.platform}</td>
                          <td style={S.td}>{s.warehouse_code || '—'}</td>
                          <td style={{ ...S.td, fontSize: 12, color: 'var(--text3)' }}>{s.delivery_date || new Date(s.created_at).toLocaleDateString('ar-SA')}</td>
                          <td style={S.td}>{s.expected_qty.toLocaleString()}</td>
                          <td style={S.td}>{s.delivered_qty.toLocaleString()}</td>
                          <td style={{ ...S.td, color: s.variance < 0 ? '#e84040' : s.variance > 0 ? '#ff9900' : 'var(--text3)', fontWeight: 700 }}>
                            {s.variance > 0 ? '+' : ''}{s.variance} {variancePct !== 0 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>({variancePct}%)</span>}
                          </td>
                          <td style={S.td}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: s.status === 'received' ? 'rgba(0,184,148,0.1)' : 'rgba(255,153,0,0.1)', color: s.status === 'received' ? '#00b894' : '#ff9900' }}>
                              {s.status === 'received' ? '✓ مُستلم' : 'قيد الإرسال'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* GRN line items */}
          {grns.length > 0 && (
            <div style={{ ...S.tableCard }}>
              <div style={{ ...S.tableHeader, gap: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PackageCheck size={16} />
                  بنود الاستلام (GRN)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', right: 10, color: 'var(--text3)' }} />
                  <input
                    placeholder="بحث SKU / باركود / ASN"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ ...S.searchInput, paddingRight: 32, minWidth: 220 }}
                  />
                </div>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
                <table style={S.table}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 1 }}>
                    <tr>
                      {['ASN', 'SKU', 'باركود', 'الكمية', 'الجودة', 'سبب الرفض', 'التاريخ'].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGrns.slice(0, 200).map(g => (
                      <tr key={g.id} style={S.tr}>
                        <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace' }}>{g.asn_number || '—'}</td>
                        <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace' }}>{g.sku || '—'}</td>
                        <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{g.barcode || g.partner_sku || '—'}</td>
                        <td style={{ ...S.td, fontWeight: 700 }}>{g.grn_quantity.toLocaleString()}</td>
                        <td style={S.td}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: g.qc_status === 'failed' ? 'rgba(232,64,64,0.1)' : 'rgba(0,184,148,0.1)',
                            color: g.qc_status === 'failed' ? '#e84040' : '#00b894',
                          }}>
                            {g.qc_status === 'failed' ? '✗ مرفوض' : '✓ مقبول'}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: '#e84040' }}>{g.reject_reason || '—'}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{g.grn_date ? new Date(g.grn_date).toLocaleDateString('ar-SA') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredGrns.length > 200 && (
                <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text3)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                  يُعرض 200 من {filteredGrns.length} — استخدم البحث للتصفية
                </div>
              )}
            </div>
          )}

          {shipments.length === 0 && grns.length === 0 && (
            <div style={{ ...S.formCard, padding: 60, textAlign: 'center' }}>
              <Truck size={48} color="var(--text3)" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>لا توجد إرساليات لهذا التاجر</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>ارفع تقارير ASN/GRN من صفحة استيراد الملفات</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, icon, color }: { label: string; value: number; sub?: string; icon?: React.ReactNode; color: string }) {
  return (
    <div style={{ ...S.kpiCard, borderLeft: `3px solid ${color}` }}>
      <div style={S.kpiTop}>
        <span style={S.kpiLabel}>{label}</span>
        {icon && <span style={{ ...S.kpiIcon, color, background: color + '15' }}>{icon}</span>}
      </div>
      <div style={{ ...S.kpiValue, color }}>{value.toLocaleString('ar-SA')}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  )
}
