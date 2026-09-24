import { describe, it, expect } from 'vitest'
import { cartTotals, changeDue, creditDue, canExtendCredit } from './calc'
describe('cartTotals', () => {
  it('sums lines', () => expect(cartTotals([{ price: 10.5, qty: 2, taxable: false }], 0, 0).total).toBe(21))
  it('applies discount before tax', () => {
    expect(cartTotals([{ price: 100, qty: 1, taxable: true }], 20, 15)).toEqual({ subtotal: 100, discount: 20, tax: 12, total: 92 })
  })
  it('taxes only taxable lines', () => expect(cartTotals([{ price: 100, qty: 1, taxable: true }, { price: 100, qty: 1, taxable: false }], 0, 10).tax).toBe(10))
  it('caps discount at subtotal', () => expect(cartTotals([{ price: 5, qty: 1, taxable: true }], 99, 10).total).toBe(0))
})
describe('payment and credit', () => {
  it('change', () => expect(changeDue(100, 92)).toBe(8))
  it('credit for unpaid remainder', () => expect(creditDue(92, 50)).toBe(42))
  it('credit limit', () => { expect(canExtendCredit(100, 42, 150)).toBe(true); expect(canExtendCredit(100, 60, 150)).toBe(false) })
})
