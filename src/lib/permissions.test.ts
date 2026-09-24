import { it, expect } from 'vitest'
import { allowed } from './permissions'
it('cashier can sell but not edit products', () => { expect(allowed('pos', 'cashier')).toBe(true); expect(allowed('editProducts', 'cashier')).toBe(false) })
it('inventory officer cannot sell', () => expect(allowed('pos', 'inventory_officer')).toBe(false))
