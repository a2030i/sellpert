import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, type Merchant, type PerformanceData, type AiInsight } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import { PLATFORM_MAP, PLATFORM_COLORS as PLT_COLOR, DATE_PRESETS as PRESETS } from '../lib/constants'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Brush,
} from 'recharts'
import OnboardingTour from '../components/OnboardingTour'
import { InsightHint, useGeneratedHints } from '../components/InsightHint'

// ─── Constants ────────────────────────────────────────────────────────────────

const FX: Record<string, number> = { trendyol: 1, noon: 1, amazon: 1 }

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

// Saudi Arabia major cities — (lat, lng, nameAr)
const CITIES: { key: string; lat: number; lng: number; label: string }[] = [
  { key: 'الرياض',         lat: 24.71, lng: 46.68, label: 'الرياض'         },
  { key: 'جدة',            lat: 21.49, lng: 39.19, label: 'جدة'            },
  { key: 'مكة المكرمة',    lat: 21.39, lng: 39.86, label: 'مكة'            },
  { key: 'المدينة المنورة', lat: 24.52, lng: 39.57, label: 'المدينة'        },
  { key: 'الدمام',         lat: 26.42, lng: 50.09, label: 'الدمام'         },
  { key: 'الخبر',          lat: 26.22, lng: 50.20, label: 'الخبر'          },
  { key: 'تبوك',           lat: 28.38, lng: 36.56, label: 'تبوك'           },
  { key: 'أبها',           lat: 18.22, lng: 42.51, label: 'أبها'           },
  { key: 'الطائف',         lat: 21.29, lng: 40.41, label: 'الطائف'         },
  { key: 'بريدة',          lat: 26.33, lng: 43.98, label: 'بريدة'          },
  { key: 'حائل',           lat: 27.52, lng: 41.71, label: 'حائل'           },
  { key: 'نجران',          lat: 17.49, lng: 44.13, label: 'نجران'          },
  { key: 'جازان',          lat: 16.90, lng: 42.57, label: 'جازان'          },
  { key: 'ينبع',           lat: 24.09, lng: 38.07, label: 'ينبع'           },
  { key: 'الأحساء',        lat: 25.38, lng: 49.59, label: 'الأحساء'        },
  { key: 'القصيم',         lat: 26.20, lng: 43.50, label: 'القصيم'         },
  { key: 'خميس مشيط',      lat: 18.31, lng: 42.73, label: 'خميس مشيط'      },
  { key: 'القطيف',         lat: 26.56, lng: 49.98, label: 'القطيف'         },
]

// Saudi Arabia simplified border polygon (lat/lng pairs → SVG coords via project())
// 580×560 SVG, lng 34→56, lat 32.5→15.5
const KSA_POLY = [
  [29.5, 34.9], [32.0, 38.5], [32.0, 44.5], [30.1, 47.7],
  [28.8, 48.4], [26.5, 50.6], [25.0, 51.6], [23.5, 55.7],
  [22.0, 55.7], [19.0, 54.0], [17.5, 47.5], [17.0, 42.5],
  [16.9, 42.6], [18.0, 41.0], [21.5, 38.5], [24.0, 37.5],
]

function project(lat: number, lng: number): [number, number] {
  const W = 560, H = 520
  const x = (lng - 34) / 22 * W
  const y = (32.5 - lat) / 17 * H
  return [x, y]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSAR(v: number, platform: string) { return v * (FX[platform] || 1) }
function recordDate(r: PerformanceData) { return new Date(r.data_date || r.created_at) }

function filterByPreset(data: PerformanceData[], preset: string) {
  const now  = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ago = (d: number) => { const f = new Date(today); f.setDate(f.getDate() - d); return f }
  if (preset === 'last7')     return data.filter(r => recordDate(r) >= ago(7))
  if (preset === 'last30')    return data.filter(r => recordDate(r) >= ago(30))
  if (preset === 'last90')    return data.filter(r => recordDate(r) >= ago(90))
  if (preset === 'thisMonth') return data.filter(r => recordDate(r) >= new Date(now.getFullYear(), now.getMonth(), 1))
  if (preset === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to   = new Date(now.getFullYear(), now.getMonth(), 1)
    return data.filter(r => { const d = recordDate(r); return d >= from && d < to })
  }
  return data
}

function getPrev(data: PerformanceData[], preset: string) {
  const now  = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const range = (from: Date, to: Date) => data.filter(r => { const d = recordDate(r); return d >= from && d < to })
  const ago = (d: number) => { const f = new Date(today); f.setDate(f.getDate() - d); return f }
  if (preset === 'last7')  return range(ago(14), ago(7))
  if (preset === 'last30') return range(ago(60), ago(30))
  if (preset === 'last90') return range(ago(180), ago(90))
  if (preset === 'thisMonth') return range(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1))
  if (preset === 'lastMonth') return range(new Date(now.getFullYear(), now.getMonth() - 2, 1), new Date(now.getFullYear(), now.getMonth() - 1, 1))
  return []
}

