import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReceiptView, type ReceiptData } from './Receipt'
const base: ReceiptData = { business: 'Hardware Shop A', branch: 'Kumasi Branch', receiptNo: 'R-260928-00007', createdAt: '2026-09-28T10:00:00Z', cashier: 'Kofi', customer: 'Ama', status: 'completed', currency: 'GHS',
  items: [{ name: 'Cement 42.5', qty: 2, unit_price: 95, line_total: 190 }], payments: [{ method: 'cash', amount: 100 }, { method: 'momo', amount: 90 }],
  subtotal: 190, discount: 0, tax: 0, total: 190, paid: 190, due: 0, change: 10 }
describe('receipt', () => {
  const html = renderToStaticMarkup(<ReceiptView r={base} />)
  it('shows the tenant business, branch, receipt number, cashier and customer — not the platform name', () => {
    for (const t of ['Hardware Shop A', 'Kumasi Branch', 'R-260928-00007', 'Cashier: Kofi', 'Customer: Ama']) expect(html).toContain(t)
    expect(html).not.toContain('AiroLink')
  })
  it('shows items, totals in the organization currency, payment methods and change', () => {
    for (const t of ['Cement 42.5', 'GHS 190.00', 'Cash', 'Mobile Money', 'Change']) expect(html).toContain(t)
  })
  it('marks a voided sale and omits change on a reprint (change is not stored)', () => {
    const v = renderToStaticMarkup(<ReceiptView r={{ ...base, status: 'void', change: undefined }} />)
    expect(v).toContain('(VOID)'); expect(v).not.toContain('Change')
  })
  it('shows an outstanding credit balance', () => {
    expect(renderToStaticMarkup(<ReceiptView r={{ ...base, paid: 100, due: 90, change: undefined }} />)).toContain('Balance due (credit)')
  })
})
