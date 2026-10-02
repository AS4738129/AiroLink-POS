import { describe, it, expect } from 'vitest'
import { accessSummary, roleText, staffDisplayName } from './users'
import { allowed } from './permissions'

describe('staff display helpers', () => {
  it('labels owner as Admin and prettifies other roles without touching stored values', () => {
    expect(roleText('owner')).toBe('Admin')
    expect(roleText('super_admin')).toBe('super admin')
    expect(roleText('inventory_officer')).toBe('inventory officer')
    expect(roleText('cashier')).toBe('cashier')
  })
  it('prefers the profile name and falls back to a short user id', () => {
    expect(staffDisplayName('  Ama Serwaa  ', 'user-12345678')).toBe('Ama Serwaa')
    expect(staffDisplayName(null, 'user-12345678')).toBe('user-123')
    expect(staffDisplayName('   ', 'user-12345678')).toBe('user-123')
  })
  it('summarizes branch access: zero assignments means unrestricted', () => {
    expect(accessSummary([])).toBe('All branches (unrestricted)')
    expect(accessSummary(['Accra'])).toBe('Accra')
    expect(accessSummary(['Accra', 'Kumasi'])).toBe('2 assigned')
  })
})

describe('users roster visibility', () => {
  it('is visible to every application role (membership-gated reads stay enforced by RLS)', () => {
    for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
      expect(allowed('users', r)).toBe(true)
    }
    expect(allowed('users', undefined)).toBe(false)
  })
})