function delta(curr: number, prev: number) {
  if (!prev) return null
  return Math.round(((curr - prev) / prev) * 100)
}

function fmt(v: number, type: 'currency' | 'number' | 'percent' = 'currency') {
  if (type === 'currency') return v.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س'
  if (type === 'percent')  return v.toFixed(1) + '%'
  return v.toLocaleString('ar-SA')
}

// ─── Saudi Arabia Map ─────────────────────────────────────────────────────────

function SaudiMap({ cityData }: { cityData: Record<string, number> }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [zoom, setZoom]       = useState(1)
  const [pan, setPan]         = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)

  const maxOrders = Math.max(...Object.values(cityData), 1)

  const polyPoints = KSA_POLY.map(([lat, lng]) => project(lat, lng).join(',')).join(' ')

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.2 : 0.85
    setZoom(z => Math.min(Math.max(z * factor, 1), 5))
  }

  function onMouseDown(e: React.MouseEvent) {
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
    setDragging(true)
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return
    setPan({ x: dragStart.current.px + e.clientX - dragStart.current.mx, y: dragStart.current.py + e.clientY - dragStart.current.my })
  }
  function onMouseUp() { setDragging(false); dragStart.current = null }

  const hoveredCity = CITIES.find(c => c.key === hovered)
  const hoveredOrders = hovered ? (cityData[hovered] || 0) : 0

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 10 }}>
        <button onClick={() => setZoom(z => Math.min(z * 1.3, 5))} style={mapBtn}>+</button>
        <button onClick={() => setZoom(z => Math.max(z * 0.75, 1))} style={mapBtn}>−</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} style={mapBtn}>↺</button>
      </div>

      <svg
        viewBox="0 0 560 520"
        style={{ width: '100%', maxHeight: 420, display: 'block', cursor: dragging ? 'grabbing' : 'grab', borderRadius: 12 }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <radialGradient id="bgGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ede9ff" />
            <stop offset="100%" stopColor="#f0f3f9" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width="560" height="520" fill="url(#bgGrad)" />

        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map(i => (
          <line key={`h${i}`} x1="0" y1={i * 130} x2="560" y2={i * 130} stroke="#ffffff08" strokeWidth="1" />
        ))}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <line key={`v${i}`} x1={i * 112} y1="0" x2={i * 112} y2="520" stroke="#ffffff08" strokeWidth="1" />
        ))}

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ transformOrigin: '280px 260px' }}>
          {/* Saudi Arabia border */}
          <polygon
            points={polyPoints}
            fill="rgba(124,107,255,0.08)"
            stroke="rgba(124,107,255,0.35)"
            strokeWidth={1 / zoom}
            strokeLinejoin="round"
          />

          {/* City bubbles */}
          {CITIES.map(city => {
            const [cx, cy] = project(city.lat, city.lng)
            const orders  = cityData[city.key] || 0
            const isActive = orders > 0
            const r       = isActive ? Math.max(4, Math.sqrt(orders / maxOrders) * 22) : 3
            const isHov   = hovered === city.key
            const color   = isActive ? '#7c6bff' : '#3a3a5a'

            return (
              <g key={city.key}
                onMouseEnter={() => setHovered(city.key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: isActive ? 'pointer' : 'default' }}
              >
                {isActive && (
                  <circle cx={cx} cy={cy} r={r + 6} fill={color} opacity={0.15} />
                )}
                <circle
                  cx={cx} cy={cy} r={isHov ? r + 2 : r}
                  fill={isHov ? '#a594ff' : color}
                  opacity={isActive ? 0.9 : 0.4}
                  filter={isActive ? 'url(#glow)' : undefined}
                  style={{ transition: 'r 0.2s, opacity 0.2s' }}
                />
                {(isActive || zoom > 1.8) && (
                  <text
                    x={cx} y={cy - r - 4 / zoom}
                    textAnchor="middle"
                    fontSize={10 / zoom}
                    fill={isHov ? '#fff' : '#8888aa'}
                    fontFamily="inherit"
                  >
                    {city.label}
                  </text>
                )}
                {isActive && (
                  <text
                    x={cx} y={cy + r + 10 / zoom}
                    textAnchor="middle"
                    fontSize={9 / zoom}
                    fill="#7c6bff"
                    fontFamily="monospace"
                  >
                    {orders}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        {/* Label — hover tooltip */}
        {hovered && hoveredCity && (
          <g>
            <rect x="10" y="470" width="200" height="44" rx="8" fill="#1e1b3a" stroke="rgba(124,107,255,0.4)" strokeWidth="1" />
            <text x="20" y="488" fontSize="12" fill="#eeeef5" fontFamily="inherit" fontWeight="700">{hoveredCity.key}</text>
            <text x="20" y="504" fontSize="11" fill="#7c6bff" fontFamily="monospace">{hoveredOrders.toLocaleString()} طلب</text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        {[5, 20, 50, 100].map(n => {
          const r = Math.max(4, Math.sqrt(n / Math.max(maxOrders, 1)) * 22)
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)' }}>
              <svg width={r * 2 + 4} height={r * 2 + 4} style={{ display: 'block' }}>
                <circle cx={r + 2} cy={r + 2} r={r} fill="rgba(124,107,255,0.5)" />
              </svg>
              {n}+ طلب
            </div>
          )
        })}
        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 2, background: 'rgba(124,107,255,0.35)' }} />
          حدود السعودية
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
        🖱 سكرول للتكبير · اسحب للتنقل
      </div>
    </div>
  )
}

const mapBtn: React.CSSProperties = {
  width: 28, height: 28, border: '1px solid rgba(124,107,255,0.4)',
  background: 'rgba(30,27,58,0.9)', color: '#a594ff',
  borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 800,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backdropFilter: 'blur(4px)',
}

// ─── Top Products ──────────────────────────────────────────────────────────────

function TopProducts({ items }: { items: { name: string; sales: number; orders: number }[] }) {
  const max = items[0]?.sales || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.slice(0, 7).map((item, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: i === 0 ? 700 : 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: i === 0 ? '#ffd166' : 'var(--text3)', fontWeight: 800, minWidth: 16 }}>{i + 1}</span>
              {item.name.length > 22 ? item.name.slice(0, 22) + '…' : item.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 700 }}>
              {item.sales.toLocaleString()} ر.س
            </span>
          </div>
          <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${(item.sales / max) * 100}%`,
              background: i === 0
                ? 'linear-gradient(90deg, var(--accent), var(--accent2))'
                : i < 3 ? 'var(--accent)' : 'var(--border)',
              transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{item.orders} طلب</div>
        </div>
      ))}
    </div>
  )
}

// ─── Tooltip custom ──────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--text)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || '#7c6bff', marginBottom: 2 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString('ar-SA') : p.value}
        </div>
      ))}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ merchant }: { merchant: Merchant | null }) {
  const isMobile = useMobile()
  const [data, setData]         = useState<PerformanceData[]>([])
  const [orders, setOrders]     = useState<any[]>([])
  const [insight, setInsight]   = useState<AiInsight | null>(null)
  const [loading, setLoading]   = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError]   = useState('')
  const [preset, setPreset]     = useState('last30')
  const [platform, setPlatform] = useState('all')
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    if (!merchant) return
    Promise.all([
      supabase.from('performance_data').select('*').eq('merchant_code', merchant.merchant_code).order('data_date', { ascending: false }),
      supabase.from('orders').select('customer_city,order_count,total_amount,platform,order_date').eq('merchant_code', merchant.merchant_code),
      supabase.from('ai_insights').select('*').eq('merchant_code', merchant.merchant_code).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([pd, ord, ai]) => {
      setData(pd.data || [])
      setOrders(ord.data || [])
      if (ai.data) setInsight(ai.data)
      setLoading(false)
    })
  }, [merchant])

  async function requestAi() {
    setAiLoading(true); setAiError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-merchant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ merchant_codes: [merchant?.merchant_code] }),
      })
      const j = await res.json()
      if (!res.ok || j.error) setAiError(j.error || 'خطأ')
      else setInsight(j.insight)
    } catch (e: any) { setAiError(e.message) }
    setAiLoading(false)
  }

  const pFilter = (r: PerformanceData) => platform === 'all' || r.platform === platform

  const filtered = useMemo(() => filterByPreset(data, preset).filter(pFilter), [data, preset, platform])
  const prev     = useMemo(() => getPrev(data, preset).filter(pFilter), [data, preset, platform])

  // KPIs
  const totalSales  = filtered.reduce((s, r) => s + toSAR(r.total_sales, r.platform), 0)
  const totalOrders = filtered.reduce((s, r) => s + r.order_count, 0)
  const totalFees   = filtered.reduce((s, r) => s + toSAR(r.platform_fees || 0, r.platform), 0)
  const totalAds    = filtered.reduce((s, r) => s + toSAR(r.ad_spend, r.platform), 0)
  const netProfit   = totalSales - totalFees - totalAds
  const avgMargin   = filtered.length ? filtered.reduce((s, r) => s + r.margin, 0) / filtered.length : 0
  const aov         = totalOrders > 0 ? totalSales / totalOrders : 0

  const prevSales   = prev.reduce((s, r) => s + toSAR(r.total_sales, r.platform), 0)
  const prevOrders  = prev.reduce((s, r) => s + r.order_count, 0)
  const prevFees    = prev.reduce((s, r) => s + toSAR(r.platform_fees || 0, r.platform), 0)
  const prevAds     = prev.reduce((s, r) => s + toSAR(r.ad_spend, r.platform), 0)
  const prevNet     = prevSales - prevFees - prevAds
  const prevAov     = prevOrders > 0 ? prevSales / prevOrders : 0

  // Revenue trend
  const trendData = useMemo(() => {
    const byDate: Record<string, { sales: number; orders: number; fees: number }> = {}
    filtered.forEach(r => {
      const d = r.data_date || r.created_at.slice(0, 10)
      if (!byDate[d]) byDate[d] = { sales: 0, orders: 0, fees: 0 }
      byDate[d].sales  += toSAR(r.total_sales, r.platform)
      byDate[d].orders += r.order_count
      byDate[d].fees   += toSAR(r.platform_fees || 0, r.platform)
    })
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
        المبيعات: Math.round(v.sales),
        الطلبات: v.orders,
        الرسوم: Math.round(v.fees),
      }))
  }, [filtered])

  // Platform breakdown
  const platformData = useMemo(() => {
    const acc: Record<string, number> = {}
    filtered.forEach(r => { acc[r.platform] = (acc[r.platform] || 0) + toSAR(r.total_sales, r.platform) })
    return Object.entries(acc).map(([k, v]) => ({ name: PLATFORM_MAP[k] || k, value: Math.round(v), platform: k }))
  }, [filtered])

  // Day of week
  const dayData = useMemo(() => {
    const acc: Record<number, { sales: number; count: number }> = {}
    filtered.forEach(r => {
      const d = new Date(r.data_date || r.created_at).getDay()
      if (!acc[d]) acc[d] = { sales: 0, count: 0 }
      acc[d].sales += toSAR(r.total_sales, r.platform)
      acc[d].count++
    })
    return DAY_NAMES.map((name, i) => ({
      name,
      المبيعات: Math.round((acc[i]?.sales || 0) / Math.max(acc[i]?.count || 1, 1)),
    }))
  }, [filtered])

  // Top products
  const topProducts = useMemo(() => {
    const acc: Record<string, { sales: number; orders: number }> = {}
    filtered.forEach(r => {
      if (!r.product_name) return
      if (!acc[r.product_name]) acc[r.product_name] = { sales: 0, orders: 0 }
      acc[r.product_name].sales  += toSAR(r.total_sales, r.platform)
      acc[r.product_name].orders += r.order_count
    })
    return Object.entries(acc)
      .map(([name, v]) => ({ name, sales: Math.round(v.sales), orders: v.orders }))
      .sort((a, b) => b.sales - a.sales)
  }, [filtered])

  // City data from orders
  const cityData = useMemo(() => {
    const acc: Record<string, number> = {}
    orders.forEach(o => {
      if (!o.customer_city) return
      acc[o.customer_city] = (acc[o.customer_city] || 0) + (o.order_count || 1)
    })
    return acc
  }, [orders])

  // Top cities
  const topCities = useMemo(() =>
    Object.entries(cityData)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([city, count]) => ({ city, count })),
    [cityData]
  )

  function exportCSV() {
    const rows = filtered.map(r => [
      r.data_date || r.created_at.slice(0, 10),
      PLATFORM_MAP[r.platform] || r.platform,
      r.product_name || '',
      r.order_count,
      Math.round(toSAR(r.total_sales, r.platform)),
      Math.round(toSAR(r.platform_fees || 0, r.platform)),
      r.margin,
    ])
    const csv = [['التاريخ', 'المنصة', 'المنتج', 'الطلبات', 'المبيعات', 'الرسوم', 'الهامش'], ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sellpert.csv'; a.click()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const kpis = [
    { label: 'إجمالي المبيعات', value: fmt(totalSales), icon: '💰', color: '#7c6bff', sub: `${totalOrders.toLocaleString()} طلب`, d: delta(totalSales, prevSales) },
    { label: 'صافي الربح',       value: fmt(netProfit),  icon: '📈', color: netProfit >= 0 ? '#00e5b0' : '#ff4d6d', sub: 'بعد الرسوم والإعلانات', d: delta(netProfit, prevNet) },
    { label: 'متوسط الطلب',      value: fmt(aov),        icon: '🛒', color: '#ffd166', sub: 'AOV', d: delta(aov, prevAov) },
    { label: 'متوسط الهامش',     value: fmt(avgMargin, 'percent'), icon: '🎯', color: '#ff6b6b', sub: 'هامش الربح', d: null },
  ]

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '28px 32px', minHeight: '100vh', direction: 'rtl' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, margin: 0 }}>لوحة التحكم</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            مرحباً {merchant?.name} — {new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {filtered.length > 0 && <button onClick={exportCSV} style={S.exportBtn}>⬇ تصدير CSV</button>}
      </div>

      {/* ── Filters ── */}
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              style={{ ...S.chip, ...(preset === p.key ? S.chipActive : {}) }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ key: 'all', label: 'كل المنصات' }, { key: 'trendyol', label: '🟠 تراندايول' }, { key: 'noon', label: '🟡 نون' }, { key: 'amazon', label: '🟡 أمازون' }].map(p => (
            <button key={p.key} onClick={() => setPlatform(p.key)}
              style={{ ...S.chip, fontSize: 11, ...(platform === p.key ? { ...S.chipActive, background: PLT_COLOR[p.key] || 'var(--accent)', borderColor: PLT_COLOR[p.key] || 'var(--accent)' } : {}) }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {kpis.map((k, i) => (
          <div key={i} style={S.kpiCard}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ fontSize: 18, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: k.color + '22', borderRadius: 9 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, lineHeight: 1, marginBottom: 8 }}>{k.value}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{k.sub}</span>
              {k.d !== null && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 12,
                  background: k.d >= 0 ? 'rgba(0,229,176,0.12)' : 'rgba(255,77,109,0.12)',
                  color: k.d >= 0 ? '#00e5b0' : '#ff4d6d' }}>
                  {k.d >= 0 ? '▲' : '▼'}{Math.abs(k.d)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Onboarding (للتجار الجدد) ── */}
      <OnboardingTour merchantCode={merchant?.merchant_code} />

      {/* ── AI Inline Hints ── */}
      <DashboardHints merchantCode={merchant?.merchant_code} />

      {/* ── Restock Recommendations ── */}
      <RestockWidget merchantCode={merchant?.merchant_code} />

      {/* ── ABC Analysis + Heatmap ── */}
      <ABCAndHeatmapRow merchantCode={merchant?.merchant_code} />

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--surface)', borderRadius: 16, border: '1px dashed var(--border)', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>لا توجد بيانات في هذه الفترة</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20, lineHeight: 1.7 }}>
            ارفع تقرير تراندايول أو نون أو أمازون من صفحة المنصات<br />لتبدأ في رؤية أداء متجرك هنا
          </div>
          <button onClick={() => { window.history.pushState(null,'','/integrations'); window.dispatchEvent(new PopStateEvent('popstate')) }}
            style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            🔗 ربط المنصات
          </button>
        </div>
      )}

      {/* ── Revenue + Platform ── */}
      {filtered.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>اتجاه الإيرادات</div>
              {trendData.length > 1
                ? <div style={S.cardSub}>يمكن سحب المنطقة السفلية للتكبير والتصغير</div>
                : <div style={{ fontSize: 11, color: '#ffd166' }}>⚠️ نقطة بيانات واحدة — ارفع تقارير لفترات مختلفة لرؤية الاتجاه</div>
              }
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c6bff" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#7c6bff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" />
              <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
              <Tooltip content={<ChartTooltip />} />
              <Brush dataKey="date" height={20} stroke="#e2e8f2" fill="#f5f7fc" travellerWidth={6}
                style={{ fontSize: 9 }} />
              <Area type="monotone" dataKey="المبيعات" stroke="#7c6bff" strokeWidth={2} fill="url(#areaGrad)" dot={false} activeDot={{ r: 4, fill: '#a594ff' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={S.cardTitle}>توزيع المنصات</div>
          </div>
          {platformData.length === 0 ? (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
              لا توجد بيانات
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={platformData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={4} strokeWidth={0}>
                    {platformData.map((p, i) => <Cell key={i} fill={PLT_COLOR[p.platform] || '#7c6bff'} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} formatter={(v: number) => [fmt(v), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {platformData.map((p, i) => {
                  const pct = totalSales > 0 ? Math.round((p.value / totalSales) * 100) : 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 3, height: 28, borderRadius: 3, background: PLT_COLOR[p.platform] || '#7c6bff', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 11, color: PLT_COLOR[p.platform] || 'var(--accent)', fontFamily: 'monospace' }}>{fmt(p.value)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>}

      {/* ── Day of Week + Top Products + Top Cities ── */}
      {filtered.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : topCities.length > 0 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Day of week */}
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={S.cardTitle}>أفضل أيام المبيعات</div>
            <div style={S.cardSub}>متوسط المبيعات لكل يوم</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" />
              <XAxis dataKey="name" tick={{ fill: '#5a5a7a', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="المبيعات" radius={[6, 6, 0, 0]}>
                {dayData.map((entry, i) => {
                  const max = Math.max(...dayData.map(d => d.المبيعات))
                  const isTop = entry.المبيعات === max && max > 0
                  return <Cell key={i} fill={isTop ? '#6c5ce7' : '#e2e8f2'} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Products */}
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={S.cardTitle}>أعلى المنتجات</div>
            <div style={S.cardSub}>حسب إجمالي المبيعات</div>
          </div>
          {topProducts.length === 0 ? (
            <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '0 16px' }}>
              <span style={{ fontSize: 28 }}>📦</span>
              ارفع تقرير تراندايول لرؤية أفضل منتجاتك هنا
            </div>
          ) : (
            <TopProducts items={topProducts} />
          )}
        </div>

        {/* Top Cities — يظهر فقط عند وجود بيانات */}
        {topCities.length > 0 && <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={S.cardTitle}>أعلى المدن طلباً</div>
            <div style={S.cardSub}>من بيانات الطلبات</div>
          </div>
          {topCities.length === 0 ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topCities.map((c, i) => {
                const maxC = topCities[0].count
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: i === 0 ? '#ffd166' : 'var(--text3)', fontWeight: 800, minWidth: 16 }}>{i + 1}</span>
                        {c.city}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--accent2)', fontFamily: 'monospace', fontWeight: 700 }}>{c.count.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, width: `${(c.count / maxC) * 100}%`, background: i === 0 ? 'linear-gradient(90deg,var(--accent2),#7c6bff)' : 'var(--accent2)', transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>}
      </div>}

      {/* ── Saudi Arabia Map — يظهر فقط عند وجود بيانات مدن ── */}
      {topCities.length > 0 && (
      <div style={S.card}>
        <div style={{ ...S.cardHeader, marginBottom: 12 }}>
          <div>
            <div style={S.cardTitle}>🗺 خريطة الطلبات — المملكة العربية السعودية</div>
            <div style={S.cardSub}>حجم الفقاعة يعكس عدد الطلبات لكل مدينة · بيانات من طلبات المنصات</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'left' }}>
            {Object.keys(cityData).length} مدينة
          </div>
        </div>
        <SaudiMap cityData={cityData} />
      </div>)}

      {/* ── AI Insights ── */}
      <div style={{ ...S.card, marginTop: 16, borderTop: '3px solid var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: insight ? 16 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🤖</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>تحليل الذكاء الاصطناعي</div>
              {insight && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>آخر تحليل: {new Date(insight.created_at).toLocaleString('ar-SA')}</div>}
            </div>
          </div>
          <button style={S.aiBtn} onClick={requestAi} disabled={aiLoading}>
            {aiLoading ? '⟳ جاري...' : insight ? '🔄 تحديث' : '✨ ابدأ التحليل'}
          </button>
        </div>
        {aiError && <div style={{ color: '#ff4d6d', fontSize: 12, marginTop: 8 }}>⚠ {aiError}</div>}
        {insight && (
          <div>
            {(insight.content as any).summary && (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, lineHeight: 1.8, color: 'var(--text2)' }}>
                {(insight.content as any).summary}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {(insight.content as any).recommendations?.length > 0 && (
                <div style={S.aiBox}>
                  <div style={S.aiBoxTitle}>💡 التوصيات</div>
                  {(insight.content as any).recommendations.map((r: string, i: number) => (
                    <div key={i} style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 6, paddingRight: 12, borderRight: '2px solid var(--accent)' }}>
                      {r}
                    </div>
                  ))}
                </div>
              )}
              {(insight.content as any).forecast_next_week && (
                <div style={S.aiBox}>
                  <div style={S.aiBoxTitle}>🔮 توقع الأسبوع القادم</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', marginTop: 8 }}>
                    {(insight.content as any).forecast_next_week.amount?.toLocaleString()} ر.س
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    ثقة: {(insight.content as any).forecast_next_week.confidence} — {(insight.content as any).forecast_next_week.reasoning}
                  </div>
                </div>
              )}
              {(insight.content as any).best_days?.length > 0 && (
                <div style={S.aiBox}>
                  <div style={S.aiBoxTitle}>📅 أفضل أيام البيع</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {(insight.content as any).best_days.map((d: string, i: number) => (
                      <span key={i} style={{ background: 'rgba(0,229,176,0.15)', color: 'var(--accent2)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {!insight && !aiLoading && (
          <div style={{ textAlign: 'center', padding: '16px 0 4px', color: 'var(--text3)', fontSize: 13 }}>
            اضغط "ابدأ التحليل" للحصول على رؤى ذكية مبنية على بياناتك
          </div>
        )}
      </div>

      {/* ── Data Table (collapsible) ── */}
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={{ ...S.cardHeader, cursor: 'pointer', marginBottom: showTable ? 0 : undefined }}
          onClick={() => setShowTable(v => !v)}>
          <div style={S.cardTitle}>📋 سجل البيانات التفصيلي</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...S.badge }}>{filtered.length} سجل</span>
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>{showTable ? '▲' : '▼'}</span>
          </div>
        </div>
        {showTable && (
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['التاريخ', 'المنصة', 'المنتج', 'الطلبات', 'المبيعات', 'الرسوم', 'الهامش'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>لا توجد بيانات</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={S.td}>{r.data_date || r.created_at.slice(0, 10)}</td>
                    <td style={S.td}><span style={{ background: `${PLT_COLOR[r.platform]}22`, color: PLT_COLOR[r.platform] || 'var(--accent)', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{PLATFORM_MAP[r.platform] || r.platform}</span></td>
                    <td style={{ ...S.td, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name || '—'}</td>
                    <td style={S.td}>{r.order_count.toLocaleString()}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmt(toSAR(r.total_sales, r.platform))}</td>
                    <td style={S.td}>{fmt(toSAR(r.platform_fees || 0, r.platform))}</td>
                    <td style={{ ...S.td, color: r.margin >= 0 ? '#00e5b0' : '#ff4d6d', fontWeight: 600 }}>{fmt(r.margin, 'percent')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: 20, marginBottom: 0,
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  cardSub:   { fontSize: 11, color: 'var(--text3)' },
  kpiCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: 18, position: 'relative', overflow: 'hidden',
  },
  kpiBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0' },
  chip: {
    padding: '7px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  },
  chipActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  exportBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  badge: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace',
  },
  th: {
    padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700,
    color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
  },
  td: { padding: '11px 16px', fontSize: 13 },
  aiBtn: {
    background: 'linear-gradient(135deg, var(--accent), #a594ff)',
    border: 'none', color: '#fff', padding: '9px 20px',
    borderRadius: 10, fontSize: 13, fontWeight: 700,
    boxShadow: '0 4px 14px rgba(124,107,255,0.35)', cursor: 'pointer',
    flexShrink: 0,
  },
  aiBox: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '14px 16px',
  },
  aiBoxTitle: {
    fontSize: 12, fontWeight: 800, color: 'var(--text2)',
    marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.5px',
  },
}


// ─── Restock Recommendations Widget ───────────────────────────────────────────
function RestockWidget({ merchantCode }: { merchantCode?: string }) {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => {
    if (!merchantCode) return
    supabase.rpc('restock_recommendations', { p_merchant_code: merchantCode, p_lead_time_days: 14 })
      .then(({ data }) => setItems((data || []).slice(0, 5)))
  }, [merchantCode])

  if (items.length === 0) return null
  const colors: Record<string, string> = { urgent: '#e84040', high: '#ff9900', medium: '#ffd166', low: '#00b894' }
  const labels: Record<string, string> = { urgent: 'عاجل', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🔄 توصيات إعادة التوريد</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>بناءً على سرعة بيعك ومدّة توريد 14 يوم</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{items.length} منتج</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => {
          const c = colors[it.urgency] || '#7c6bff'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10, borderRight: `3px solid ${c}` }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: c + '20', color: c, minWidth: 55, textAlign: 'center' }}>{labels[it.urgency]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.product_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {it.current_qty} قطعة · سرعة {Number(it.daily_velocity).toFixed(1)}/يوم
                  {it.days_of_stock !== null && ` · يكفي ${it.days_of_stock} يوم`}
                </div>
              </div>
              <div style={{ textAlign: 'left', flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>اطلب</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{it.suggested_order_qty}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ABC + Heatmap Row ────────────────────────────────────────────────────────
function ABCAndHeatmapRow({ merchantCode }: { merchantCode?: string }) {
  const [abc, setAbc] = useState<any[]>([])
  const [heatmap, setHeatmap] = useState<any[]>([])
  useEffect(() => {
    if (!merchantCode) return
    Promise.all([
      supabase.from('product_abc_analysis').select('*').eq('merchant_code', merchantCode).order('rank').limit(50),
      supabase.rpc('sales_heatmap', { p_merchant_code: merchantCode, p_days: 90 }),
    ]).then(([a, h]) => {
      setAbc(a.data || [])
      setHeatmap(h.data || [])
    })
  }, [merchantCode])

  if (abc.length === 0 && heatmap.length === 0) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 20 }}>
      {abc.length > 0 && <ABCWidget data={abc} />}
      {heatmap.length > 0 && <HeatmapWidget data={heatmap} />}
    </div>
  )
}

function ABCWidget({ data }: { data: any[] }) {
  const counts: any = { A: 0, B: 0, C: 0 }
  const revenues: any = { A: 0, B: 0, C: 0 }
  for (const r of data) {
    counts[r.abc_class]++
    revenues[r.abc_class] += Number(r.revenue) || 0
  }
  const totalRev = revenues.A + revenues.B + revenues.C
  const colors: any = { A: '#00b894', B: '#ff9900', C: '#a598ff' }
  const labels: any = { A: 'منتجات أساسية', B: 'متوسطة', C: 'هامشية' }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>📊 تحليل ABC للمنتجات</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>التوزيع حسب مساهمة الإيراد (مبدأ 80/20)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        {['A', 'B', 'C'].map(cls => {
          const pct = totalRev > 0 ? (revenues[cls] / totalRev * 100) : 0
          return (
            <div key={cls} style={{ padding: 12, background: 'var(--surface2)', borderRadius: 10, borderTop: `3px solid ${colors[cls]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: colors[cls] }}>{cls}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{labels[cls]}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{counts[cls]}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                {pct.toFixed(0)}% من الإيراد
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>أبرز منتجات الفئة A</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.filter((r: any) => r.abc_class === 'A').slice(0, 5).map((r: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface2)', borderRadius: 7, fontSize: 11 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={r.product_name}>#{r.rank} · {r.product_name}</span>
            <span style={{ fontWeight: 700, color: '#00b894' }}>{Math.round(Number(r.revenue)).toLocaleString('ar-SA')} ر.س</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HeatmapWidget({ data }: { data: any[] }) {
  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const max = Math.max(...data.map((d: any) => d.orders), 1)
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const d of data) grid[d.day_of_week][d.hour_of_day] = d.orders
  const peakHour = data.reduce((p: any, c: any) => c.orders > (p?.orders || 0) ? c : p, data[0])

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>🔥 خريطة المبيعات الزمنية</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>آخر 90 يوم</div>
      {peakHour && (
        <div style={{ fontSize: 12, color: '#00b894', fontWeight: 700, marginBottom: 12 }}>
          ⭐ ذروة: {dayNames[peakHour.day_of_week]} الساعة {peakHour.hour_of_day}:00 ({peakHour.orders} طلب)
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 9 }}>
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: 24 }).map((_, h) => (
                <th key={h} style={{ padding: '2px 1px', color: 'var(--text3)', fontWeight: 500, fontSize: 8 }}>{h % 3 === 0 ? h : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dayNames.map((day, di) => (
              <tr key={di}>
                <td style={{ padding: '0 8px 0 2px', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', textAlign: 'left' }}>{day}</td>
                {Array.from({ length: 24 }).map((_, hi) => {
                  const v = grid[di][hi]
                  const intensity = v / max
                  const color = v === 0 ? 'var(--surface2)' : `rgba(0, 184, 148, ${0.15 + intensity * 0.85})`
                  return (
                    <td key={hi} title={`${day} ${hi}:00 — ${v} طلب`} style={{ width: 14, height: 14, background: color, borderRadius: 2, padding: 0 }} />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashboardHints({ merchantCode }: { merchantCode?: string }) {
  const hints = useGeneratedHints(merchantCode)
  return <InsightHint hints={hints} />
}
