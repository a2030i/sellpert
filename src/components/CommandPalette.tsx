import { useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  Search, LayoutDashboard, Tags, Package, Megaphone, FileText,
  Link2, Settings, Boxes, LifeBuoy, Bell, Building2, MessageCircle,
  ListChecks, Activity, History, ShieldCheck, Users,
} from 'lucide-react'
import type { Merchant } from '../lib/supabase'
import { hasMerchantPermission, type MerchantPermissionKey } from '../lib/merchantPermissions'

type Cmd = {
  id: string
  label: string
  hint?: string
  Icon: any
  action: () => void
  group: 'navigation' | 'product' | 'merchant' | 'action'
}

interface Props {
  isAdmin?: boolean
  merchant?: Merchant | null
  onNavigate: (path: string) => void
}

type MerchantCommand = Cmd & { permission?: MerchantPermissionKey }

export default function CommandPalette({ isAdmin, merchant, onNavigate }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [searchResults, setSearchResults] = useState<Cmd[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Static commands
  const staticCmds = useMemo<Cmd[]>(() => {
    const merchantNav: MerchantCommand[] = [
      { id: 'nav-dashboard', label: 'مركز القرارات', Icon: LayoutDashboard, group: 'navigation', permission: 'dashboard', action: () => onNavigate('/dashboard') },
      { id: 'nav-notifications', label: 'مركز المتابعة', Icon: Bell, group: 'navigation', permission: 'dashboard', action: () => onNavigate('/notifications') },
      { id: 'nav-actions', label: 'خطة العمل', Icon: ListChecks, group: 'navigation', permission: 'dashboard', action: () => onNavigate('/actions') },
      { id: 'nav-orders', label: 'الطلبات', Icon: Package, group: 'navigation', permission: 'orders', action: () => onNavigate('/orders') },
      { id: 'nav-customers', label: 'خدمة العملاء', Icon: MessageCircle, group: 'navigation', permission: 'customers', action: () => onNavigate('/customers') },
      { id: 'nav-products', label: 'المنتجات', Icon: Tags, group: 'navigation', permission: 'products', action: () => onNavigate('/products') },
      { id: 'nav-inventory', label: 'المخزون', Icon: Boxes, group: 'navigation', permission: 'inventory', action: () => onNavigate('/inventory') },
      { id: 'nav-quick', label: 'تحديث المخزون السريع', hint: 'تعديل الكميات مباشرة', Icon: Boxes, group: 'navigation', permission: 'inventory', action: () => onNavigate('/quick-inventory') },
      { id: 'nav-statement', label: 'الأرباح والتحصيل', Icon: FileText, group: 'navigation', permission: 'statement', action: () => onNavigate('/statement') },
      { id: 'nav-marketing', label: 'الإعلانات والأداء', Icon: Megaphone, group: 'navigation', permission: 'marketing', action: () => onNavigate('/marketing') },
      { id: 'nav-status', label: 'حالة المتجر', Icon: Activity, group: 'navigation', permission: 'integrations', action: () => onNavigate('/store-status') },
      { id: 'nav-activity', label: 'سجل النشاط', Icon: History, group: 'navigation', permission: 'settings', action: () => onNavigate('/activity') },
      { id: 'nav-security', label: 'الأمان والجلسات', Icon: ShieldCheck, group: 'navigation', permission: 'settings', action: () => onNavigate('/security') },
      { id: 'nav-integrations', label: 'الربط ورفع الملفات', Icon: Link2, group: 'navigation', permission: 'integrations', action: () => onNavigate('/integrations') },
      { id: 'nav-team', label: 'الفريق والصلاحيات', Icon: Users, group: 'navigation', permission: 'team', action: () => onNavigate('/team') },
      { id: 'nav-settings', label: 'إعدادات المتجر', Icon: Settings, group: 'navigation', permission: 'settings', action: () => onNavigate('/settings') },
      { id: 'nav-requests', label: 'الدعم ومركز المعرفة', Icon: LifeBuoy, group: 'navigation', action: () => onNavigate('/requests') },
    ]
    const adminNav: Cmd[] = [
      { id: 'a-overview', label: 'لوحة الأدمن', Icon: LayoutDashboard, group: 'navigation', action: () => onNavigate('/admin/overview') },
      { id: 'a-merchants', label: 'التجار', Icon: Building2, group: 'navigation', action: () => onNavigate('/admin/merchants') },
      { id: 'a-team', label: 'لوحة الفريق', hint: 'KPIs داخلية', Icon: LayoutDashboard, group: 'navigation', action: () => onNavigate('/admin/team') },
      { id: 'a-import', label: 'استيراد ملفات المنصات', Icon: FileText, group: 'navigation', action: () => onNavigate('/admin/import') },
      { id: 'a-tasks', label: 'مهام الفريق', Icon: LifeBuoy, group: 'navigation', action: () => onNavigate('/admin/tasks') },
      { id: 'a-whatsapp', label: 'إدارة الواتساب', Icon: Megaphone, group: 'navigation', action: () => onNavigate('/admin/whatsapp') },
      { id: 'a-audit', label: 'سجل التدقيق', Icon: FileText, group: 'navigation', action: () => onNavigate('/admin/audit') },
    ]
    if (isAdmin) return adminNav
    return merchantNav.filter(command => !command.permission || hasMerchantPermission(merchant, command.permission))
  }, [isAdmin, merchant, onNavigate])

  // Dynamic search (products / merchants)
  useEffect(() => {
    let cancelled = false
    if (q.length < 2) { setSearchResults([]); return }

    const handle = setTimeout(async () => {
      const out: Cmd[] = []
      if (isAdmin) {
        // Search merchants
        const { data: ms } = await supabase.from('merchants')
          .select('merchant_code,name,email').or(`name.ilike.%${q}%,merchant_code.ilike.%${q}%,email.ilike.%${q}%`)
          .limit(6)
        for (const m of ms || []) {
          out.push({
            id: 'm-' + m.merchant_code, label: m.name || m.merchant_code, hint: m.merchant_code,
            Icon: Building2, group: 'merchant',
            action: () => onNavigate('/admin/merchants?code=' + m.merchant_code),
          })
        }
      }
      // Search products (by merchant scope or all if admin)
      const productQuery = supabase.from('products').select('id,sku,name_ar,name,merchant_code')
        .or(`sku.ilike.%${q}%,name_ar.ilike.%${q}%,name.ilike.%${q}%`).limit(6)
      if (!isAdmin && merchant?.merchant_code) productQuery.eq('merchant_code', merchant.merchant_code)
      const { data: ps } = await productQuery
      for (const p of ps || []) {
        out.push({
          id: 'p-' + p.id, label: p.name_ar || p.name || p.sku, hint: p.sku,
          Icon: Tags, group: 'product',
          action: () => onNavigate('/product-detail?id=' + p.id),
        })
      }
      if (!cancelled) setSearchResults(out)
    }, 220)

    return () => { cancelled = true; clearTimeout(handle) }
  }, [q, isAdmin, merchant?.merchant_code, onNavigate])

  // Cmd+K listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Filter & combine
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let base = staticCmds
    if (ql) base = staticCmds.filter(c => c.label.toLowerCase().includes(ql))
    return [...base, ...searchResults]
  }, [q, staticCmds, searchResults])

  useEffect(() => { setActiveIdx(0) }, [filtered.length])

  function pick(c: Cmd) {
    c.action()
    setOpen(false)
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[activeIdx]
      if (c) pick(c)
    }
  }

  if (!open) return null

  // Group results
  const groups: Record<string, Cmd[]> = {}
  filtered.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c) })
  const groupOrder: Array<keyof typeof GROUP_LABELS> = ['navigation', 'merchant', 'product', 'action']
  const GROUP_LABELS = { navigation: 'التنقل', merchant: 'تجار', product: 'منتجات', action: 'إجراءات' }

  let runningIdx = -1

  return (
    <div onClick={() => setOpen(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,18,40,0.55)',
      backdropFilter: 'blur(4px)', zIndex: 10001,
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 96, padding: '96px 16px',
    }}>
      <div role="dialog" aria-modal="true" aria-label="البحث السريع" onClick={e => e.stopPropagation()} onKeyDown={onListKey} style={{
        width: '100%', maxWidth: 580, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      }}>
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} color="var(--text3)" />
          <input
            ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="ابحث عن صفحة، منتج، أو تاجر..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }} />
          <kbd style={{ fontSize: 10, padding: '2px 6px', background: 'var(--surface2)', borderRadius: 5, color: 'var(--text3)' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              لا توجد نتائج
            </div>
          )}
          {groupOrder.map(g => {
            if (!groups[g]?.length) return null
            return (
              <div key={g}>
                <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {GROUP_LABELS[g]}
                </div>
                {groups[g].map(c => {
                  runningIdx++
                  const isActive = runningIdx === activeIdx
                  const Icon = c.Icon
                  return (
                    <div key={c.id} onClick={() => pick(c)} onMouseEnter={() => setActiveIdx(runningIdx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                        cursor: 'pointer',
                        background: isActive ? 'rgba(108,92,231,0.12)' : 'transparent',
                        borderRight: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                      }}>
                      <Icon size={16} color={isActive ? 'var(--accent)' : 'var(--text2)'} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                        {c.hint && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{c.hint}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text3)', display: 'flex', justifyContent: 'space-between' }}>
          <span>↑↓ للتنقل · ⏎ للاختيار</span>
          <span>Ctrl+K للفتح</span>
        </div>
      </div>
    </div>
  )
}
