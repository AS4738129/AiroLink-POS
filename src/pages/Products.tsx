import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
const PAGE = 20
const schema = z.object({
  sku: z.string().trim().min(1, 'SKU is required'), name: z.string().trim().min(1, 'Name is required'), barcode: z.string().trim().optional(),
  cost_price: z.coerce.number().min(0, 'Cost cannot be negative'), selling_price: z.coerce.number().min(0, 'Price cannot be negative'),
  opening: z.coerce.number().min(0, 'Opening stock cannot be negative'), min_stock: z.coerce.number().min(0),
})
type Row = { id: string; sku: string; name: string; selling_price: number; stock_qty: number; min_stock: number; is_active: boolean }
export default function Products() {
  const { org } = useAuth(); const qc = useQueryClient(); const [page, setPage] = useState(0); const [q, setQ] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({}); const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canEdit = allowed('editProducts', org?.role)
  const list = useQuery({ queryKey: ['products', org!.id, page, q], queryFn: async () => {
    let s = supabase.from('products').select('id,sku,name,selling_price,stock_qty,min_stock,is_active', { count: 'exact' }).eq('org_id', org!.id).order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    if (q.trim()) s = s.ilike('name', `%${q.trim()}%`)
    const { data, error, count } = await s; if (error) throw error; return { rows: (data ?? []) as Row[], count: count ?? 0 } } })
  const add = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) => {
      const { data, error } = await supabase.from('products').insert({ org_id: org!.id, sku: v.sku, name: v.name, barcode: v.barcode || null, cost_price: v.cost_price, selling_price: v.selling_price, min_stock: v.min_stock }).select('id').single()
      if (error) throw error
      if (v.opening > 0) { const r = await supabase.from('inventory_transactions').insert({ org_id: org!.id, product_id: data.id, qty_change: v.opening, reason: 'opening' }); if (r.error) throw r.error }
    },
    onSuccess: () => { setNote({ ok: true, t: 'Product saved.' }); void qc.invalidateQueries({ queryKey: ['products'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const toggle = useMutation({ mutationFn: async (p: Row) => { const { error } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }), onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget
    const p = schema.safeParse(Object.fromEntries(new FormData(f))); if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); add.mutate(p.data, { onSuccess: () => f.reset() }) }
  const inp = 'w-full rounded-lg border px-3 py-2'
  const field = (n: string, label: string, type = 'text', def?: string) => <label className="block text-sm">{label}<input name={n} type={type} step="any" defaultValue={def} className={inp} />{errs[n] && <span className="text-xs text-red-700">{errs[n]}</span>}</label>
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Products</h1>
      {canEdit && <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        {field('sku', 'SKU')}{field('name', 'Name')}{field('barcode', 'Barcode (optional)')}
        {field('cost_price', 'Cost price', 'number', '0')}{field('selling_price', 'Selling price', 'number')}{field('opening', 'Opening stock', 'number', '0')}
        {field('min_stock', 'Low-stock level', 'number', '0')}
        <div className="flex items-end"><button disabled={add.isPending} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60">{add.isPending ? 'Saving…' : 'Add product'}</button></div>
      </form>}
      {note && <p role="status" className={`rounded-lg p-3 text-sm ${note.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{note.t}</p>}
      <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search products" aria-label="Search products" className={inp + ' bg-white sm:max-w-xs'} />
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50"><tr>{['SKU', 'Name', 'Price', 'Stock', 'Status', ''].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={6}>Loading…</td></tr>}
          {list.isError && <tr><td className="p-4 text-red-700" colSpan={6}>Could not load products. <button className="underline" onClick={() => list.refetch()}>Retry</button></td></tr>}
          {list.data?.rows.length === 0 && <tr><td className="p-4 text-gray-600" colSpan={6}>No products yet.</td></tr>}
          {list.data?.rows.map((p) => <tr key={p.id} className="border-t">
            <td className="p-3">{p.sku}</td><td className="p-3">{p.name}</td><td className="p-3">{Number(p.selling_price).toFixed(2)}</td>
            <td className={`p-3 ${Number(p.stock_qty) <= Number(p.min_stock) ? 'font-semibold text-red-700' : ''}`}>{Number(p.stock_qty)}</td>
            <td className="p-3">{p.is_active ? 'Active' : 'Inactive'}</td>
            <td className="p-3">{canEdit && <button className="text-indigo-700 underline" onClick={() => toggle.mutate(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}
        </tbody></table></div>
      <div className="flex items-center gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1.5 disabled:opacity-40">Previous</button>
        <span>Page {page + 1} of {Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))}</span>
        <button disabled={(page + 1) * PAGE >= (list.data?.count ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1.5 disabled:opacity-40">Next</button></div>
    </div>
  )
}
