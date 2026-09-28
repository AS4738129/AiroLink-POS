import { describe, it, expect } from 'vitest'
import { cartTotals } from './calc'
import { methodLabel, paymentSummary, paymentsPayload, METHODS } from './payments'
describe('totals (display preview of the server calculation)', () => {
  it('matches the spec example: 2×95 + 1×35 at 15% tax = 258.75', () => {
    const t = cartTotals([{ price: 95, qty: 2, taxable: true }, { price: 35, qty: 1, taxable: true }], 0, 15)
    expect(t).toEqual({ subtotal: 225, discount: 0, tax: 33.75, total: 258.75 })
  })
  it('taxes only taxable lines and never lets the discount exceed the subtotal', () => {
    const t = cartTotals([{ price: 100, qty: 1, taxable: true }, { price: 100, qty: 1, taxable: false }], 500, 10)
    expect(t.discount).toBe(200); expect(t.total).toBe(0)
  })
})
describe('payments', () => {
  it('supports cash, momo, card and bank with consistent labels', () => {
    expect(METHODS.map(([v]) => v)).toEqual(expect.arrayContaining(['cash', 'momo', 'card', 'bank']))
    expect(methodLabel('momo')).toBe('Mobile Money'); expect(methodLabel('bank')).toBe('Bank Transfer')
  })
  it('split payment: 200 cash + 300 momo covers 500 with nothing remaining', () => {
    const s = paymentSummary([{ method: 'cash', amount: 200 }, { method: 'momo', amount: 300 }], 500)
    expect(s.applied).toBe(500); expect(s.remaining).toBe(0); expect(s.overpaid).toBe(false)
  })
  it('underpayment leaves a remainder that must go on credit', () => {
    expect(paymentSummary([{ method: 'cash', amount: 60 }], 110).remaining).toBe(50)
  })
  it('cash change: total 85, cash received 100 → change 15 (change is not a payment)', () => {
    const lines = [{ method: 'cash' as const, amount: 85 }]
    expect(paymentSummary(lines, 85, 100).change).toBe(15)
    expect(paymentsPayload(lines)).toEqual([{ method: 'cash', amount: 85 }])
  })
  it('flags overpayment and drops empty or negative lines from the payload', () => {
    expect(paymentSummary([{ method: 'card', amount: 120 }], 100).overpaid).toBe(true)
    expect(paymentsPayload([{ method: 'cash', amount: 0 }, { method: 'cash', amount: -5 }, { method: 'card', amount: 10 }])).toEqual([{ method: 'card', amount: 10 }])
  })
})
