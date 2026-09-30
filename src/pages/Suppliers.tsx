import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import {
  Btn, Card, EmptyState, Field, Notice, PageHeader, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, tdCls, thCls, filterBarCls,
} from '../components/ui'

const PAGE = 20
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  contact_person: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  address: z.string().trim().optional(),
})
type FormValues = z.infer<typeof schema>
type Row = {
  id: string; name: string; contact_person: string | null; phone: string | null
  email: string | null; address: string | null; is_active: boolean
}

export default function Suppliers() {
  const { org } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [detail, setDetail] = useState<Row | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canEdit = allowed('editSuppliers', org?.role)
  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => { setPage(0); setQ(''); setStatusFilter('active'); setDetail(null); setEditing(null); setFormOpen(false); setErrs({}); setNote(null) }, [org!.id])

  const list = useQuery({ queryKey: ['suppliers', org!.id, page, q, statusFilter], queryFn: async () => {
    let s = supabase.from('suppliers').select('id,name,contact_person,phone,email,address,is_active', { count: 'exact' }).eq('org_id', org!.id)
    if (q.trim()) { const term = q.trim().replace(/[,()%]/g, ' '); s = s.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`) }
    if (statusFilter !== 'all') s = s.eq('is_active', statusFilter === 'active')
    const { data, error, count } = await s.order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    return { rows: (data ?? []) as Row[], count: count ?? 0 }
  } })

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        org_id: org!.id, name: v.name, contact_person: v.contact_person || null,
        phone: v.phone || null, email: v.email || null, address: v.address || null,
      }
      if (editing) { const { error } = await supabase.from('suppliers').update(payload).eq('id', editing.id); if (error) throw error }
      else { const { error } = await supabase.from('suppliers').insert(payload); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Supplier updated.' : 'Supplier added.' }); setEditing(null); setFormOpen(false); setDetail(null); void qc.invalidateQueries({ queryKey: ['suppliers'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const toggle = useMutation({
    mutationFn: async (s: Row) => { const { error } = await supabase.from('suppliers').update({ is_active: !s.is_active }).eq('id', s.id); if (error) throw error },
    onSuccess: () => { setDetail(null); void qc.invalidateQueries({ queryKey: ['suppliers'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = e.currentTarget
    const raw = Object.fromEntries(new FormData(f)) as Record<string, unknown>
    const p = schema.safeParse(raw)
    if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); save.mutate(p.data, { onSuccess: () => f.reset() })
  }
  const field = (n: keyof FormValues, label: string, type = 'text', required = false) => (
    <Field label={label} required={required} error={errs[n]}>
      <input
        name={n}
        type={type}
        defaultValue={editing ? String((editing as unknown as Record<string, unknown>)[n] ?? '') : undefined}
        className={inputCls}
      />
    </Field>
  )
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        description="Supplier directory and contact information."
        actions={canEdit ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setErrs({}); setFormOpen((v) => !v) }} aria-expanded={formOpen}>
            {formOpen ? 'Close form' : '+ Add supplier'}
          </Btn>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {canEdit && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full text-sm font-semibold text-slate-900">{editing ? `Editing ${editing.name}` : 'Add a supplier'}</p>
            {field('name', 'Name', 'text', true)}
            {field('contact_person', 'Contact person')}
            {field('phone', 'Phone')}
            {field('email', 'Email', 'email')}
            {field('address', 'Address')}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Btn variant="primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
              </Btn>
              <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}>
                {editing ? 'Cancel' : 'Close'}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search name, phone or email" aria-label="Search suppliers" className={`${inputCls} sm:max-w-xs`} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0) }} aria-label="Status filter" className="rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <TableShell label="Suppliers">
        <thead>
          <tr>
            <th className={thCls}>Name</th><th className={thCls}>Contact person</th><th className={thCls}>Phone</th>
            <th className={thCls}>Status</th><th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={5}><Spinner label="Loading suppliers…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={5}>
              Could not load suppliers. <button className="font-medium underline" onClick={() => list.refetch()}>Retry</button>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={5}><EmptyState title="No suppliers match." hint="Try a different search — or add a supplier above." /></td></tr>
          )}
          {list.data?.rows.map((s) => (
            <tr key={s.id} className={rowCls}>
              <td className={`${tdCls} font-medium`}>{s.name}</td>
              <td className={tdCls}>{s.contact_person ?? '—'}</td>
              <td className={tdCls}>{s.phone ?? '—'}</td>
              <td className={tdCls}>
                <StatusBadge tone={s.is_active ? 'green' : 'slate'}>{s.is_active ? 'Active' : 'Inactive'}</StatusBadge>
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>
                <button className="font-medium text-brand-700 hover:underline" onClick={() => setDetail(s)}>View</button>
                {canEdit && (
                  <>
                    <button className="ml-3 font-medium text-brand-700 hover:underline" onClick={() => { setEditing(s); setErrs({}); setFormOpen(true) }}>Edit</button>
                    <button className="ml-3 font-medium text-brand-700 hover:underline" onClick={() => toggle.mutate(s)}>
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <Btn disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn>
        <span>Page {page + 1} of {pages}</span>
        <Btn disabled={(page + 1) * PAGE >= (list.data?.count ?? 0)} onClick={() => setPage(page + 1)}>Next</Btn>
      </div>

      {detail && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-label={`Supplier ${detail.name}`} className="w-full max-w-sm space-y-2 rounded-2xl border border-brand-100 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{detail.name}</h2>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <dl className="space-y-1 text-sm">
              {[['Contact person', detail.contact_person], ['Phone', detail.phone], ['Email', detail.email], ['Address', detail.address]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v || '—'}</dd></div>
              ))}
            </dl>
            <div className="flex justify-end gap-2">
              <Btn type="button" onClick={() => setDetail(null)}>Close</Btn>
              {canEdit && <Btn variant="primary" onClick={() => { setEditing(detail); setErrs({}); setFormOpen(true); setDetail(null) }}>Edit</Btn>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
