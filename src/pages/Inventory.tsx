import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'

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

  if (!branch) return <p className="p-4 text-sm text-gray-600">No branch available.</p>
  const status = (p: Combined) => p.stock_qty <= 0 ? 'Out' : p.stock_qty <= p.min_stock ? 'Low' : 'Healthy'
  const statusClass = (s: string) => s === 'Out' ? 'text-red-700 font-semibold' : s === 'Low' ? 'text-amber-700 font-semibold' : 'text-gray-700'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        {branches.length > 1 && <label className="text-sm">Branch <select value={branch.id} onChange={(e) => switchBranch(e.target.value)} className="ml-1 rounded-lg border px-2 py-1.5">
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>}
      </div>
      {note && <p role="status" className={`rounded-lg p-3 text-sm ${note.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{note.t}</p>}
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search inventory" className="w-full max-w-xs rounded-lg border bg-white px-3 py-2" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="all">All stock levels</option><option value="low">Low stock</option><option value="out">Out of stock</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50"><tr>{['Product', 'SKU', 'Stock', 'Minimum', 'Status', ''].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
        <tbody>
          {(products.isLoading || stock.isLoading) && <tr><td className="p-4" colSpan={6}>Loading…</td></tr>}
          {(products.isError || stock.isError) && <tr><td className="p-4 text-red-700" colSpan={6}>Could not load inventory.</td></tr>}
          {rows.length === 0 && !products.isLoading && <tr><td className="p-4 text-gray-600" colSpan={6}>No products match.</td></tr>}
          {rows.map((p) => <tr key={p.id} className="border-t">
            <td className="p-3">{p.name}</td><td className="p-3">{p.sku}</td><td className="p-3">{p.stock_qty}</td>
            <td className="p-3">{canAdjust ? <input type="number" min={0} defaultValue={p.min_stock} className="w-20 rounded border px-2 py-1"
              onBlur={(e) => { const v = Number(e.target.value); if (v !== p.min_stock && v >= 0) setMinStock.mutate({ productId: p.id, min: v }) }} /> : p.min_stock}</td>
            <td className={`p-3 ${statusClass(status(p))}`}>{status(p)}</td>
            <td className="p-3">{canAdjust && <button className="text-indigo-700 underline" onClick={() => setAdjusting(p)}>Adjust</button>}</td>
          </tr>)}
        </tbody></table></div>

      {adjusting && <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4" onClick={() => setAdjusting(null)}>
        <form className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4" onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget)
            adjust.mutate({ reason: f.get('reason') as Reason, qty: Number(f.get('qty')), note: String(f.get('note') || '') }) }}>
          <h2 className="font-semibold">Adjust stock — {adjusting.name}</h2>
          <p className="text-sm text-gray-600">Current stock at {branch.name}: {adjusting.stock_qty}</p>
          <label className="block text-sm">Reason<select name="reason" defaultValue="adjustment" className="mt-1 w-full rounded border px-3 py-2">
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="block text-sm">Quantity<input name="qty" type="number" step="any" required className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="block text-sm">Note (optional)<input name="note" className="mt-1 w-full rounded border px-3 py-2" /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdjusting(null)} className="rounded-lg border px-4 py-2">Cancel</button>
            <button disabled={adjust.isPending} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60">{adjust.isPending ? 'Saving…' : 'Save'}</button></div>
        </form>
      </div>}

      <details open={showHistory} onToggle={(e) => setShowHistory(e.currentTarget.open)} className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer font-medium">Inventory history (this branch)</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-gray-50"><tr>{['When', 'Product', 'Reason', 'Change', 'By', 'Note'].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>
            {history.isLoading && <tr><td className="p-2" colSpan={6}>Loading…</td></tr>}
            {history.data?.length === 0 && <tr><td className="p-2 text-gray-600" colSpan={6}>No transactions yet.</td></tr>}
            {history.data?.map((h) => <tr key={h.id} className="border-t"><td className="p-2">{new Date(h.created_at).toLocaleString()}</td>
              <td className="p-2">{productName(h.product_id)}</td><td className="p-2 capitalize">{h.reason}</td>
              <td className={`p-2 ${Number(h.qty_change) < 0 ? 'text-red-700' : 'text-green-700'}`}>{Number(h.qty_change) > 0 ? '+' : ''}{Number(h.qty_change)}</td>
              <td className="p-2">{h.profiles?.full_name ?? '—'}</td><td className="p-2">{h.note ?? ''}</td></tr>)}
          </tbody></table></div>
      </details>
    </div>
  )
}
