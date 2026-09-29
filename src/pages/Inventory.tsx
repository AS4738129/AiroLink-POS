import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import {
  Btn, Card, EmptyState, Field, Notice, PageHeader, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls,
} from '../components/ui'

type Product = { id: string; sku: string; name: string; is_active: boolean }
type StockRow = { product_id: string; stock_qty: number; min_stock: number }
type Combined = Product & { stock_qty: number; min_stock: number }
type HistoryRow = { id: string; reason: string; qty_change: number; note: string | null; created_at: string; product_id: string; profiles: { full_name: string | null } | null }
const REASONS = [
  ['opening', 'Opening stock (set initial stock at this branch)'],
  ['adjustment', 'Adjustment (+/-)'],
  ['damaged', 'Damaged (removes stock)'],
  ['expired', 'Expired (removes stock)'],
  ['count', 'Physical count (enter the counted total)'],
] as const
type Reason = (typeof REASONS)[number][0]

export default function Inventory() {
  const { org, branch, branches, switchBranch } = useAuth(); const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out'>('all')
  const [adjusting, setAdjusting] = useState<Combined | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canAdjust = allowed('adjustInventory', org?.role)
  // Reset page-local list state on organization change so the old org's search/filters never linger.
  useEffect(() => { setQ(''); setStatusFilter('all'); setAdjusting(null); setShowHistory(false); setNote(null) }, [org!.id])

  const products = useQuery({ queryKey: ['inv-products', org!.id], queryFn: async () => {
    const { data, error } = await supabase.from('products').select('id,sku,name,is_active').eq('org_id', org!.id).eq('is_active', true).order('name')
    if (error) throw error; return (data ?? []) as Product[]
  } })
  const stock = useQuery({ queryKey: ['branch_inventory', org!.id, branch?.id], enabled: !!branch, queryFn: async () => {
    const { data, error } = await supabase.from('branch_inventory').select('product_id,stock_qty,min_stock').eq('org_id', org!.id).eq('branch_id', branch!.id)
    if (error) throw error; return (data ?? []) as StockRow[]
  } })

  const rows = useMemo<Combined[]>(() => {
    const byProduct = new Map(stock.data?.map((s) => [s.product_id, s]))
    let list = (products.data ?? []).map((p) => { const s = byProduct.get(p.id); return { ...p, stock_qty: Number(s?.stock_qty ?? 0), min_stock: Number(s?.min_stock ?? 0) } })
    if (q.trim()) { const t = q.trim().toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)) }
    if (statusFilter === 'low') list = list.filter((p) => p.stock_qty > 0 && p.stock_qty <= p.min_stock)
    if (statusFilter === 'out') list = list.filter((p) => p.stock_qty <= 0)
    return list
  }, [products.data, stock.data, q, statusFilter])

  const lowCount = useMemo(() => (products.data ?? []).filter((p) => {
    const s = stock.data?.find((x) => x.product_id === p.id)
    const qty = Number(s?.stock_qty ?? 0)
    return qty > 0 && qty <= Number(s?.min_stock ?? 0)
  }).length, [products.data, stock.data])
  const outCount = useMemo(() => (products.data ?? []).filter((p) => {
    const s = stock.data?.find((x) => x.product_id === p.id)
    return Number(s?.stock_qty ?? 0) <= 0
  }).length, [products.data, stock.data])

  const history = useQuery({ queryKey: ['inv-history', org!.id, branch?.id], enabled: !!branch && showHistory, queryFn: async () => {
    const { data, error } = await supabase.from('inventory_transactions').select('id,reason,qty_change,note,created_at,product_id,profiles(full_name)').eq('org_id', org!.id).eq('branch_id', branch!.id).order('created_at', { ascending: false }).limit(50)
    if (error) throw error; return (data ?? []) as unknown as HistoryRow[]
  } })
  const productName = (id: string) => products.data?.find((p) => p.id === id)?.name ?? '—'

  const setMinStock = useMutation({
    mutationFn: async ({ productId, min }: { productId: string; min: number }) => {
      const { error } = await supabase.from('branch_inventory').upsert({ org_id: org!.id, branch_id: branch!.id, product_id: productId, min_stock: min }, { onConflict: 'org_id,branch_id,product_id' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['branch_inventory'] }), onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const adjust = useMutation({
    mutationFn: async (v: { reason: Reason; qty: number; note: string }) => {
      let qtyChange = v.qty
      if (v.reason === 'damaged' || v.reason === 'expired') qtyChange = -Math.abs(v.qty)
      if (v.reason === 'count') qtyChange = v.qty - (adjusting?.stock_qty ?? 0)
      if (v.reason === 'opening') qtyChange = Math.abs(v.qty)
      if (qtyChange === 0) throw new Error('No change to record.')
      const { error } = await supabase.from('inventory_transactions').insert({ org_id: org!.id, branch_id: branch!.id, product_id: adjusting!.id, qty_change: qtyChange, reason: v.reason, note: v.note || null })
      if (error) throw error
    },
    onSuccess: () => { setNote({ ok: true, t: 'Stock updated.' }); setAdjusting(null); void qc.invalidateQueries({ queryKey: ['branch_inventory'] }); void qc.invalidateQueries({ queryKey: ['inv-history'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  if (!branch) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inventory" description="Branch stock levels and adjustments." />
        <Notice tone="warn">No branch available. Ask an owner to give you branch access.</Notice>
      </div>
    )
  }
  const statusOf = (p: Combined) => p.stock_qty <= 0 ? 'Out' : p.stock_qty <= p.min_stock ? 'Low' : 'Healthy'
  const toneOf = (s: string): 'red' | 'amber' | 'green' => s === 'Out' ? 'red' : s === 'Low' ? 'amber' : 'green'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={branch ? `Stock at ${branch.name} · ${rows.length} products` : 'Branch stock levels and adjustments.'}
        actions={branches.length > 1 ? (
          <label className="text-sm text-slate-600">
            Branch{' '}
            <select value={branch.id} onChange={(e) => switchBranch(e.target.value)} aria-label="Branch" className={selectCls}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="relative overflow-hidden p-3 text-center sm:p-4">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-brand-300" />
          <p className="text-lg font-extrabold text-ink-900 sm:text-2xl">{rows.length}</p>
          <p className="text-xs text-slate-500">Products</p>
        </Card>
        <Card className="relative overflow-hidden p-3 text-center sm:p-4">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-amber-300" />
          <p className="text-lg font-extrabold text-amber-700 sm:text-2xl">{lowCount}</p>
          <p className="text-xs text-slate-500">Low stock</p>
        </Card>
        <Card className="relative overflow-hidden p-3 text-center sm:p-4">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 to-red-300" />
          <p className="text-lg font-extrabold text-red-700 sm:text-2xl">{outCount}</p>
          <p className="text-xs text-slate-500">Out of stock</p>
        </Card>
      </div>
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}
      <div className={filterBarCls}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search inventory" className={`${inputCls} sm:max-w-xs`} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Stock level filter" className={selectCls}>
          <option value="all">All stock levels</option><option value="low">Low stock</option><option value="out">Out of stock</option>
        </select>
      </div>
      <TableShell label="Inventory">
        <thead>
          <tr>
            <th className={thCls}>Product</th><th className={thCls}>SKU</th><th className={`${thCls} text-right`}>Stock</th>
            <th className={thCls}>Minimum</th><th className={thCls}>Status</th><th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {(products.isLoading || stock.isLoading) && <tr><td className="p-4" colSpan={6}><Spinner label="Loading inventory…" /></td></tr>}
          {(products.isError || stock.isError) && <tr><td className="p-4 text-red-700" colSpan={6}>Could not load inventory. <button className="font-medium underline" onClick={() => { void products.refetch(); void stock.refetch() }}>Retry</button></td></tr>}
          {rows.length === 0 && !products.isLoading && !stock.isLoading && !(products.isError || stock.isError) && (
            <tr><td colSpan={6}><EmptyState title="No products match." hint="Try a different search or stock filter." /></td></tr>
          )}
          {rows.map((p) => (
            <tr key={p.id} className={rowCls}>
              <td className={`${tdCls} font-medium`}>{p.name}</td>
              <td className={`${tdCls} font-mono text-xs`}>{p.sku}</td>
              <td className={`${tdCls} text-right font-semibold ${p.stock_qty <= 0 ? 'text-red-700' : ''}`}>{p.stock_qty}</td>
              <td className={tdCls}>
                {canAdjust ? (
                  <input
                    type="number"
                    min={0}
                    defaultValue={p.min_stock}
                    aria-label={`Minimum stock for ${p.name}`}
                    className="w-20 rounded-lg border border-brand-100 px-2 py-1 text-sm"
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== p.min_stock && v >= 0) setMinStock.mutate({ productId: p.id, min: v }) }}
                  />
                ) : p.min_stock}
              </td>
              <td className={tdCls}><StatusBadge tone={toneOf(statusOf(p))}>{statusOf(p)}</StatusBadge></td>
              <td className={tdCls}>{canAdjust && <button className="font-medium text-brand-700 hover:underline" onClick={() => setAdjusting(p)}>Adjust</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {adjusting && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setAdjusting(null)}>
          <form
            role="dialog"
            aria-label={`Adjust stock for ${adjusting.name}`}
            className="w-full max-w-sm space-y-3 rounded-2xl border border-brand-100 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget)
              adjust.mutate({ reason: f.get('reason') as Reason, qty: Number(f.get('qty')), note: String(f.get('note') || '') }) }}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Adjust stock — {adjusting.name}</h2>
              <button type="button" onClick={() => setAdjusting(null)} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <p className="text-sm text-slate-600">Current stock at {branch.name}: <strong>{adjusting.stock_qty}</strong></p>
            <Field label="Reason">
              <select name="reason" defaultValue="adjustment" className={selectCls + ' w-full'}>
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Quantity" required>
              <input name="qty" type="number" step="any" required className={inputCls} />
            </Field>
            <Field label="Note (optional)">
              <input name="note" className={inputCls} />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn type="button" onClick={() => setAdjusting(null)}>Cancel</Btn>
              <Btn type="submit" variant="primary" disabled={adjust.isPending}>{adjust.isPending ? 'Saving…' : 'Save'}</Btn>
            </div>
          </form>
        </div>
      )}

      <Card className="p-4">
        <details open={showHistory} onToggle={(e) => setShowHistory(e.currentTarget.open)}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Inventory history (this branch)</summary>
          <div className="scroll-slim mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50"><tr>{['When', 'Product', 'Reason', 'Change', 'By', 'Note'].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
              <tbody>
                {history.isLoading && showHistory && <tr><td className="p-2" colSpan={6}><Spinner label="Loading history…" /></td></tr>}
                {history.data?.length === 0 && <tr><td className="p-2 text-slate-600" colSpan={6}>No transactions yet.</td></tr>}
                {history.data?.map((h) => (
                  <tr key={h.id} className={rowCls}>
                    <td className={`${tdCls} whitespace-nowrap`}>{new Date(h.created_at).toLocaleString()}</td>
                    <td className={tdCls}>{productName(h.product_id)}</td>
                    <td className={`${tdCls} capitalize`}>{h.reason}</td>
                    <td className={`${tdCls} font-semibold ${Number(h.qty_change) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{Number(h.qty_change) > 0 ? '+' : ''}{Number(h.qty_change)}</td>
                    <td className={tdCls}>{h.profiles?.full_name ?? '—'}</td>
                    <td className={tdCls}>{h.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  )
}
