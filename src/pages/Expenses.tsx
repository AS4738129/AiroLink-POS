import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { METHODS, methodLabel } from '../lib/payments'
import {
  Btn, Card, CrudIcon, Dialog, EmptyState, Field, Notice, PageHeaderOnDark, Pager, RowAction, Spinner,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
} from '../components/ui'


const PAGE = 20
const METHOD_VALUES = METHODS.map(([v]) => v) as unknown as [string, ...string[]]

const schema = z.object({
  branch_id: z.string().min(1, 'Branch is required'),
  category_id: z.string().min(1, 'Category is required'),
  amount: z.coerce.number().gt(0, 'Amount must be greater than zero'),
  description: z.string().trim().optional(),
  payment_method: z.enum(METHOD_VALUES),
  expense_date: z.string().min(1, 'Date is required'),
})
type FormValues = z.infer<typeof schema>
type Row = {
  id: string; branch_id: string; category_id: string; amount: number
  description: string | null; payment_method: string; expense_date: string; created_at: string
}
type Category = { id: string; name: string; description: string | null }

const catSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().optional(),
})

export default function Expenses() {
  const { org, branch, branches } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [q, setQ] = useState('')
  const [branchId, setBranchId] = useState(''); const [categoryId, setCategoryId] = useState('')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [detail, setDetail] = useState<Row | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [catErrs, setCatErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canEdit = allowed('editExpenses', org?.role)
  const canDelete = allowed('deleteExpenses', org?.role)
  const reset = () => setPage(0)
  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => {
    setPage(0); setQ(''); setBranchId(''); setCategoryId(''); setFrom(''); setTo('')
    setDetail(null); setEditing(null); setFormOpen(false); setCatsOpen(false)
    setEditingCat(null); setErrs({}); setCatErrs({}); setNote(null)
  }, [org!.id])
  const [branchDefault, setBranchDefault] = useState('')
  // Default the form's branch to the current branch when opening a fresh form.
  const openForm = () => {
    setEditing(null); setErrs({})
    if (branch) setBranchDefault(branch.id)
    setFormOpen(true)
  }

  const cats = useQuery({ queryKey: ['expense-categories', org!.id], queryFn: async () => {
    const { data, error } = await supabase.from('expense_categories').select('id,name,description').eq('org_id', org!.id).order('name')
    if (error) throw error; return (data ?? []) as Category[]
  } })
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? '—'
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—'

  // RLS already limits rows to the branches this user may see; the branch filter only narrows further.
  // Expenses filter on expense_date (a date column): inclusive of both selected days.
  const list = useQuery({ queryKey: ['expenses', org!.id, branchId, categoryId, from, to, page, q], queryFn: async () => {
    let s = supabase.from('expenses').select('id,branch_id,category_id,amount,description,payment_method,expense_date,created_at', { count: 'exact' }).eq('org_id', org!.id)
    if (branchId) s = s.eq('branch_id', branchId)
    if (categoryId) s = s.eq('category_id', categoryId)
    if (from) s = s.gte('expense_date', from)
    if (to) s = s.lt('expense_date', to < '9999-12-31' ? (() => { const d = new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })() : to)
    if (q.trim()) s = s.ilike('description', `%${q.trim().replace(/[,()%]/g, '')}%`)
    const { data, error, count } = await s.order('expense_date', { ascending: false }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    return { rows: (data ?? []) as Row[], count: count ?? 0 }
  } })

  const invalidateAfterWrite = () => {
    void qc.invalidateQueries({ queryKey: ['expenses'] })
    void qc.invalidateQueries({ queryKey: ['dashboard-totals'] })
    void qc.invalidateQueries({ queryKey: ['report-expenses'] })
  }

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        org_id: org!.id, branch_id: v.branch_id, category_id: v.category_id,
        amount: v.amount, description: v.description?.trim() || null,
        payment_method: v.payment_method, expense_date: v.expense_date,
      }
      if (editing) { const { error } = await supabase.from('expenses').update(payload).eq('id', editing.id); if (error) throw error }
      else { const { error } = await supabase.from('expenses').insert(payload); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Expense updated.' : 'Expense recorded.' }); setEditing(null); setFormOpen(false); setDetail(null); setBranchDefault(''); invalidateAfterWrite() },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const remove = useMutation({
    mutationFn: async (r: Row) => { const { error } = await supabase.from('expenses').delete().eq('id', r.id); if (error) throw error },
    onSuccess: () => { setNote({ ok: true, t: 'Expense deleted.' }); setDetail(null); invalidateAfterWrite() },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const saveCat = useMutation({
    mutationFn: async (v: { name: string; description?: string }) => {
      const payload = { org_id: org!.id, name: v.name, description: v.description?.trim() || null }
      if (editingCat) { const { error } = await supabase.from('expense_categories').update(payload).eq('id', editingCat.id); if (error) throw error }
      else { const { error } = await supabase.from('expense_categories').insert(payload); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editingCat ? 'Category updated.' : 'Category added.' }); setEditingCat(null); void qc.invalidateQueries({ queryKey: ['expense-categories'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const removeCat = useMutation({
    mutationFn: async (c: Category) => { const { error } = await supabase.from('expense_categories').delete().eq('id', c.id); if (error) throw error },
    onSuccess: () => { setNote({ ok: true, t: 'Category deleted.' }); void qc.invalidateQueries({ queryKey: ['expense-categories'] }) },
    onError: (e) => setNote({ ok: false, t: e instanceof Error && /foreign key|restrict/i.test(e.message) ? 'That category has expenses and cannot be deleted.' : friendly(e) }) })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const raw = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>
    const p = schema.safeParse(raw)
    if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); save.mutate(p.data)
  }
  const submitCat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = e.currentTarget
    const raw = Object.fromEntries(new FormData(f)) as Record<string, unknown>
    const p = catSchema.safeParse(raw)
    if (!p.success) { setCatErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setCatErrs({}); saveCat.mutate(p.data, { onSuccess: () => f.reset() })
  }
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Expenses"
        description="Business spending by branch and category."
        actions={canEdit ? (
          <>
            <Btn onClick={() => { setCatsOpen((v) => !v); setEditingCat(null); setCatErrs({}) }} aria-expanded={catsOpen}>
              Categories
            </Btn>
            <Btn variant="primary" onClick={() => { if (formOpen) { setEditing(null); setFormOpen(false) } else openForm() }} aria-expanded={formOpen}>
              {formOpen ? (<><CrudIcon name="close" /> Close form</>) : (<><CrudIcon name="add" /> Record expense</>)}
            </Btn>
          </>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {catsOpen && (
        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-bold tracking-tight text-ink-900">Expense categories</h2>
          <p className="mt-0.5 text-xs text-slate-500">Your business&apos;s own categories (e.g. Rent, Utilities, Transport, Salary, Marketing, Maintenance, Other). A category with expenses cannot be deleted.</p>
          {cats.isLoading ? <p className="py-4 text-center"><Spinner label="Loading categories…" /></p>
            : cats.isError ? <p className="py-2 text-sm text-red-700">Could not load categories.</p>
            : (cats.data?.length ?? 0) === 0 ? <EmptyState title="No categories yet." hint="Add your first category below." />
            : (
              <ul className="mt-2 divide-y divide-brand-100/70">
                {cats.data!.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{c.name}</p>
                      {c.description && <p className="truncate text-xs text-slate-500">{c.description}</p>}
                    </div>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <RowAction icon="edit" onClick={() => { setEditingCat(c); setCatErrs({}) }}>Edit</RowAction>
                        {canDelete && <RowAction icon="delete" danger onClick={() => removeCat.mutate(c)}>Delete</RowAction>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          {canEdit && (
            <form key={editingCat?.id ?? 'new-cat'} onSubmit={submitCat} className="mt-3 grid items-start gap-3 border-t border-brand-100/70 pt-3 sm:grid-cols-3">
              <p className="col-span-full text-sm font-semibold text-slate-900">{editingCat ? `Editing ${editingCat.name}` : 'Add a category'}</p>
              <Field label="Name" required error={catErrs.name}>
                <input name="name" defaultValue={editingCat?.name ?? ''} className={inputCls} maxLength={80} />
              </Field>
              <Field label="Description" error={catErrs.description}>
                <input name="description" defaultValue={editingCat?.description ?? ''} className={inputCls} />
              </Field>
              <span className="flex min-w-0 flex-wrap items-end gap-2">
                <Btn type="submit" variant="primary" disabled={saveCat.isPending}>{saveCat.isPending ? 'Saving…' : editingCat ? 'Save' : 'Add'}</Btn>
                {editingCat && <Btn type="button" onClick={() => setEditingCat(null)}>Cancel</Btn>}
              </span>
            </form>
          )}
        </Card>
      )}

      {canEdit && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full border-b border-brand-100/70 pb-2 text-sm font-semibold text-slate-900">
              {editing ? 'Editing expense' : 'Record an expense'}
              <span className="mt-0.5 block text-xs font-normal text-slate-500">Amounts must be greater than zero — the database rejects zero and negative amounts.</span>
            </p>
            <Field label="Branch" required error={errs.branch_id}>
              <select name="branch_id" defaultValue={editing?.branch_id ?? branchDefault} className={selectCls}>
                <option value="">Select branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Category" required error={errs.category_id}>
              <select name="category_id" defaultValue={editing?.category_id ?? ''} className={selectCls}>
                <option value="">Select category…</option>
                {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Amount" required error={errs.amount}>
              <input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing ? String(editing.amount) : ''} className={inputCls} placeholder="0.00" />
            </Field>
            <Field label="Payment method" required error={errs.payment_method}>
              <select name="payment_method" defaultValue={editing?.payment_method ?? 'cash'} className={selectCls}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Expense date" required error={errs.expense_date}>
              <input name="expense_date" type="date" defaultValue={editing?.expense_date ?? todayStr()} max={todayStr()} className={selectCls} />
            </Field>
            <Field label="Description" error={errs.description}>
              <input name="description" defaultValue={editing?.description ?? ''} className={inputCls} placeholder="What was this for?" />
            </Field>
            <span className="flex items-end gap-2">
              <Btn type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save expense'}</Btn>
              {editing && <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}>Cancel</Btn>}
            </span>
          </form>
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => { setQ(e.target.value); reset() }} placeholder="Search description" aria-label="Search description" className={`${inputCls} sm:max-w-[12rem]`} />
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset() }} aria-label="From date" className={selectCls} />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset() }} aria-label="To date" className={selectCls} />
        {branches.length > 1 && <select value={branchId} onChange={(e) => { setBranchId(e.target.value); reset() }} aria-label="Branch filter" className={selectCls}><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); reset() }} aria-label="Category filter" className={selectCls}><option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>

      <TableShell label="Expenses">
        <thead>
          <tr>
            {['Date', 'Description', 'Branch', 'Category', 'Method', 'Amount', ''].map((h) => (
              <th key={h} className={thCls}>{h === '' ? <span className="sr-only">Actions</span> : h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={7}><Spinner label="Loading expenses…" /></td></tr>}
          {list.isError && <tr><td className="p-4 text-sm text-red-700" colSpan={7}>Could not load expenses.</td></tr>}
          {list.data && list.data.rows.length === 0 && <tr><td className="p-4" colSpan={7}><EmptyState title="No expenses found." hint="Recorded spending in this period will appear here." /></td></tr>}
          {list.data?.rows.map((r) => (
            <tr key={r.id} className={rowCls}>
              <td className={`${tdCls} whitespace-nowrap`}>{new Date(`${r.expense_date}T00:00:00`).toLocaleDateString()}</td>
              <td className={`${tdCls} max-w-[14rem] truncate`}>{r.description || '—'}</td>
              <td className={tdCls}>{branchName(r.branch_id)}</td>
              <td className={tdCls}>{catName(r.category_id)}</td>
              <td className={tdCls}>{methodLabel(r.payment_method)}</td>
              <td className={`${tdCls} whitespace-nowrap font-bold`}>{Number(r.amount).toFixed(2)}</td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                <RowAction icon="view" onClick={() => setDetail(r)}>View</RowAction>
                {canEdit && <RowAction icon="edit" onClick={() => { setEditing(r); setErrs({}); setFormOpen(true) }}>Edit</RowAction>}
                {canDelete && <RowAction icon="delete" danger onClick={() => remove.mutate(r)}>Delete</RowAction>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {list.data && list.data.count > PAGE && (
        <Pager page={page} total={list.data.count} pageSize={PAGE} onPrev={() => setPage((p) => Math.max(0, p - 1))} onNext={() => setPage((p) => p + 1)} />
      )}

      {detail && (
        <Dialog label="Expense detail" onClose={() => setDetail(null)}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Date</dt><dd className="font-medium">{new Date(`${detail.expense_date}T00:00:00`).toLocaleDateString()}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Amount</dt><dd className="font-bold">{Number(detail.amount).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Category</dt><dd className="font-medium">{catName(detail.category_id)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Branch</dt><dd className="font-medium">{branchName(detail.branch_id)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Method</dt><dd className="font-medium">{methodLabel(detail.payment_method)}</dd></div>
            {detail.description && <div><dt className="text-slate-500">Description</dt><dd className="mt-0.5 font-medium">{detail.description}</dd></div>}
          </dl>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            {canEdit && <Btn onClick={() => { setEditing(detail); setErrs({}); setFormOpen(true); setDetail(null) }}>Edit</Btn>}
            <Btn onClick={() => setDetail(null)}>Close</Btn>
          </div>
        </Dialog>
      )}
    </div>
  )
}
