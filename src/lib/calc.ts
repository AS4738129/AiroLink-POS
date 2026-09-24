// Mirrors complete_sale() in SQL for the on-screen preview. The database result is authoritative.
export type Line = { price: number; qty: number; taxable: boolean }
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function cartTotals(lines: Line[], discount: number, taxRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.price * l.qty), 0))
  const taxableSum = lines.reduce((s, l) => (l.taxable ? s + r2(l.price * l.qty) : s), 0)
  const d = Math.min(Math.max(discount, 0), subtotal)
  const tax = subtotal > 0 ? r2(((taxableSum * (subtotal - d)) / subtotal) * taxRate / 100) : 0
  return { subtotal, discount: d, tax, total: r2(subtotal - d + tax) }
}
export const changeDue = (tendered: number, total: number) => r2(Math.max(tendered - total, 0))
export const creditDue = (total: number, applied: number) => r2(Math.max(total - applied, 0))
export const canExtendCredit = (balance: number, due: number, limit: number) => balance + due <= limit
