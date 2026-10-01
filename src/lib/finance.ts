// Pure Phase 5 financial math (display-only aggregation over rows already fetched).
// The database is authoritative: revenue comes from persisted sales.total,
// purchases from purchases.total (received only), COGS from persisted
// sale_items.qty x sale_items.cost_price snapshots (historical cost — never the
// current products.cost_price), and inventory valuation from
// branch_inventory.stock_qty x products.cost_price. RLS stays the security boundary.
import { r2 } from './calc'

export type CogsItem = { qty: number | string; cost_price: number | string }
export type MoneyRow = { total: number | string } | { amount: number | string }
export type ExpensePoint = { amount: number | string; expense_date: string; category_id: string }
export type StockValRow = { stock_qty: number | string; cost_price: number | string }

const num = (v: number | string) => Number(v) || 0

// Sum of sales/purchase totals or expense amounts in minor-unit-safe order
// (same pesewa-safe pattern as Dashboard's sumTotals).
export function sumMoney(rows: MoneyRow[], pick: (r: MoneyRow) => number | string): number {
  return Math.round(rows.reduce((s, r) => s + Math.round(num(pick(r)) * 100), 0)) / 100
}

// Cost of goods sold: quantity sold x HISTORICAL unit cost per sale item.
// Each sale_items.cost_price was snapshotted by complete_sale() at checkout, so a
// later receive_purchase() cost-stamp never rewrites history.
export function cogsTotal(items: CogsItem[]): number {
  return r2(items.reduce((s, it) => s + num(it.qty) * num(it.cost_price), 0))
}

// Revenue - COGS. May be negative when items sell below cost — real information.
export const grossProfit = (revenue: number, cogs: number) => r2(revenue - cogs)

// Gross profit - expenses.
export const netProfit = (gross: number, expenses: number) => r2(gross - expenses)

// Full Phase 5 income statement from the four authoritative inputs.
export function incomeStatement(args: { revenue: number; cogs: number; expenses: number }) {
  const gross = grossProfit(args.revenue, args.cogs)
  return { revenue: r2(args.revenue), cogs: r2(args.cogs), gross, expenses: r2(args.expenses), net: netProfit(gross, args.expenses) }
}

// Current inventory value: current quantity x CURRENT cost per product.
// (Valuation is a present-tense snapshot; COGS above is the historical one.)
export function inventoryValuation(rows: StockValRow[]): number {
  return r2(rows.reduce((s, r) => s + num(r.stock_qty) * num(r.cost_price), 0))
}

export type CategorySlice = { category_id: string; name: string; total: number; count: number }

// Expense totals grouped by category, highest spend first.
export function expenseByCategory(
  points: ExpensePoint[],
  nameOf: (id: string) => string,
): CategorySlice[] {
  const by = new Map<string, { total: number; count: number }>()
  for (const p of points) {
    const e = by.get(p.category_id) ?? { total: 0, count: 0 }
    e.total = r2(e.total + num(p.amount))
    e.count += 1
    by.set(p.category_id, e)
  }
  return [...by]
    .map(([category_id, e]) => ({ category_id, name: nameOf(category_id), total: e.total, count: e.count }))
    .sort((a, b) => b.total - a.total)
}
