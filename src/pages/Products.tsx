import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import {
  Btn, Card, CrudIcon, EmptyState, Field, Notice, PageHeaderOnDark, Pager, RowAction, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
} from '../components/ui'

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
  const [formOpen, setFormOpen] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({}); const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const canEdit = allowed('editProducts', org?.role)
  // Reset page-local list state on organization change so the old org's filters/page never linger.
  useEffect(() => { setPage(0); setQ(''); setCategoryFilter(''); setStatusFilter('active'); setSort('name'); setDir('asc'); setEditing(null); setFormOpen(false); setErrs({}); setNote(null); setNewCategory('') }, [org!.id])

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
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Product updated.' : 'Product added. Set its opening stock from the Inventory page.' }); setEditing(null); setFormOpen(false); void qc.invalidateQueries({ queryKey: ['products'] }) },
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
    <th className={thCls} aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('asc') } }}
        aria-label={`Sort by ${label}`}
        className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wide hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        {label}{sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  const field = (n: keyof FormValues, label: string, type = 'text', opts?: { step?: string; required?: boolean }) => (
    <Field label={label} required={opts?.required} error={errs[n]}>
      <input
        name={n}
        type={type}
        step={opts?.step}
        defaultValue={editing ? String((editing as unknown as Record<string, unknown>)[n] ?? '') : undefined}
        className={inputCls}
      />
    </Field>
  )

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Products"
        description="Catalogue, pricing and categories. Stock lives on the Inventory page."
        actions={canEdit ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setErrs({}); setFormOpen((v) => !v) }} aria-expanded={formOpen}>
            {formOpen ? (<><CrudIcon name="close" /> Close form</>) : (<><CrudIcon name="add" /> Add product</>)}
          </Btn>
        ) : undefined}
      />

      {canEdit && (
        <details className="rounded-xl border border-brand-100 bg-white p-4 shadow-[0_1px_2px_rgba(11,37,69,0.05),0_8px_24px_-12px_rgba(28,109,217,0.18)]">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Categories ({categories.data?.length ?? 0})
          </summary>
          <div className="mt-3 space-y-2">
            {categories.data?.map((c) => (
              <div key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
                <input
                  defaultValue={c.name}
                  aria-label={`Rename category ${c.name}`}
                  className={`${inputCls} min-w-0 flex-1 py-1`}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.name) renameCategory.mutate({ id: c.id, name: e.target.value.trim() }) }}
                />
                <button className="shrink-0 font-medium text-red-700 hover:underline" onClick={() => { if (confirm(`Delete "${c.name}"? Products keep their other details but lose this category.`)) deleteCategory.mutate(c.id) }}>
                  Delete
                </button>
              </div>
            ))}
            <div className="flex min-w-0 gap-2">
              <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" aria-label="New category name" className={`${inputCls} min-w-0 flex-1 py-1`} />
              <Btn disabled={!newCategory.trim() || addCategory.isPending} onClick={() => addCategory.mutate(newCategory.trim())} className="shrink-0">
                Add
              </Btn>
            </div>
          </div>
        </details>
      )}

      {canEdit && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full border-b border-brand-100/70 pb-2 text-sm font-semibold text-slate-900">
              {editing ? `Editing ${editing.name}` : 'Add a product'}
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                {editing ? 'Update the product details, then save.' : 'Describe the product once — its SKU is assigned automatically after adding.'}
              </span>
            </p>
            {field('name', 'Name', 'text', { required: true })}
            {field('barcode', 'Barcode (optional)')}
            {editing && (
              <p className="text-sm text-slate-600">
                SKU<br />
                <span className="font-mono font-medium text-slate-900">{editing.sku}</span>{' '}
                <span className="text-xs">(assigned automatically, cannot be changed)</span>
              </p>
            )}
            <Field label="Category">
              <select name="category_id" defaultValue={editing?.category_id ?? ''} className={selectCls + ' w-full'} disabled={categories.isLoading}>
                <option value="">{categories.isLoading ? 'Loading categories…' : 'Uncategorized'}</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {field('brand', 'Brand (optional)')}
            {field('unit', 'Unit', 'text', { required: true })}
            {field('cost_price', 'Cost price', 'number', { step: 'any', required: true })}
            {field('selling_price', 'Selling price', 'number', { step: 'any', required: true })}
            <Field label="Description (optional)">
              <input name="description" defaultValue={editing?.description ?? ''} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="taxable" defaultChecked={editing ? editing.taxable : true} className="size-4 accent-brand-600" /> Taxable
            </label>
            <div className="flex min-w-0 flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Btn variant="primary" disabled={save.isPending}>
                {save.isPending ? (<><Spinner label="Saving…" /></>) : editing ? (<><CrudIcon name="save" /> Save changes</>) : (<><CrudIcon name="add" /> Add product</>)}
              </Btn>
              {editing ? (
                <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}><CrudIcon name="close" /> Cancel</Btn>
              ) : (
                <Btn type="button" onClick={() => setFormOpen(false)}><CrudIcon name="close" /> Close</Btn>
              )}
            </div>
          </form>
        </Card>
      )}
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search name, SKU or barcode" aria-label="Search products" className={`${inputCls} sm:max-w-xs`} />
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0) }} aria-label="Category filter" className={selectCls}>
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0) }} aria-label="Status filter" className={selectCls}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <TableShell label="Products">
        <thead>
          <tr>
            {sortHeader('sku', 'SKU')}
            {sortHeader('name', 'Name')}
            <th className={thCls}>Category</th>
            {sortHeader('selling_price', 'Price')}
            <th className={thCls}>Status</th>
            <th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={6}><Spinner label="Loading products…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={6}>
              Could not load products.{' '}
              <RowAction icon="refresh" onClick={() => list.refetch()}>Retry</RowAction>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={6}><EmptyState title={q.trim() || categoryFilter || statusFilter !== 'all' ? 'No products match these filters.' : 'No products yet.'} hint={q.trim() || categoryFilter || statusFilter !== 'all' ? 'Try a different search or filter — or clear them to see everything.' : 'Add your first product above to start selling.'} /></td></tr>
          )}
          {list.data?.rows.map((p) => (
            <tr key={p.id} className={rowCls}>
              <td className={`${tdCls} font-mono text-xs`}>{p.sku}</td>
              <td className={`${tdCls} font-medium`}>{p.name}</td>
              <td className={tdCls}>{categoryName(p.category_id)}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{org!.currency} {Number(p.selling_price).toFixed(2)}</td>
              <td className={tdCls}>
                <StatusBadge tone={p.is_active ? 'green' : 'slate'}>{p.is_active ? 'Active' : 'Inactive'}</StatusBadge>
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>
                {canEdit && (
                  <span className="inline-flex items-center gap-1">
                    <RowAction icon="edit" onClick={() => { setEditing(p); setErrs({}); setFormOpen(true) }}>Edit</RowAction>
                    <RowAction
                      icon={p.is_active ? 'deactivate' : 'activate'}
                      danger={p.is_active}
                      disabled={toggle.isPending}
                      title={p.is_active ? 'Deactivates the product (keeps its history)' : 'Reactivates the product'}
                      onClick={() => toggle.mutate(p)}
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </RowAction>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pager page={page} total={list.data?.count ?? 0} pageSize={PAGE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
    </div>
  )
}
