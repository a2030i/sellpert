import type { Merchant } from './supabase'

// ── Plan config ────────────────────────────────────────────────────────────────

export const PLANS = {
  salla: {
    label:    'باقة سلة',
    price:    99,
    channels: ['salla'],
    color:    '#7c6bff',
    features: ['مزامنة سلة', 'لوحة تحكم أساسية', 'كشف حساب شهري'],
  },
  growth: {
    label:    'باقة النمو',
    price:    299,
    channels: ['salla', 'amazon', 'noon', 'trendyol'],
    color:    '#00e5b0',
    features: ['كل قنوات سلة', 'أمازون + نون + تراندايول', 'تحليل AI', '3 مستخدمين'],
  },
  pro: {
    label:    'باقة المحترف',
    price:    599,
    channels: ['salla', 'amazon', 'noon', 'trendyol'],
    color:    '#ff9900',
    features: ['كل الميزات', 'تصدير PDF/Excel', 'مزامنة فورية', '10 مستخدمين'],
  },
  enterprise: {
    label:    'المؤسسات',
    price:    999,
    channels: ['salla', 'amazon', 'noon', 'trendyol'],
    color:    '#f27a1a',
    features: ['كل شيء', 'SLA مضمون', 'دعم مخصص 24/7'],
  },
  // Legacy plans (before Salla integration)
  free: {
    label:    'مجاني',
    price:    0,
    channels: ['amazon', 'noon', 'trendyol'],
    color:    '#5a5a7a',
    features: ['ربط يدوي', 'لوحة تحكم أساسية'],
  },
}

export type PlanKey = keyof typeof PLANS

// ── Guards ────────────────────────────────────────────────────────────────────

export function isActive(merchant: Merchant | null): boolean {
  if (!merchant) return false
  // Admin/employee always active
  if (['admin', 'super_admin', 'employee'].includes(merchant.role)) return true
  return (merchant.subscription_status ?? 'active') === 'active'
}

export function isSuspended(merchant: Merchant | null): boolean {
  if (!merchant) return false
  if (['admin', 'super_admin', 'employee'].includes(merchant.role)) return false
  return merchant.subscription_status === 'suspended'
}

export function canAccessChannel(merchant: Merchant | null, channel: string): boolean {
  if (!merchant) return false
  if (['admin', 'super_admin', 'employee'].includes(merchant.role)) return true
  if (!isActive(merchant)) return false
  const plan = (merchant.subscription_plan as PlanKey) || 'free'
  const cfg  = PLANS[plan] || PLANS.free
  return cfg.channels.includes(channel)
}

export function getPlan(merchant: Merchant | null): typeof PLANS[PlanKey] {
  if (!merchant) return PLANS.free
  const plan = (merchant.subscription_plan as PlanKey) || 'free'
  return PLANS[plan] || PLANS.free
}

export function getUpgradePlan(current: PlanKey): PlanKey | null {
  const order: PlanKey[] = ['free', 'salla', 'growth', 'pro', 'enterprise']
  const idx = order.indexOf(current)
  if (idx < 0 || idx >= order.length - 1) return null
  return order[idx + 1]
}
