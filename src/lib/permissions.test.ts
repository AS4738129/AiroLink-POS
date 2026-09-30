import { describe, it, expect } from 'vitest'
import { allowed } from './permissions'
describe('dashboard navigation', () => {
  it('is visible to every application role and grants no data access by itself', () => {
    for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
      expect(allowed('dashboard', r)).toBe(true)
    }
    expect(allowed('dashboard', undefined)).toBe(false)
  })
})
it('cashier can sell but not edit products', () => { expect(allowed('pos', 'cashier')).toBe(true); expect(allowed('editProducts', 'cashier')).toBe(false) })
it('inventory officer cannot sell', () => expect(allowed('pos', 'inventory_officer')).toBe(false))
it('sales history is visible to operational and accounting roles but not inventory officers', () => {
  for (const r of ['owner', 'manager', 'cashier', 'accountant'] as const) expect(allowed('salesHistory', r)).toBe(true)
  expect(allowed('salesHistory', 'inventory_officer')).toBe(false)
})
it('customers are visible to sales and accounting roles, edited by sales roles', () => {
  for (const r of ['owner', 'manager', 'cashier', 'accountant'] as const) expect(allowed('customers', r)).toBe(true)
  expect(allowed('customers', 'inventory_officer')).toBe(false)
  for (const r of ['owner', 'manager', 'cashier'] as const) expect(allowed('editCustomers', r)).toBe(true)
  for (const r of ['inventory_officer', 'accountant'] as const) expect(allowed('editCustomers', r)).toBe(false)
})
it('suppliers and purchases belong to purchasing roles; cashiers are excluded', () => {
  for (const r of ['owner', 'manager', 'inventory_officer', 'accountant'] as const) {
    expect(allowed('suppliers', r)).toBe(true); expect(allowed('purchases', r)).toBe(true)
  }
  expect(allowed('suppliers', 'cashier')).toBe(false); expect(allowed('purchases', 'cashier')).toBe(false)
  for (const r of ['owner', 'manager', 'inventory_officer'] as const) {
    expect(allowed('editSuppliers', r)).toBe(true); expect(allowed('editPurchases', r)).toBe(true)
  }
  for (const r of ['cashier', 'accountant'] as const) {
    expect(allowed('editSuppliers', r)).toBe(false); expect(allowed('editPurchases', r)).toBe(false)
  }
})
it('cost/profit visibility excludes cashiers and inventory officers', () => {
  for (const r of ['super_admin', 'owner', 'manager', 'accountant'] as const) expect(allowed('viewMargin', r)).toBe(true)
  for (const r of ['cashier', 'inventory_officer'] as const) expect(allowed('viewMargin', r)).toBe(false)
})
it('only owners/managers/super admins may void; cashiers may not', () => {
  for (const r of ['super_admin', 'owner', 'manager'] as const) expect(allowed('voidSales', r)).toBe(true)
  for (const r of ['cashier', 'accountant', 'inventory_officer'] as const) expect(allowed('voidSales', r)).toBe(false)
})
