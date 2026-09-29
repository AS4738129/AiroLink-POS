import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'

const PAGE = 20
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  barcode: z.string().trim().optional(),
  category_id: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  unit: z.string().trim().min(1).default('pcs'),
  description: z.string().trim().optional(),
  cost_price: z.coerce.number().min(0, 'Cost cannot be negative'),
  selling_price: z.coerce.number().min(0, 'Price cannot be negative'),
  taxable: z.coerce.boolean().optional(),
})
type FormValues = z.infer<typeof schema>
type Category = { id: string; name: string }
type Row = {
  id: string; sku: string; name: string; barcode: string | null; category_id: string | null; brand: string | null
  unit: string; description: string | null; selling_price: number; cost_price: number; taxable: boolean; is_active: boolean
}
type SortKey = 'name' | 'sku' | 'selling_price'

export default function Products() {
  const { org } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [q, setQ] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(''); const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [sort, setSort] = useState<SortKey>('name'); const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Row | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({}); const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const canEdit = allowed('editProducts', org?.role)

  const categories = useQuery({ queryKey: ['categories', org!.id], queryFn: async () => {
    const { data, error } = await supabase.from('categories').select('id,name').eq('org_id', org!.id).order('name')
    if (error) throw error; return (data ?? []) as Category[]
  } })
  const categoryName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name ?? '—'

  const list = useQuery({ queryKey: ['products', org!.id, page, q, categoryFilter, statusFilter, sort, dir], queryFn: async () => {
    let s = supabase.from('products').select('id,sku,name,barcode,category_id,brand,unit,description,selling_price,cost_price,taxable,is_active', { count: 'exact' }).eq('org_id', org!.id)
    if (q.trim()) { const term = q.trim(); s = s.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`) }
    if (categoryFilter) s = s.eq('category_id', categoryFilter)
    if (statusFilter !== 'all') s = s.eq('is_active', statusFilter === 'active')
    s = s.order(sort, { ascending: dir === 'asc' }).range(page * PAGE, page * PAGE + PAGE - 1)
    const { data, error, count } = await s; if (error) throw error
    return { rows: (data ?? []) as Row[], count: count ?? 0 }
  } })

  const addCategory = useMutation({
    mutationFn: async (name: string) => { const { error } = await supabase.from('categories').insert({ org_id: org!.id, name }); if (error) throw error },
    onSuccess: () => { setNewCategory(''); void qc.invalidateQueries({ queryKey: ['categories'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const renameCategory = useMutation({
    mutationFn: async (c: Category) => { const { error } = await supabase.from('categories').update({ name: c.name }).eq('id', c.id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }), onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const deleteCategory = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('categories').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['categories'] }); void qc.invalidateQueries({ queryKey: ['products'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        org_id: org!.id, name: v.name, barcode: v.barcode || null, category_id: v.category_id || null,
        brand: v.brand || null, unit: v.unit || 'pcs', description: v.description || null,
        cost_price: v.cost_price, selling_price: v.selling_price, taxable: v.taxable ?? true,
      }
      // sku is never sent: the database generates it on insert and it never changes on update (see 0006_auto_sku.sql).
      if (editing) { const { error } = await supabase.from('products').update(payload).eq('id', editing.id); if (error) throw error }
      else { const { error } = await supabase.from('products').insert(payload); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Product updated.' : 'Product added. Set its opening stock from the Inventory page.' }); setEditing(null); void qc.invalidateQueries({ queryKey: ['products'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const toggle = useMutation({ mutationFn: async (p: Row) => { const { error } = await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id); if (error) throw error },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }), onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = e.currentTarget
    const raw = Object.fromEntries(new FormData(f)) as Record<string, unknown>
    raw.taxable = (raw.taxable === 'on')
    const p = schema.safeParse(raw)
    if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); save.mutate(p.data, { onSuccess: () => f.reset() })
  }
  const sortHeader = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none p-3" onClick={() => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('asc') } }}>
      {label}{sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const inp = 'w-full rounded-lg border px-3 py-2'
  const field = (n: keyof FormValues, label: string, type = 'text', opts?: { step?: string }) =>
    <label className="block text-sm">{label}<input name={n} type={type} step={opts?.step} defaultValue={editing ? String((editing as unknown as Record<string, unknown>)[n] ?? '') : undefined} className={inp} />{errs[n] && <span className="text-xs text-red-700">{errs[n]}</span>}</label>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Products</h1>

      {canEdit && <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer font-medium">Categories ({categories.data?.length ?? 0})</summary>
        <div className="mt-3 space-y-2">
          {categories.data?.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <input defaultValue={c.name} className="flex-1 rounded border px-2 py-1" onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.name) renameCategory.mutate({ id: c.id, name: e.target.value.trim() }) }} />
              <button className="text-red-700 underline" onClick={() => { if (confirm(`Delete "${c.name}"? Products keep their other details but lose this category.`)) deleteCategory.mutate(c.id) }}>Delete</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" className="flex-1 rounded border px-2 py-1" />
            <button disabled={!newCategory.trim() || addCategory.isPending} onClick={() => addCategory.mutate(newCategory.trim())} className="rounded border bg-gray-50 px-3 py-1">Add</button>
          </div>
        </div>
      </details>}

      {canEdit && <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <p className="col-span-full text-sm font-medium">{editing ? `Editing ${editing.name}` : 'Add a product'}</p>
        {field('name', 'Name')}{field('barcode', 'Barcode (optional)')}
        {editing && <p className="block text-sm text-gray-600">SKU<br /><span className="font-mono">{editing.sku}</span> <span className="text-xs">(assigned automatically, cannot be changed)</span></p>}
        <label className="block text-sm">Category<select name="category_id" defaultValue={editing?.category_id ?? ''} className={inp}>
          <option value="">Uncategorized</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        {field('brand', 'Brand (optional)')}{field('unit', 'Unit', 'text')}
        {field('cost_price', 'Cost price', 'number', { step: 'any' })}{field('selling_price', 'Selling price', 'number', { step: 'any' })}
        <label className="block text-sm">Description (optional)<input name="description" defaultValue={editing?.description ?? ''} className={inp} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked={editing ? editing.taxable : true} /> Taxable</label>
        <div className="flex items-end gap-2">
          <button disabled={save.isPending} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60">{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button>
          {editing && <button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2">Cancel</button>}
        </div>
      </form>}
      {note && <p role="status" className={`rounded-lg p-3 text-sm ${note.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{note.t}</p>}

      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search name, SKU or barcode" aria-label="Search products" className={inp + ' bg-white sm:max-w-xs'} />
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0) }} className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="">All categories</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0) }} className="rounded-lg border bg-white px-3 py-2 text-sm">
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50"><tr>{sortHeader('sku', 'SKU')}{sortHeader('name', 'Name')}<th className="p-3">Category</th>{sortHeader('selling_price', 'Price')}<th className="p-3">Status</th><th className="p-3"></th></tr></thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={6}>Loading…</td></tr>}
          {list.isError && <tr><td className="p-4 text-red-700" colSpan={6}>Could not load products. <button className="underline" onClick={() => list.refetch()}>Retry</button></td></tr>}
          {list.data?.rows.length === 0 && <tr><td className="p-4 text-gray-600" colSpan={6}>No products match.</td></tr>}
          {list.data?.rows.map((p) => <tr key={p.id} className="border-t">
            <td className="p-3">{p.sku}</td><td className="p-3">{p.name}</td><td className="p-3">{categoryName(p.category_id)}</td>
            <td className="p-3">{Number(p.selling_price).toFixed(2)}</td>
            <td className="p-3">{p.is_active ? 'Active' : 'Inactive'}</td>
            <td className="space-x-3 p-3">{canEdit && <><button className="text-indigo-700 underline" onClick={() => setEditing(p)}>Edit</button>
              <button className="text-indigo-700 underline" onClick={() => toggle.mutate(p)}>{p.is_active ? 'Deactivate' : 'Activate'}</button></>}</td></tr>)}
        </tbody></table></div>
      <div className="flex items-center gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1.5 disabled:opacity-40">Previous</button>
        <span>Page {page + 1} of {Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))}</span>
        <button disabled={(page + 1) * PAGE >= (list.data?.count ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1.5 disabled:opacity-40">Next</button></div>
    </div>
  )
}
