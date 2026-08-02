import { describe, expect, it } from 'vitest'
import { getPermissions, hasPermission } from '../permissions'
import type { Merchant } from '../supabase'

function account(role: Merchant['role'], permissions: Merchant['permissions']): Merchant {
  return { role, permissions } as Merchant
}

describe('platform administration permissions', () => {
  it('grants managers the complete administration permission set', () => {
    expect(hasPermission(account('admin', []), 'create_staff')).toBe(true)
    expect(hasPermission(account('super_admin', []), 'delete_merchants')).toBe(true)
  })

  it('grants platform staff only stored array permissions', () => {
    const staff = account('staff', ['view_merchants', 'tasks'])
    expect(hasPermission(staff, 'view_merchants')).toBe(true)
    expect(hasPermission(staff, 'tasks')).toBe(true)
    expect(hasPermission(staff, 'view_finance')).toBe(false)
  })

  it('never interprets merchant employee permissions as platform permissions', () => {
    const employee = account('employee', ['view_merchants', 'create_staff'])
    expect(getPermissions(employee).size).toBe(0)
    expect(hasPermission(employee, 'create_staff')).toBe(false)
  })
})
