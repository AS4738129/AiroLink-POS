import { methodLabel } from '../lib/payments'

export type ReceiptData = {
  business: string; branch: string; receiptNo: string; createdAt: string; cashier: string | null; customer: string | null
  status: string; currency: string
  items: { name: string; qty: number; unit_price: number; line_total: number }[]
  payments: { method: string; amount: number }[]
  subtotal: number; discount: number; tax: number; total: number; paid: number; due: number
  change?: number // only known at checkout time; not stored, so absent on reprints
}
// Purely presentational: it can only display a completed sale, never edit one.
export function ReceiptView({ r }: { r: ReceiptData }) {
  const m = (n: number) => `${r.currency} ${n.toFixed(2)}`
  return (
    <div className="receipt mx-auto w-full max-w-sm bg-white p-4 text-sm font-mono">
      <h2 className="text-center text-base font-bold">{r.business}</h2>
      <p className="text-center">Branch: {r.branch}</p>
      <p className="text-center">Receipt {r.receiptNo}{r.status === 'void' ? ' (VOID)' : ''}</p>
      <p className="text-center">{new Date(r.createdAt).toLocaleString()}</p>
      {r.cashier && <p className="text-center">Cashier: {r.cashier}</p>}
      {r.customer && <p className="text-center">Customer: {r.customer}</p>}
      <table className="my-2 w-full"><thead><tr className="border-b"><th className="text-left">Item</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr></thead>
        <tbody>{r.items.map((i, k) => <tr key={k}><td>{i.name}</td><td className="text-center">{Number(i.qty)}</td><td className="text-right">{Number(i.unit_price).toFixed(2)}</td><td className="text-right">{Number(i.line_total).toFixed(2)}</td></tr>)}</tbody></table>
      <dl className="space-y-0.5 border-t pt-2">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{m(r.subtotal)}</dd></div>
        <div className="flex justify-between"><dt>Discount</dt><dd>{m(r.discount)}</dd></div>
        <div className="flex justify-between"><dt>Tax</dt><dd>{m(r.tax)}</dd></div>
        <div className="flex justify-between text-base font-bold"><dt>TOTAL</dt><dd>{m(r.total)}</dd></div>
      </dl>
      <div className="mt-2 border-t pt-2">
        {r.payments.map((p, k) => <div key={k} className="flex justify-between"><span>{methodLabel(p.method)}</span><span>{m(Number(p.amount))}</span></div>)}
        <div className="flex justify-between"><span>Paid</span><span>{m(r.paid)}</span></div>
        {r.due > 0 && <div className="flex justify-between font-bold"><span>Balance due (credit)</span><span>{m(r.due)}</span></div>}
        {r.change !== undefined && r.change > 0 && <div className="flex justify-between"><span>Change</span><span>{m(r.change)}</span></div>}
      </div>
      <p className="mt-3 text-center text-xs">Thank you for your purchase</p>
    </div>
  )
}
