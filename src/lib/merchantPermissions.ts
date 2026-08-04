import type { Merchant } from './supabase'

export type MerchantPermissionKey =
  | 'dashboard'
  | 'orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'marketing'
  | 'statement'
  | 'integrations'
  | 'settings'
  | 'team'

export const MERCHANT_PERMISSION_ITEMS: Array<{
  key: MerchantPermissionKey
  label: string
  group: 'view' | 'manage' | 'finance' | 'admin'
}> = [
  { key: 'dashboard',    label: 'نظرة عامة',          group: 'view' },
  { key: 'orders',       label: 'الطلبات',             group: 'view' },
  { key: 'customers',    label: 'خدمة العملاء',         group: 'view' },
  { key: 'products',     label: 'المنتجات',            group: 'view' },
  { key: 'inventory',    label: 'المخزون',             group: 'manage' },
  { key: 'marketing',    label: 'الإعلانات والأداء',   group: 'view' },
  { key: 'statement',    label: 'الأرباح والتحصيل',   group: 'finance' },
  { key: 'integrations', label: 'الربط ورفع الملفات', group: 'admin' },
  { key: 'settings',     label: 'إعدادات المتجر',      group: 'admin' },
]

export const DEFAULT_MERCHANT_PERMISSIONS: Record<MerchantPermissionKey, boolean> =
  Object.fromEntries(
    MERCHANT_PERMISSION_ITEMS.map(item => [
      item.key,
      ['dashboard', 'orders', 'products', 'inventory'].includes(item.key),
    ]),
  ) as Record<MerchantPermissionKey, boolean>

export function hasMerchantPermission(
  merchant: Merchant | null | undefined,
  permission: MerchantPermissionKey,
): boolean {
  if (!merchant || merchant.is_active === false) return false
  if (merchant.role === 'merchant' || merchant.role === 'admin' || merchant.role === 'super_admin') return true
  if (merchant.role !== 'employee') return false
  // Team ownership cannot be delegated by toggling JSON directly.
  if (permission === 'team') return false

  const stored = merchant.permissions
  if (Array.isArray(stored)) return stored.includes(permission)
  return stored?.[permission] === true
}
