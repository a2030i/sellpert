import type React from 'react'
export { PLATFORM_MAP, PLATFORM_COLORS, CHART_COLORS } from '../../lib/constants'

export function fmt(v: number, type: 'currency' | 'percent' | 'number' = 'currency') {
  if (type === 'currency') return v.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س'
  if (type === 'percent') return v.toFixed(1) + '%'
  return v.toLocaleString('ar-SA')
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `منذ ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${Math.floor(h / 24)} يوم`
}

export const S: Record<string, React.CSSProperties> = {
  sidebar: {
    background: '#1e2239',
    borderLeft: '1px solid #2c3356',
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 230, zIndex: 100,
    overflowY: 'auto',
  },
  sidebarLogo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '20px 16px', borderBottom: '1px solid #2c3356',
    flexShrink: 0,
  },
  logoIcon: {
    width: 40, height: 40, borderRadius: 12,
    background: 'linear-gradient(135deg,#6c5ce7,#00b894)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  logoText: { fontSize: 17, fontWeight: 800, color: '#e2e6f4', lineHeight: 1.2 },
  logoBadge: {
    fontSize: 10, fontWeight: 700, color: '#a598ff',
    background: 'rgba(108,92,231,0.2)', padding: '2px 7px',
    borderRadius: 20, marginTop: 3, display: 'inline-block',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', margin: '1px 8px',
    color: '#8891b4', cursor: 'pointer',
    transition: 'all 0.15s', fontSize: 13, fontWeight: 500,
    borderRadius: 10,
  },
  navActive: { color: '#a598ff', background: 'rgba(108,92,231,0.18)', fontWeight: 700 },
  navIcon: { fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' as const },
  groupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px 4px', fontSize: 10, fontWeight: 800,
    color: '#545d82', textTransform: 'uppercase', letterSpacing: '0.8px',
    cursor: 'pointer', userSelect: 'none',
  },
  sidebarBottom: { padding: '16px', borderTop: '1px solid #2c3356', flexShrink: 0 },
  adminInfo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  adminAvatar: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg,#6c5ce7,#00b894)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  adminName: { fontSize: 13, fontWeight: 600, color: '#e2e6f4' },
  adminRole: { fontSize: 10, color: '#a598ff', marginTop: 2, fontWeight: 700 },
  logoutBtn: {
    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid #2c3356',
    color: '#8891b4', padding: '8px', borderRadius: 9, fontSize: 12, cursor: 'pointer',
  },
  main: { flex: 1, minHeight: '100vh' },
  topbar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 },
  pageTitle: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  pageSub: { fontSize: 12, color: 'var(--text3)', marginTop: 3 },
  refreshBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 },
  kpiCard: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
    padding: '20px', position: 'relative', overflow: 'hidden',
    boxShadow: 'var(--shadow)',
  },
  kpiBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0' },
  kpiTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  kpiLabel: { fontSize: 12, color: 'var(--text3)', fontWeight: 600 },
  kpiIcon: { width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 },
  kpiValue: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1 },
  kpiSub: { fontSize: 11, color: 'var(--text3)', marginTop: 6 },
  chartCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow)' },
  chartHeader: { marginBottom: 16 },
  chartTitle: { fontSize: 14, fontWeight: 700 },
  chartSub: { fontSize: 11, color: 'var(--text3)', marginTop: 3 },
  emptyChart: { height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 },
  tableCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' },
  tableHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, color: 'var(--text)' },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' },
  codeTag: { background: 'rgba(124,107,255,0.15)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 },
  roleBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  platformTag: { padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  searchInput: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, outline: 'none',
  },
  addBtn: {
    background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff',
    padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
    boxShadow: '0 4px 16px rgba(124,107,255,0.3)', cursor: 'pointer',
  },
  formCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 },
  formTitle: { fontSize: 14, fontWeight: 700, marginBottom: 16 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    width: '100%', padding: '9px 12px', background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)',
    fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const,
  },
  saveBtn: {
    background: 'var(--accent)', border: 'none', color: '#fff',
    padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btn: {
    border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '10px 20px',
  },
  miniBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  filterSelect: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '8px 12px', borderRadius: 9, fontSize: 12, outline: 'none', cursor: 'pointer',
  },
  presetBtn: {
    padding: '7px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  presetActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  tabBtn:    { padding: '10px 20px', background: 'transparent', border: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  msgBox: { borderRadius: 10, padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  msgOk: { background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.3)', color: 'var(--green)' },
  msgErr: { background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', color: 'var(--red)' },
}
