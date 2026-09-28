import { r2 } from './calc'
// Payment labels used everywhere (POS, receipt, history) so they stay consistent.
export const METHODS = [['cash', 'Cash'], ['momo', 'Mobile Money'], ['card', 'Card'], ['bank', 'Bank Transfer'], ['other', 'Other']] as const
export type Method = (typeof METHODS)[number][0]
export const methodLabel = (m: string) => METHODS.find(([v]) => v === m)?.[1] ?? m
export type PayLine = { method: Method; amount: number }

// Preview only: the database validates and records the real payments.
// Each line's amount is what is applied to the bill. Cash handed over beyond
// what the cash lines apply is change (never revenue, never sent to the server).
export function paymentSummary(lines: PayLine[], total: number, cashReceived = 0) {
  const applied = r2(lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0))
  const cashApplied = r2(lines.filter((l) => l.method === 'cash').reduce((s, l) => s + Math.max(l.amount, 0), 0))
  const change = cashReceived > cashApplied && cashApplied > 0 ? r2(cashReceived - cashApplied) : 0
  return { applied, remaining: r2(Math.max(total - applied, 0)), overpaid: applied > total, change }
}
// Payload for complete_sale(): drops empty/invalid lines (server re-validates everything).
export const paymentsPayload = (lines: PayLine[]) => lines.filter((l) => l.amount > 0).map((l) => ({ method: l.method, amount: l.amount }))
