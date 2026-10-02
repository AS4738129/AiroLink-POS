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
it('expenses and financial reports exclude cashiers and inventory officers; managers cannot delete expenses', () => {
  for (const r of ['super_admin', 'owner', 'manager', 'accountant'] as const) {
    expect(allowed('expenses', r)).toBe(true); expect(allowed('editExpenses', r)).toBe(true); expect(allowed('reports', r)).toBe(true)
  }
  for (const r of ['cashier', 'inventory_officer'] as const) {
    expect(allowed('expenses', r)).toBe(false); expect(allowed('editExpenses', r)).toBe(false); expect(allowed('reports', r)).toBe(false)
  }
  for (const r of ['super_admin', 'owner', 'accountant'] as const) expect(allowed('deleteExpenses', r)).toBe(true)
  expect(allowed('deleteExpenses', 'manager')).toBe(false)
  expect(allowed('deleteExpenses', 'cashier')).toBe(false)
})
it('data management shell is visible to every role; datasets stay gated inside', () => {
  for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
    expect(allowed('dataManagement', r)).toBe(true)
  }
  expect(allowed('dataManagement', undefined)).toBe(false)
})
it('business settings shell is visible to every role; editing stays gated inside', () => {
  for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
    expect(allowed('settings', r)).toBe(true)
  }
  expect(allowed('settings', undefined)).toBe(false)
})
it('only owners/managers/super admins may void; cashiers may not', () => {
  for (const r of ['super_admin', 'owner', 'manager'] as const) expect(allowed('voidSales', r)).toBe(true)
  for (const r of ['cashier', 'accountant', 'inventory_officer'] as const) expect(allowed('voidSales', r)).toBe(false)
})
it('branches are viewable by every role; only owner/super_admin edit branch records', () => {
  for (const r of ['super_admin', 'owner', 'manager', 'cashier', 'inventory_officer', 'accountant'] as const) {
    expect(allowed('branches', r)).toBe(true)
  }
  expect(allowed('branches', undefined)).toBe(false)
  for (const r of ['super_admin', 'owner'] as const) expect(allowed('editBranches', r)).toBe(true)
  for (const r of ['manager', 'cashier', 'accountant', 'inventory_officer'] as const) expect(allowed('editBranches', r)).toBe(false)
})
it('managers may manage branch assignments; other non-owner roles may not', () => {
  for (const r of ['super_admin', 'owner', 'manager'] as const) expect(allowed('assignBranches', r)).toBe(true)
  for (const r of ['cashier', 'accountant', 'inventory_officer'] as const) expect(allowed('assignBranches', r)).toBe(false)
})
