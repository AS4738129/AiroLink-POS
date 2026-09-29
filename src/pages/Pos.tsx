import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { errorDetail } from '../lib/errors'
import { useAuth } from '../features/auth/AuthProvider'
import { cartTotals, r2 } from '../lib/calc'
import { METHODS, paymentSummary, paymentsPayload, type Method, type PayLine } from '../lib/payments'
import { addToCart, setQuantity, removeLine, type CartLine } from '../lib/cart'
import { ReceiptDialog } from '../components/ReceiptDialog'
import {
  Btn, Card, EmptyState, Field, Notice, PageHeader, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls,
} from '../components/ui'

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
  // Own cache entry (NOT the shared ['branch_inventory', ...] key): this query stores a Map while
  // Inventory.tsx stores an array under ['branch_inventory', ...], so sharing one key crashed POS -> Inventory on .map.
  const stockMap = useQuery({ queryKey: ['pos-stock', org!.id, branch?.id], enabled: !!branch, queryFn: async () => {
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
      void qc.invalidateQueries({ queryKey: ['pos-search'] }); void qc.invalidateQueries({ queryKey: ['branch_inventory'] }); void qc.invalidateQueries({ queryKey: ['pos-stock'] }); void qc.invalidateQueries({ queryKey: ['sales'] })
    } finally { inFlight.current = false; setBusy(false) }
  }
  const setLine = (i: number, patch: Partial<{ method: Method; amount: string }>) => setLines((ls) => ls.map((l, k) => k === i ? { ...l, ...patch } : l))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Point of sale"
        description={branch ? `Selling at ${branch.name}` : 'No authorized branch is available.'}
        actions={branches.length > 1 ? (
          <label className="text-sm text-slate-600">
            Branch{' '}
            <select aria-label="Branch" value={branch?.id ?? ''} onChange={(e) => switchBranch(e.target.value)} className={selectCls}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {!branch && (
        <Notice tone="warn">No authorized branch is available. Ask an owner to give you branch access.</Notice>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-5">
        <section className="space-y-3 xl:col-span-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void scan(q.trim()) }}
            placeholder="Search name or SKU, or scan a barcode and press Enter"
            aria-label="Search products"
            className={`${inputCls} py-3`}
          />
          {found.isError && (
            <Notice tone="err">
              Could not load products.<br />
              <span className="font-mono text-xs">{errorDetail(found.error)}</span>{' '}
              <button className="font-medium underline" onClick={() => found.refetch()}>Retry</button>
            </Notice>
          )}
          {found.isLoading ? (
            <p className="py-6 text-center"><Spinner label="Loading products…" /></p>
          ) : list.length === 0 ? (
            <Card><EmptyState title="No matching products." hint="Try a different search term, or scan a barcode and press Enter." /></Card>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((p) => {
                const out = p.stock_qty <= 0 && !allowNeg
                return (
                  <button
                    key={p.id}
                    disabled={out || !branch}
                    onClick={() => add(p)}
                    className="rounded-xl border border-brand-100 bg-white p-3 text-left shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)] transition-colors hover:border-brand-400 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block truncate font-medium text-slate-900">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">{p.sku}{p.categories ? ` · ${p.categories.name}` : ''}</span>
                    <span className="mt-0.5 block text-sm font-semibold text-slate-900">{money(Number(p.selling_price))}</span>
                    <span className="mt-1 block">
                      {p.stock_qty <= 0
                        ? <StatusBadge tone="red">Out of stock</StatusBadge>
                        : <span className="text-xs text-slate-500">{p.stock_qty} in stock</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <aside className="xl:sticky xl:top-16 xl:col-span-2">
          <Card className="space-y-3 p-4">
            <h2 className="text-base font-bold text-ink-900">Cart {cart.length > 0 && <span className="text-sm font-normal text-slate-500">({cart.length})</span>}</h2>
            {cart.length === 0 ? (
              <EmptyState title="Cart is empty." hint="Add products to start a sale." />
            ) : (
              <TableShell label="Cart">
                <thead>
                  <tr><th className={thCls}>Product</th><th className={thCls}>Qty</th><th className={`${thCls} text-right`}>Total</th><th className={thCls}><span className="sr-only">Remove</span></th></tr>
                </thead>
                <tbody>
                  {cart.map((l) => (
                    <tr key={l.id} className={rowCls}>
                      <td className={`${tdCls} max-w-[9rem]`}>
                        <span className="block truncate font-medium">{l.name}</span>
                        <span className="block text-xs text-slate-500">{Number(l.selling_price).toFixed(2)} each</span>
                      </td>
                      <td className={tdCls}>
                        <div className="flex items-center gap-1">
                          <button aria-label={`Decrease ${l.name}`} className="size-8 rounded-lg border border-brand-100 text-base leading-none text-brand-800 hover:bg-brand-50" onClick={() => setQty(l.id, l.qty - 1)}>−</button>
                          <input aria-label={`Quantity of ${l.name}`} type="number" min={1} value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value))} className="w-14 rounded-lg border border-brand-100 px-1 py-1.5 text-center text-sm" />
                          <button aria-label={`Increase ${l.name}`} className="size-8 rounded-lg border border-brand-100 text-base leading-none text-brand-800 hover:bg-brand-50" onClick={() => setQty(l.id, l.qty + 1)}>+</button>
                        </div>
                      </td>
                      <td className={`${tdCls} text-right font-medium`}>{r2(Number(l.selling_price) * l.qty).toFixed(2)}</td>
                      <td className={tdCls}><button aria-label={`Remove ${l.name}`} className="rounded px-1.5 py-1 text-red-700 hover:bg-red-50" onClick={() => remove(l.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
            <Field label={`Discount (${org!.currency})`}>
              <input type="number" min={0} value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Number(e.target.value))} className={inputCls} />
            </Field>
            <dl className="space-y-1 rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-medium">{money(t.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="font-medium">−{money(t.discount)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Tax ({org!.taxRate}%)</dt><dd className="font-medium">{money(t.tax)}</dd></div>
              <div className="flex justify-between border-t border-brand-100 pt-1 text-lg font-extrabold text-ink-900"><dt>Total</dt><dd>{money(t.total)}</dd></div>
            </dl>
            <Field label="Customer">
              <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={selectCls + ' w-full'}>
                <option value="">Walk-in customer</option>
                {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Payment</legend>
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <select aria-label={`Payment method ${i + 1}`} value={l.method} onChange={(e) => setLine(i, { method: e.target.value as Method })} className={`${selectCls} shrink-0`}>
                    {METHODS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
                  </select>
                  <input aria-label={`Payment amount ${i + 1}`} type="number" min={0} step="any" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="Amount" className={`${inputCls} min-w-0 flex-1`} />
                  <button type="button" aria-label="Fill remaining" title="Fill the remaining balance" className="shrink-0 rounded-lg border border-brand-100 px-2 text-xs font-medium text-brand-800 hover:bg-brand-50" onClick={() => setLine(i, { amount: String(r2(Math.max(t.total - (sum.applied - (Number(l.amount) || 0)), 0))) })}>Rest</button>
                  {lines.length > 1 && <button type="button" aria-label={`Remove payment ${i + 1}`} className="shrink-0 rounded px-1.5 text-red-700 hover:bg-red-50" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button>}
                </div>
              ))}
              <button type="button" onClick={() => setLines((ls) => [...ls, { method: 'momo', amount: '' }])} className="text-sm font-medium text-brand-700 hover:underline">+ Split payment</button>
              {lines.some((l) => l.method === 'cash') && (
                <Field label="Cash received (for change)">
                  <input type="number" min={0} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder="0.00" className={inputCls} />
                </Field>
              )}
            </fieldset>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Paid</dt><dd className="font-medium">{money(sum.applied)}</dd></div>
              {sum.remaining > 0 && cart.length > 0 && <div className="flex justify-between text-amber-800"><dt>Remaining (credit)</dt><dd className="font-semibold">{money(sum.remaining)}</dd></div>}
              {sum.change > 0 && <div className="flex justify-between text-emerald-800"><dt>Change</dt><dd className="font-semibold">{money(sum.change)}</dd></div>}
            </dl>
            {sum.overpaid && (
              <Notice tone="err">Payments exceed the total. Enter the amount applied to the bill; cash handed over goes in “Cash received”.</Notice>
            )}
            {needsCustomer && (
              <Notice tone="warn">
                {customer ? `${money(sum.remaining)} will be added to the customer's balance (credit sale).` : 'Choose a customer to sell the unpaid remainder on credit.'}
              </Notice>
            )}
            {msg && <Notice tone={msg.ok ? 'ok' : 'err'}>{msg.t}</Notice>}
            <div className="flex gap-2">
              <Btn onClick={() => { setCart([]); setDiscount(0); setLines([{ method: 'cash', amount: '' }]); setCashReceived(''); setMsg(null) }}>
                Clear
              </Btn>
              <Btn variant="primary" disabled={!canPay} onClick={() => void pay()} className="flex-1 py-2.5 text-base">
                {busy ? 'Recording sale…' : `Complete sale · ${money(t.total)}`}
              </Btn>
            </div>
          </Card>
        </aside>
      </div>
      {receipt && <ReceiptDialog receiptNo={receipt.receiptNo} change={receipt.change} onClose={() => setReceipt(null)} />}
    </div>
  )
}
