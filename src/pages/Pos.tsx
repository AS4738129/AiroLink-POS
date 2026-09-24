import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { cartTotals, changeDue, creditDue, r2 } from '../lib/calc'
type P = { id: string; name: string; sku: string; barcode: string | null; selling_price: number; stock_qty: number; taxable: boolean }
type CartLine = P & { qty: number }
const METHODS = [['cash', 'Cash'], ['momo', 'Mobile Money'], ['card', 'Card'], ['bank', 'Bank Transfer'], ['other', 'Other']] as const
const useDebounced = <T,>(v: T, ms = 250) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }
export default function Pos() {
  const { org } = useAuth(); const qc = useQueryClient()
  const [q, setQ] = useState(''); const dq = useDebounced(q)
  const [cart, setCart] = useState<CartLine[]>([]); const [discount, setDiscount] = useState(0)
  const [customer, setCustomer] = useState(''); const [method, setMethod] = useState<string>('cash'); const [tendered, setTendered] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const money = (n: number) => `${org!.currency} ${n.toFixed(2)}`
  const found = useQuery({ queryKey: ['pos-search', org!.id, dq], queryFn: async () => {
    let s = supabase.from('products').select('id,name,sku,barcode,selling_price,stock_qty,taxable').eq('org_id', org!.id).eq('is_active', true).order('name').limit(24)
    if (dq.trim()) s = s.or(`name.ilike.%${dq.trim()}%,sku.ilike.%${dq.trim()}%,barcode.eq.${dq.trim()}`)
    const { data, error } = await s; if (error) throw error; return (data ?? []) as P[] } })
  const customers = useQuery({ queryKey: ['customers', org!.id], queryFn: async () => { const { data, error } = await supabase.from('customers').select('id,name').eq('org_id', org!.id).eq('is_active', true).order('name').limit(200); if (error) throw error; return data ?? [] } })
  const add = (p: P) => setCart((c) => c.some((l) => l.id === p.id) ? c.map((l) => l.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...c, { ...p, qty: 1 }])
  const setQty = (id: string, qty: number) => setCart((c) => c.map((l) => l.id === id ? { ...l, qty } : l).filter((l) => l.qty > 0))
  // USB scanners type the code then press Enter: an exact barcode match goes straight into the cart.
  const scan = async (code: string) => { const { data } = await supabase.from('products').select('id,name,sku,barcode,selling_price,stock_qty,taxable').eq('org_id', org!.id).eq('is_active', true).eq('barcode', code).maybeSingle()
    if (data) { add(data as P); setQ('') } else setMsg({ ok: false, t: `No product with barcode ${code}.` }) }
  const t = cartTotals(cart.map((l) => ({ price: Number(l.selling_price), qty: l.qty, taxable: l.taxable })), discount, org!.taxRate)
  const applied = Math.min(r2(Number(tendered) || 0), t.total)  // amount applied to the bill; the rest of any cash is change
  const credit = creditDue(t.total, applied)
  const pay = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('complete_sale', { p_org: org!.id, p_items: cart.map((l) => ({ product_id: l.id, qty: l.qty })),
      p_payments: applied > 0 ? [{ method, amount: applied }] : [], p_customer: customer || null, p_discount: t.discount })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: friendly(error) }); return }  // nothing is shown as successful unless the database confirmed it
    setMsg({ ok: true, t: `Sale recorded. Receipt ${data as string}. Change due: ${money(changeDue(Number(tendered) || 0, t.total))}` })
    setCart([]); setDiscount(0); setTendered(''); setCustomer(''); void qc.invalidateQueries({ queryKey: ['pos-search'] }); void qc.invalidateQueries({ queryKey: ['products'] })
  }
  const canPay = cart.length > 0 && !busy && (credit === 0 || !!customer)
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="space-y-3 lg:col-span-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void scan(q.trim()) }}
          placeholder="Search name or SKU, or scan a barcode" aria-label="Search products" className="w-full rounded-lg border bg-white px-4 py-3" />
        {found.isError && <p className="text-sm text-red-700">Could not load products. <button className="underline" onClick={() => found.refetch()}>Retry</button></p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {found.data?.map((p) => <button key={p.id} disabled={Number(p.stock_qty) <= 0} onClick={() => add(p)} className="rounded-xl border bg-white p-3 text-left hover:border-indigo-500 disabled:opacity-50">
            <span className="block font-medium">{p.name}</span><span className="text-sm text-gray-600">{money(Number(p.selling_price))}</span>
            <span className={`block text-xs ${Number(p.stock_qty) <= 0 ? 'text-red-700' : 'text-gray-500'}`}>{Number(p.stock_qty) <= 0 ? 'Out of stock' : `${Number(p.stock_qty)} in stock`}</span></button>)}
          {found.data?.length === 0 && <p className="col-span-full text-sm text-gray-600">No matching products.</p>}
        </div>
      </section>
      <aside className="space-y-3 rounded-xl border bg-white p-4 lg:col-span-2">
        <h2 className="text-lg font-semibold">Cart</h2>
        {cart.length === 0 && <p className="text-sm text-gray-600">Add products to start a sale.</p>}
        {cart.map((l) => <div key={l.id} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{l.name}</span>
          <button aria-label={`Decrease ${l.name}`} className="size-8 rounded border" onClick={() => setQty(l.id, l.qty - 1)}>−</button><span className="w-8 text-center">{l.qty}</span>
          <button aria-label={`Increase ${l.name}`} className="size-8 rounded border" onClick={() => setQty(l.id, l.qty + 1)}>+</button><span className="w-24 text-right">{money(r2(Number(l.selling_price) * l.qty))}</span></div>)}
        <label className="block text-sm">Discount ({org!.currency})<input type="number" min={0} value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-1 w-full rounded border px-3 py-2" /></label>
        <dl className="space-y-1 border-t pt-2 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(t.subtotal)}</dd></div><div className="flex justify-between"><dt>Discount</dt><dd>−{money(t.discount)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({org!.taxRate}%)</dt><dd>{money(t.tax)}</dd></div><div className="flex justify-between text-lg font-semibold"><dt>Total</dt><dd>{money(t.total)}</dd></div></dl>
        <label className="block text-sm">Customer<select value={customer} onChange={(e) => setCustomer(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">Walk-in customer</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">Method<select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-sm">Amount received<input type="number" min={0} value={tendered} onChange={(e) => setTendered(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label></div>
        {credit > 0 && cart.length > 0 && <p className="text-sm text-amber-800">{customer ? `${money(credit)} will be added to the customer's balance (credit sale).` : 'Choose a customer to sell the unpaid remainder on credit.'}</p>}
        {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
        <div className="flex gap-2"><button onClick={() => { setCart([]); setDiscount(0); setTendered('') }} className="rounded-lg border px-4 py-2.5">Clear</button>
          <button disabled={!canPay} onClick={pay} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-medium text-white disabled:opacity-50">{busy ? 'Recording sale…' : 'Complete sale'}</button></div>
      </aside>
    </div>
  )
}
