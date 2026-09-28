import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { cartTotals, r2 } from '../lib/calc'
import { METHODS, paymentSummary, paymentsPayload, type Method, type PayLine } from '../lib/payments'
import { addToCart, setQuantity, removeLine, type CartLine } from '../lib/cart'
import { ReceiptDialog } from '../components/ReceiptDialog'

type P = { id: string; name: string; sku: string; barcode: string | null; selling_price: number; taxable: boolean; categories: { name: string } | null }
type Stocked = P & { stock_qty: number }
const PRODUCT_COLS = 'id,name,sku,barcode,selling_price,taxable,categories(name)'
// Frontend validation is UX only; complete_sale() re-validates everything.
const checkoutSchema = z.object({ discount: z.number().min(0, 'Discount cannot be negative'), lines: z.array(z.object({ amount: z.number().positive('Payment amounts must be greater than zero') })) })
const useDebounced = <T,>(v: T, ms = 250) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }

export default function Pos() {
  const { org, branch, branches, switchBranch } = useAuth(); const qc = useQueryClient()
  const [q, setQ] = useState(''); const dq = useDebounced(q)
  const [cart, setCart] = useState<CartLine<Stocked>[]>([]); const [discount, setDiscount] = useState(0)
  const [customer, setCustomer] = useState(''); const [lines, setLines] = useState<{ method: Method; amount: string }[]>([{ method: 'cash', amount: '' }]); const [cashReceived, setCashReceived] = useState('')
  const [busy, setBusy] = useState(false); const inFlight = useRef(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [receipt, setReceipt] = useState<{ receiptNo: string; change: number } | null>(null)
  const money = (n: number) => `${org!.currency} ${n.toFixed(2)}`

  // A cart belongs to one organization + branch (stock differs per branch): reset it if either changes.
  useEffect(() => { setCart([]); setDiscount(0); setLines([{ method: 'cash', amount: '' }]); setCashReceived(''); setMsg(null) }, [org!.id, branch?.id])

  const policy = useQuery({ queryKey: ['org-policy', org!.id], queryFn: async () => {
    const { data, error } = await supabase.from('organizations').select('allow_negative_stock').eq('id', org!.id).single(); if (error) throw error
    return Boolean((data as { allow_negative_stock: boolean }).allow_negative_stock)
  } })
  // Products are organization-scoped; stock is branch-scoped, so they are fetched separately and merged.
  const found = useQuery({ queryKey: ['pos-search', org!.id, dq], queryFn: async () => {
    let s = supabase.from('products').select(PRODUCT_COLS).eq('org_id', org!.id).eq('is_active', true).order('name').limit(24)
    const t = dq.trim().replace(/[,()%]/g, ' ')
    if (t) s = s.or(`name.ilike.%${t}%,sku.ilike.%${t}%,barcode.eq.${t}`)
    const { data, error } = await s; if (error) throw error; return (data ?? []) as unknown as P[]
  } })
  const stockMap = useQuery({ queryKey: ['branch_inventory', org!.id, branch?.id], enabled: !!branch, queryFn: async () => {
    const { data, error } = await supabase.from('branch_inventory').select('product_id,stock_qty').eq('org_id', org!.id).eq('branch_id', branch!.id)
    if (error) throw error; return new Map((data ?? []).map((r) => [r.product_id as string, Number(r.stock_qty)]))
  } })
  const withStock = (p: P): Stocked => ({ ...p, stock_qty: stockMap.data?.get(p.id) ?? 0 })
  const list = useMemo(() => (found.data ?? []).map(withStock), [found.data, stockMap.data])
  const customers = useQuery({ queryKey: ['customers', org!.id], queryFn: async () => { const { data, error } = await supabase.from('customers').select('id,name').eq('org_id', org!.id).eq('is_active', true).order('name').limit(200); if (error) throw error; return data ?? [] } })

  const allowNeg = policy.data === true
  const add = (p: Stocked) => { const r = addToCart(cart, p, allowNeg, branch?.name); setCart(r.cart); if (r.error) setMsg({ ok: false, t: r.error }) }
  const setQty = (id: string, qty: number) => setCart((c) => setQuantity(c, id, qty, allowNeg))
  const remove = (id: string) => setCart((c) => removeLine(c, id))
  // USB scanners type the code then press Enter: an exact barcode match goes straight into the cart.
  const scan = async (code: string) => { const { data } = await supabase.from('products').select(PRODUCT_COLS).eq('org_id', org!.id).eq('is_active', true).eq('barcode', code).maybeSingle()
    if (data) { add(withStock(data as unknown as P)); setQ('') } else setMsg({ ok: false, t: `No active product with barcode ${code}.` }) }

  const t = cartTotals(cart.map((l) => ({ price: Number(l.selling_price), qty: l.qty, taxable: l.taxable })), discount, org!.taxRate)
  const payLines: PayLine[] = lines.map((l) => ({ method: l.method, amount: r2(Number(l.amount) || 0) }))
  const sum = paymentSummary(payLines, t.total, Number(cashReceived) || 0)
  const needsCustomer = sum.remaining > 0 && cart.length > 0
  const canPay = cart.length > 0 && !busy && !!branch && !sum.overpaid && (!needsCustomer || !!customer)

  const pay = async () => {
    if (!branch || inFlight.current) return   // ref guard: a fast double-click can never send two checkouts
    const parsed = checkoutSchema.safeParse({ discount, lines: paymentsPayload(payLines) })
    if (!parsed.success) { setMsg({ ok: false, t: parsed.error.issues[0].message }); return }
    inFlight.current = true; setBusy(true); setMsg(null)
    try {
      // Only product ids + quantities are sent. Prices, tax and totals are recomputed by the database.
      const { data, error } = await supabase.rpc('complete_sale', { p_org: org!.id, p_branch: branch.id, p_items: cart.map((l) => ({ product_id: l.id, qty: l.qty })),
        p_payments: paymentsPayload(payLines), p_customer: customer || null, p_discount: t.discount })
      if (error) { console.error('complete_sale failed', error); setMsg({ ok: false, t: friendly(error) }); return }  // cart is kept; nothing is shown as successful
      setReceipt({ receiptNo: data as string, change: sum.change })
      setCart([]); setDiscount(0); setLines([{ method: 'cash', amount: '' }]); setCashReceived(''); setCustomer('')
      void qc.invalidateQueries({ queryKey: ['pos-search'] }); void qc.invalidateQueries({ queryKey: ['branch_inventory'] }); void qc.invalidateQueries({ queryKey: ['sales'] })
    } finally { inFlight.current = false; setBusy(false) }
  }
  const setLine = (i: number, patch: Partial<{ method: Method; amount: string }>) => setLines((ls) => ls.map((l, k) => k === i ? { ...l, ...patch } : l))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">POS <span className="ml-2 text-base font-normal text-gray-600">Branch: <strong>{branch?.name ?? 'none selected'}</strong></span></h1>
        {branches.length > 1 && <label className="text-sm">Switch branch <select aria-label="Branch" value={branch?.id ?? ''} onChange={(e) => switchBranch(e.target.value)} className="ml-1 rounded-lg border bg-white px-2 py-1.5">
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      </div>
      {!branch && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No authorized branch is available. Ask an owner to give you branch access.</p>}
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void scan(q.trim()) }}
            placeholder="Search name or SKU, or scan a barcode and press Enter" aria-label="Search products" className="w-full rounded-lg border bg-white px-4 py-3" />
          {found.isError && <p className="text-sm text-red-700">Could not load products. <button className="underline" onClick={() => found.refetch()}>Retry</button></p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {list.map((p) => { const out = p.stock_qty <= 0 && !allowNeg
              return <button key={p.id} disabled={out || !branch} onClick={() => add(p)} className="rounded-xl border bg-white p-3 text-left hover:border-indigo-500 disabled:opacity-50">
                <span className="block font-medium">{p.name}</span><span className="block text-xs text-gray-500">{p.sku}{p.categories ? ` · ${p.categories.name}` : ''}</span>
                <span className="text-sm text-gray-700">{money(Number(p.selling_price))}</span>
                <span className={`block text-xs ${p.stock_qty <= 0 ? 'text-red-700' : 'text-gray-500'}`}>{p.stock_qty <= 0 ? 'Out of stock' : `${p.stock_qty} in stock`}</span></button> })}
            {list.length === 0 && !found.isLoading && <p className="col-span-full text-sm text-gray-600">No matching products.</p>}
          </div>
        </section>
        <aside className="space-y-3 rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="text-lg font-semibold">Cart</h2>
          {cart.length === 0 && <p className="text-sm text-gray-600">Add products to start a sale.</p>}
          {cart.length > 0 && <table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th>Product</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Total</th><th></th></tr></thead>
            <tbody>{cart.map((l) => <tr key={l.id} className="border-t">
              <td className="max-w-[8rem] truncate py-1">{l.name}</td>
              <td><div className="flex items-center gap-1"><button aria-label={`Decrease ${l.name}`} className="size-7 rounded border" onClick={() => setQty(l.id, l.qty - 1)}>−</button>
                <input aria-label={`Quantity of ${l.name}`} type="number" min={1} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value))} className="w-14 rounded border px-1 py-1 text-center" />
                <button aria-label={`Increase ${l.name}`} className="size-7 rounded border" onClick={() => setQty(l.id, l.qty + 1)}>+</button></div></td>
              <td className="text-right">{Number(l.selling_price).toFixed(2)}</td><td className="text-right">{r2(Number(l.selling_price) * l.qty).toFixed(2)}</td>
              <td><button aria-label={`Remove ${l.name}`} className="px-1 text-red-700" onClick={() => remove(l.id)}>✕</button></td></tr>)}</tbody></table>}
          <label className="block text-sm">Discount ({org!.currency})<input type="number" min={0} value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <dl className="space-y-1 border-t pt-2 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(t.subtotal)}</dd></div><div className="flex justify-between"><dt>Discount</dt><dd>−{money(t.discount)}</dd></div>
            <div className="flex justify-between"><dt>Tax ({org!.taxRate}%)</dt><dd>{money(t.tax)}</dd></div><div className="flex justify-between text-lg font-semibold"><dt>Total</dt><dd>{money(t.total)}</dd></div></dl>
          <label className="block text-sm">Customer<select value={customer} onChange={(e) => setCustomer(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">Walk-in customer</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Payment</legend>
            {lines.map((l, i) => <div key={i} className="flex gap-2">
              <select aria-label={`Payment method ${i + 1}`} value={l.method} onChange={(e) => setLine(i, { method: e.target.value as Method })} className="rounded border px-2 py-2 text-sm">{METHODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}</select>
              <input aria-label={`Payment amount ${i + 1}`} type="number" min={0} step="any" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="Amount" className="min-w-0 flex-1 rounded border px-3 py-2" />
              <button type="button" aria-label="Fill remaining" title="Fill the remaining balance" className="rounded border px-2 text-xs" onClick={() => setLine(i, { amount: String(r2(Math.max(t.total - (sum.applied - (Number(l.amount) || 0)), 0))) })}>Rest</button>
              {lines.length > 1 && <button type="button" aria-label={`Remove payment ${i + 1}`} className="px-1 text-red-700" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button>}</div>)}
            <button type="button" onClick={() => setLines((ls) => [...ls, { method: 'momo', amount: '' }])} className="text-sm text-indigo-700 underline">+ Split payment</button>
            {lines.some((l) => l.method === 'cash') && <label className="block text-sm">Cash received (for change)<input type="number" min={0} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>}
          </fieldset>
          <dl className="space-y-1 text-sm"><div className="flex justify-between"><dt>Paid</dt><dd>{money(sum.applied)}</dd></div>
            {sum.remaining > 0 && cart.length > 0 && <div className="flex justify-between text-amber-800"><dt>Remaining (credit)</dt><dd>{money(sum.remaining)}</dd></div>}
            {sum.change > 0 && <div className="flex justify-between"><dt>Change</dt><dd>{money(sum.change)}</dd></div>}</dl>
          {sum.overpaid && <p role="alert" className="text-sm text-red-700">Payments exceed the total. Enter the amount applied to the bill; cash handed over goes in “Cash received”.</p>}
          {needsCustomer && <p className="text-sm text-amber-800">{customer ? `${money(sum.remaining)} will be added to the customer's balance (credit sale).` : 'Choose a customer to sell the unpaid remainder on credit.'}</p>}
          {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
          <div className="flex gap-2"><button onClick={() => { setCart([]); setDiscount(0); setLines([{ method: 'cash', amount: '' }]); setCashReceived(''); setMsg(null) }} className="rounded-lg border px-4 py-2.5">Clear</button>
            <button disabled={!canPay} onClick={() => void pay()} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-medium text-white disabled:opacity-50">{busy ? 'Recording sale…' : 'Complete sale'}</button></div>
        </aside>
      </div>
      {receipt && <ReceiptDialog receiptNo={receipt.receiptNo} change={receipt.change} onClose={() => setReceipt(null)} />}
    </div>
  )
}
