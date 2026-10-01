import { describe, expect, it } from 'vitest'
import {
  cogsTotal,
  expenseByCategory,
  grossProfit,
  incomeStatement,
  inventoryValuation,
  netProfit,
  sumMoney,
} from './finance'

describe('sumMoney', () => {
  it('sums sales totals pesewa-safe (0.1 + 0.2 style rows cannot drift)', () => {
    expect(sumMoney([{ total: 0.1 }, { total: 0.2 }], (r) => (r as { total: number }).total)).toBe(0.3)
  })
  it('sums expense amounts via the amount field', () => {
    expect(sumMoney([{ amount: 100 }, { amount: 50.5 }], (r) => (r as { amount: number }).amount)).toBe(150.5)
  })
  it('returns 0 for an empty period', () => {
    expect(sumMoney([], (r) => (r as { total: number }).total)).toBe(0)
  })
})

describe('cogsTotal', () => {
  it('uses historical snapshots: qty x cost_price per sale item', () => {
    // GHS 50 cost in January stays GHS 50 even after February repricing to 70.
    expect(cogsTotal([{ qty: 2, cost_price: 50 }, { qty: 1, cost_price: 70 }])).toBe(170)
  })
  it('returns 0 with no items sold', () => {
    expect(cogsTotal([])).toBe(0)
  })
  it('tolerates string numerics from the database driver', () => {
    expect(cogsTotal([{ qty: '2', cost_price: '50' }])).toBe(100)
  })
})

describe('profit math', () => {
  it('gross = revenue - COGS (10,000 - 6,000 = 4,000)', () => {
    expect(grossProfit(10000, 6000)).toBe(4000)
  })
  it('net = gross - expenses (4,000 - 1,500 = 2,500)', () => {
    expect(netProfit(4000, 1500)).toBe(2500)
  })
  it('incomeStatement combines all four lines', () => {
    expect(incomeStatement({ revenue: 10000, cogs: 6000, expenses: 1500 })).toEqual({
      revenue: 10000, cogs: 6000, gross: 4000, expenses: 1500, net: 2500,
    })
  })
  it('a below-cost sale yields negative gross (real information, not an error)', () => {
    expect(grossProfit(100, 150)).toBe(-50)
  })
})

describe('inventoryValuation', () => {
  it('values current quantity x current cost (100 units x GHS 20 = GHS 2,000)', () => {
    expect(inventoryValuation([{ stock_qty: 100, cost_price: 20 }])).toBe(2000)
  })
  it('sums across products', () => {
    expect(
      inventoryValuation([
        { stock_qty: 10, cost_price: 5 },
        { stock_qty: 3, cost_price: 100 },
      ]),
    ).toBe(350)
  })
  it('returns 0 for empty stock', () => {
    expect(inventoryValuation([])).toBe(0)
  })
})

describe('expenseByCategory', () => {
  it('groups by category, highest spend first', () => {
    const out = expenseByCategory(
      [
        { amount: 100, expense_date: '2026-09-01', category_id: 'rent' },
        { amount: 50, expense_date: '2026-09-02', category_id: 'util' },
        { amount: 200, expense_date: '2026-09-03', category_id: 'rent' },
      ],
      (id) => (id === 'rent' ? 'Rent' : 'Utilities'),
    )
    expect(out).toEqual([
      { category_id: 'rent', name: 'Rent', total: 300, count: 2 },
      { category_id: 'util', name: 'Utilities', total: 50, count: 1 },
    ])
  })
  it('returns an empty breakdown for an empty period', () => {
    expect(expenseByCategory([], () => 'x')).toEqual([])
  })
})
