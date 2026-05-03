import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { fmtCurrency, fmtNumber } from '../../lib/formatters'
import { Truck, Package, Clock } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string }

export default function OperationsView({ merchants }: { merchants: Merchant[] }) {
  const [merchantCode, setMerchantCode] = useState('')
  const [shipping, setShipping] = useState<any>(null)
  const [fulfillment, setFulfillment] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    setLoading(true)
    Promise.all([
      supabase.rpc('shipping_analytics', { p_merchant_code: merchantCode }),
      supabase.from('fulfillment_performance').select('*').eq('merchant_code', merchantCode),
    ]).then(([s, f]) => {
      setShipping(s.data || null)
      setFulfillment((f.data || []) as any[])
      setLoading(false)
    })
  }, [merchantCode])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📦 العمليات والشحن</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>تحليل أداء الشحن وقنوات الإيفاء (FBN/FBP/FBA)</p>
      </div>

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
          {/* Shipping KPIs */}
          {shipping && Number(shipping.total_orders) > 0 && (
            <div style={{ ...S.formCard, padding: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} /> تحليل الشحن (آخر 90 يوم)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <KpiBox label="إجمالي الطلبات المشحونة" value={fmtNumber(Number(shipping.total_orders))} color="#7c6bff" />
                <KpiBox label="متوسط وقت الشحن" value={Number(shipping.avg_ship_hours).toFixed(1) + ' ساعة'} color="#4cc9f0" />
                <KpiBox label="متوسط وقت التسليم" value={Number(shipping.avg_delivery_hours).toFixed(1) + ' ساعة'} color="#00b894" />
                <KpiBox label="إجمالي الأيام للوصول" value={Number(shipping.avg_total_days).toFixed(1) + ' يوم'} color="#a598ff" />
                <KpiBox label="شحنات متأخرة (>48 ساعة)" value={fmtNumber(Number(shipping.late_shipments))} color="#e84040" sub={shipping.total_orders > 0 ? Math.round((shipping.late_shipments / shipping.total_orders) * 100) + '%' : ''} />
                <KpiBox label="أسرع شحن" value={Number(shipping.fastest_hours).toFixed(1) + ' ساعة'} color="#00b894" />
              </div>
            </div>
          )}

          {/* Fulfillment Performance */}
          {fulfillment.length > 0 && (
            <div style={{ ...S.tableCard }}>
              <div style={{ ...S.tableHeader }}>
                <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Package size={16} /> أداء قنوات الإيفاء (FBN vs FBP vs FBA)
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>{['المنصة','القناة','عدد الطلبات','الإيرادات','متوسط الطلب','الرسوم','ملغي','مرتجع','شحن (ساعة)','تسليم (ساعة)'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {fulfillment.map((f, i) => {
                      const color = PLATFORM_COLORS[f.platform] || '#7c6bff'
                      return (
                        <tr key={i} style={S.tr}>
                          <td style={{ ...S.td, color, fontWeight: 700 }}>{PLATFORM_MAP[f.platform] || f.platform}</td>
                          <td style={{ ...S.td, fontWeight: 700 }}>{f.fulfillment_model}</td>
                          <td style={S.td}>{fmtNumber(f.orders)}</td>
                          <td style={{ ...S.td, color: '#00b894', fontWeight: 700 }}>{fmtCurrency(Number(f.revenue))}</td>
                          <td style={S.td}>{fmtCurrency(Number(f.avg_order_value))}</td>
                          <td style={{ ...S.td, color: '#ff4d6d' }}>{fmtCurrency(Number(f.fees))}</td>
                          <td style={{ ...S.td, color: f.cancelled > 0 ? '#e84040' : 'var(--text3)' }}>{f.cancelled}</td>
                          <td style={{ ...S.td, color: f.returned > 0 ? '#ff6b6b' : 'var(--text3)' }}>{f.returned}</td>
                          <td style={S.td}>{f.avg_ship_hours ? Number(f.avg_ship_hours).toFixed(1) : '—'}</td>
                          <td style={S.td}>{f.avg_delivery_hours ? Number(f.avg_delivery_hours).toFixed(1) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(!shipping || Number(shipping.total_orders) === 0) && fulfillment.length === 0 && (
            <div style={{ ...S.formCard, padding: 60, textAlign: 'center' }}>
              <Truck size={48} color="var(--text3)" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>لا توجد بيانات شحن لهذا التاجر</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>تظهر هذه البيانات بعد رفع تقارير المبيعات اللي فيها تواريخ شحن وتسليم</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
