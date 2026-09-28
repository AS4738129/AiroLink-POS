import { it, expect } from 'vitest'
import { allowed } from './permissions'
it('cashier can sell but not edit products', () => { expect(allowed('pos', 'cashier')).toBe(true); expect(allowed('editProducts', 'cashier')).toBe(false) })
it('inventory officer cannot sell', () => expect(allowed('pos', 'inventory_officer')).toBe(false))
it('sales history is visible to operational and accounting roles but not inventory officers', () => {
  for (const r of ['owner', 'manager', 'cashier', 'accountant'] as const) expect(allowed('salesHistory', r)).toBe(true)
  expect(allowed('salesHistory', 'inventory_officer')).toBe(false)
})
it('only owners/managers/super admins may void; cashiers may not', () => {
  for (const r of ['super_admin', 'owner', 'manager'] as const) expect(allowed('voidSales', r)).toBe(true)
  for (const r of ['cashier', 'accountant', 'inventory_officer'] as const) expect(allowed('voidSales', r)).toBe(false)
})
