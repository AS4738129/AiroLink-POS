import { r2 } from './calc'

// Pure profit/margin math for the POS cart preview (display only — the database is
// authoritative: complete_sale() snapshots cost_price per sale item, and
// receive_purchase() stamps last-purchase-price onto products.cost_price).
// Revenue here is the discounted selling total, so the preview matches what the
// sale will actually earn. Never affects the sale itself.
export type MarginLine = { cost: number; price: number; qty: number }

// Profit on one line before any cart discount: (price - cost) x qty. May be
// negative when an item sells below cost — that is real information, not an error.
export const lineProfit = (l: MarginLine) => r2((l.price - l.cost) * l.qty)

// Margin % on one line: profit / revenue x 100. Zero/null selling prices are safe:
// a line with no revenue has no meaningful margin, so it reports 0 (never NaN).
export function lineMarginPct(l: MarginLine): number {
  const revenue = r2(l.price * l.qty)
  return revenue > 0 ? r2((lineProfit(l) / revenue) * 100) : 0
}

export function cartMargin(lines: MarginLine[], discount: number) {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.price * l.qty), 0))
  const d = Math.min(Math.max(discount, 0), subtotal)
  const revenue = r2(subtotal - d)
  const cost = r2(lines.reduce((s, l) => s + r2(l.cost * l.qty), 0))
  const profit = r2(revenue - cost)
  return { subtotal, discount: d, revenue, cost, profit, marginPct: revenue > 0 ? r2((profit / revenue) * 100) : 0 }
}
