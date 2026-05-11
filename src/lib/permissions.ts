// Centralized permission definitions and helpers.
// Each employee's `merchants.permissions` (jsonb) stores an array of permission keys.

import type { Merchant } from './supabase'

export type PermKey =
  // Merchants
  | 'view_merchants' | 'edit_merchants' | 'create_merchants' | 'delete_merchants' | 'impersonate'
  // Files
  | 'view_files' | 'upload_files' | 'delete_files'
  // Finance
  | 'view_finance' | 'edit_billing' | 'view_revenue' | 'manage_subscriptions'
  // Operations
  | 'tasks' | 'crm' | 'whatsapp_send' | 'whatsapp_bulk' | 'manage_inbound' | 'manage_ads'
  // System
  | 'view_audit' | 'view_db_health' | 'create_staff'

export type Department = 'finance' | 'data_entry' | 'support' | 'marketing' | 'operations' | 'manager' | 'custom'

export const ALL_PERMISSIONS: { key: PermKey; label: string; category: string }[] = [
  // Merchants
  { key: 'view_merchants',     label: 'عرض قائمة التجار',         category: 'تجار' },
  { key: 'edit_merchants',     label: 'تعديل بيانات التجار',       category: 'تجار' },
  { key: 'create_merchants',   label: 'إضافة تجار جدد',           category: 'تجار' },
  { key: 'delete_merchants',   label: 'حذف تجار / مسح بياناتهم',   category: 'تجار' },
  { key: 'impersonate',        label: 'الدخول كحساب تاجر (عرض)',   category: 'تجار' },

  // Files
  { key: 'view_files',         label: 'عرض الملفات المرفوعة',       category: 'ملفات' },
  { key: 'upload_files',       label: 'رفع ملفات للتجار',          category: 'ملفات' },
  { key: 'delete_files',       label: 'حذف ملفات',                 category: 'ملفات' },

  // Finance
  { key: 'view_finance',       label: 'عرض البيانات المالية',       category: 'مالية' },
  { key: 'edit_billing',       label: 'تعديل الفواتير والمدفوعات',   category: 'مالية' },
  { key: 'view_revenue',       label: 'عرض إيرادات Sellpert',      category: 'مالية' },
  { key: 'manage_subscriptions', label: 'إيقاف/تفعيل اشتراكات',     category: 'مالية' },

  // Operations
  { key: 'tasks',              label: 'إدارة المهام والمتابعات',     category: 'تشغيلي' },
  { key: 'crm',                label: 'ملاحظات على التجار',        category: 'تشغيلي' },
  { key: 'whatsapp_send',      label: 'واتساب لتاجر واحد',         category: 'تشغيلي' },
  { key: 'whatsapp_bulk',      label: 'واتساب جماعي',              category: 'تشغيلي' },
  { key: 'manage_inbound',     label: 'إدارة الإرساليات والشحن',    category: 'تشغيلي' },
  { key: 'manage_ads',         label: 'إدارة الإعلانات والحملات',   category: 'تشغيلي' },

  // System
  { key: 'view_audit',         label: 'سجل التدقيق',               category: 'نظام' },
  { key: 'view_db_health',     label: 'صحة قاعدة البيانات',         category: 'نظام' },
  { key: 'create_staff',       label: 'إضافة موظفين',              category: 'نظام' },
]

export const PERM_CATEGORIES = ['تجار', 'ملفات', 'مالية', 'تشغيلي', 'نظام']

// Department starter templates — admin can customize after applying
export const DEPT_TEMPLATES: Record<Department, PermKey[]> = {
  manager:    ALL_PERMISSIONS.map(p => p.key),  // all
  finance:    ['view_merchants', 'impersonate', 'view_finance', 'edit_billing', 'view_revenue', 'manage_subscriptions', 'crm', 'whatsapp_send'],
  data_entry: ['view_merchants', 'edit_merchants', 'create_merchants', 'impersonate', 'view_files', 'upload_files', 'delete_files', 'crm'],
  support:    ['view_merchants', 'impersonate', 'tasks', 'crm', 'whatsapp_send'],
  marketing:  ['view_merchants', 'impersonate', 'crm', 'whatsapp_send', 'whatsapp_bulk', 'manage_ads', 'view_files'],
  operations: ['view_merchants', 'impersonate', 'view_files', 'upload_files', 'crm', 'tasks', 'manage_inbound'],
  custom:     [],
}

export const DEPT_LABELS: Record<Department, string> = {
  manager:    'مدير (كل الصلاحيات)',
  finance:    'مالية',
  data_entry: 'مدخل بيانات',
  support:    'دعم فني',
  marketing:  'تسويق',
  operations: 'عمليات',
  custom:     'مخصّص',
}

export function getPermissions(m: Merchant | null | undefined): Set<PermKey> {
  if (!m) return new Set()
  // Admin role always has all permissions (managers)
  if (m.role === 'admin') return new Set(ALL_PERMISSIONS.map(p => p.key))
  // Merchants don't use this system
  if (m.role === 'merchant') return new Set()
  // Employees: use stored permissions array (jsonb)
  const arr = (m as any).permissions
  if (Array.isArray(arr)) return new Set(arr as PermKey[])
  return new Set()
}

export function hasPermission(m: Merchant | null | undefined, key: PermKey): boolean {
  return getPermissions(m).has(key)
}
