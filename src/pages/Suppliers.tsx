import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import {
  Btn, Card, CrudIcon, Dialog, EmptyState, Field, Notice, PageHeaderOnDark, Pager, RowAction, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
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

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Suppliers"
        description="Supplier directory and contact information."
        actions={canEdit ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setErrs({}); setFormOpen((v) => !v) }} aria-expanded={formOpen}>
            {formOpen ? (<><CrudIcon name="close" /> Close form</>) : (<><CrudIcon name="add" /> Add supplier</>)}
          </Btn>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {canEdit && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full border-b border-brand-100/70 pb-2 text-sm font-semibold text-slate-900">
              {editing ? `Editing ${editing.name}` : 'Add a supplier'}
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                {editing ? 'Update the contact details, then save.' : 'Deactivation (not deletion) removes a supplier from day-to-day use.'}
              </span>
            </p>
            {field('name', 'Name', 'text', true)}
            {field('contact_person', 'Contact person')}
            {field('phone', 'Phone')}
            {field('email', 'Email', 'email')}
            {field('address', 'Address')}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Btn variant="primary" disabled={save.isPending}>
                {save.isPending ? (<Spinner label="Saving…" />) : editing ? (<><CrudIcon name="save" /> Save changes</>) : (<><CrudIcon name="add" /> Add supplier</>)}
              </Btn>
              <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}>
                <CrudIcon name="close" /> {editing ? 'Cancel' : 'Close'}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search name, phone or email" aria-label="Search suppliers" className={`${inputCls} sm:max-w-xs`} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0) }} aria-label="Status filter" className={selectCls}>
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
              Could not load suppliers.{' '}
              <RowAction icon="refresh" onClick={() => list.refetch()}>Retry</RowAction>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={5}><EmptyState title={q.trim() || statusFilter !== 'all' ? 'No suppliers match these filters.' : 'No suppliers yet.'} hint={q.trim() || statusFilter !== 'all' ? 'Try a different search — or clear the filters to see everyone.' : 'Add your first supplier above to start creating purchases.'} /></td></tr>
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
                <span className="inline-flex items-center gap-1">
                  <RowAction icon="view" onClick={() => setDetail(s)}>View</RowAction>
                  {canEdit && (
                    <>
                      <RowAction icon="edit" onClick={() => { setEditing(s); setErrs({}); setFormOpen(true) }}>Edit</RowAction>
                      <RowAction
                        icon={s.is_active ? 'deactivate' : 'activate'}
                        danger={s.is_active}
                        disabled={toggle.isPending}
                        title={s.is_active ? 'Deactivates the supplier (keeps their history)' : 'Reactivates the supplier'}
                        onClick={() => toggle.mutate(s)}
                      >
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </RowAction>
                    </>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pager page={page} total={list.data?.count ?? 0} pageSize={PAGE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />

      {detail && (
        <Dialog label={detail.name} onClose={() => setDetail(null)}>
          <dl className="space-y-1 text-sm">
            {[['Contact person', detail.contact_person], ['Phone', detail.phone], ['Email', detail.email], ['Address', detail.address]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v || '—'}</dd></div>
            ))}
          </dl>
          <div className="flex justify-end gap-2">
            <Btn type="button" onClick={() => setDetail(null)}><CrudIcon name="close" /> Close</Btn>
            {canEdit && <Btn variant="primary" onClick={() => { setEditing(detail); setErrs({}); setFormOpen(true); setDetail(null) }}><CrudIcon name="edit" /> Edit</Btn>}
          </div>
        </Dialog>
      )}
    </div>
  )
}
