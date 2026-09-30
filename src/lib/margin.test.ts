import { describe, it, expect } from 'vitest'
import { lineProfit, lineMarginPct, cartMargin } from './margin'

describe('line profit and margin', () => {
  it('profit is (price - cost) x qty', () => {
    expect(lineProfit({ cost: 70, price: 100, qty: 2 })).toBe(60)
  })
  it('margin % is profit / revenue x 100', () => {
    expect(lineMarginPct({ cost: 70, price: 100, qty: 2 })).toBe(30)
  })
  it('zero or null selling price is safe (no division by zero, no NaN)', () => {
    expect(lineMarginPct({ cost: 70, price: 0, qty: 2 })).toBe(0)
    expect(lineMarginPct({ cost: 0, price: 0, qty: 1 })).toBe(0)
  })
  it('selling below cost reports a negative profit and margin', () => {
    expect(lineProfit({ cost: 100, price: 80, qty: 1 })).toBe(-20)
    expect(lineMarginPct({ cost: 100, price: 80, qty: 1 })).toBe(-25)
  })
  it('a free item (zero cost) has 100% margin', () => {
    expect(lineMarginPct({ cost: 0, price: 50, qty: 1 })).toBe(100)
  })
})

describe('cart margin with discount', () => {
  it('discount reduces revenue before profit is computed', () => {
    // 2 x 100 selling, 2 x 70 cost, 20 discount: revenue 180, cost 140, profit 40, margin 22.22%
    const m = cartMargin([{ cost: 70, price: 100, qty: 2 }], 20)
    expect(m).toEqual({ subtotal: 200, discount: 20, revenue: 180, cost: 140, profit: 40, marginPct: 22.22 })
  })
  it('caps the discount at the subtotal and stays finite on an empty cart', () => {
    expect(cartMargin([{ cost: 70, price: 100, qty: 1 }], 500).revenue).toBe(0)
    expect(cartMargin([], 0)).toEqual({ subtotal: 0, discount: 0, revenue: 0, cost: 0, profit: 0, marginPct: 0 })
  })
})
