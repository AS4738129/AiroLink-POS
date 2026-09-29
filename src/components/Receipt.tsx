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
    <div className="receipt mx-auto w-full max-w-sm bg-white p-5 text-sm">
      <div className="flex flex-col items-center gap-1 text-center">
        <img src="/airolink-logo.jpeg" alt="" aria-hidden width={40} height={40} className="rounded-md bg-white object-cover" loading="lazy" />
        <h2 className="text-base font-bold tracking-tight text-slate-900">{r.business}</h2>
        <p className="text-xs text-slate-500">Branch: {r.branch}</p>
      </div>
      <p className="mt-2 text-center font-mono text-xs text-slate-600">
        Receipt {r.receiptNo}{r.status === 'void' ? ' (VOID)' : ''}
      </p>
      <p className="text-center text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</p>
      {(r.cashier || r.customer) && (
        <p className="mt-1 text-center text-xs text-slate-500">
          {[r.cashier && `Cashier: ${r.cashier}`, r.customer && `Customer: ${r.customer}`].filter(Boolean).join(' · ')}
        </p>
      )}
      <table className="my-3 w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-semibold">Item</th>
            <th className="px-1 py-1 text-center font-semibold">Qty</th>
            <th className="px-1 py-1 text-right font-semibold">Price</th>
            <th className="py-1 pl-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((i, k) => (
            <tr key={k} className="border-b border-slate-100 last:border-0">
              <td className="py-1 pr-2">{i.name}</td>
              <td className="px-1 py-1 text-center">{Number(i.qty)}</td>
              <td className="px-1 py-1 text-right">{Number(i.unit_price).toFixed(2)}</td>
              <td className="py-1 pl-2 text-right font-medium">{Number(i.line_total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="space-y-0.5 border-t border-slate-200 pt-2 text-[13px]">
        <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{m(r.subtotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>{m(r.discount)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd>{m(r.tax)}</dd></div>
        <div className="flex justify-between text-base font-bold text-slate-900"><dt>TOTAL</dt><dd>{m(r.total)}</dd></div>
      </dl>
      <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-[13px]">
        {r.payments.map((p, k) => <div key={k} className="flex justify-between"><span className="text-slate-600">{methodLabel(p.method)}</span><span>{m(Number(p.amount))}</span></div>)}
        <div className="flex justify-between"><span className="text-slate-600">Paid</span><span className="font-medium">{m(r.paid)}</span></div>
        {r.due > 0 && <div className="flex justify-between font-bold text-amber-800"><span>Balance due (credit)</span><span>{m(r.due)}</span></div>}
        {r.change !== undefined && r.change > 0 && <div className="flex justify-between font-medium text-emerald-800"><span>Change</span><span>{m(r.change)}</span></div>}
      </div>
      <p className="mt-3 text-center text-xs text-slate-500">Thank you for your purchase</p>
    </div>
  )
}
