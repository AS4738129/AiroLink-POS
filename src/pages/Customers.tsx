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
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  address: z.string().trim().optional(),
  credit_limit: z.coerce.number().min(0, 'Credit limit cannot be negative'),
})
type FormValues = z.infer<typeof schema>
type Row = {
  id: string; name: string; phone: string | null; email: string | null; address: string | null
  credit_limit: number; balance: number; is_active: boolean
}

export default function Customers() {
  const { org } = useAuth(); const qc = useQueryClient()
  const [page, setPage] = useState(0); const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [detail, setDetail] = useState<Row | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const canEdit = allowed('editCustomers', org?.role)
  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => { setPage(0); setQ(''); setStatusFilter('active'); setDetail(null); setEditing(null); setFormOpen(false); setErrs({}); setNote(null) }, [org!.id])

  const list = useQuery({ queryKey: ['customers', org!.id, page, q, statusFilter], queryFn: async () => {
    let s = supabase.from('customers').select('id,name,phone,email,address,credit_limit,balance,is_active', { count: 'exact' }).eq('org_id', org!.id)
    if (q.trim()) { const term = q.trim().replace(/[,()%]/g, ' '); s = s.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`) }
    if (statusFilter !== 'all') s = s.eq('is_active', statusFilter === 'active')
    const { data, error, count } = await s.order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw error
    return { rows: (data ?? []) as Row[], count: count ?? 0 }
  } })

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        org_id: org!.id, name: v.name, phone: v.phone || null, email: v.email || null,
        address: v.address || null, credit_limit: v.credit_limit,
      }
      // balance is never sent: it only ever changes through the sales/void ledger (see guard_ledger).
      if (editing) { const { error } = await supabase.from('customers').update(payload).eq('id', editing.id); if (error) throw error }
      else { const { error } = await supabase.from('customers').insert({ ...payload, balance: 0 }); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Customer updated.' : 'Customer added.' }); setEditing(null); setFormOpen(false); setDetail(null); void qc.invalidateQueries({ queryKey: ['customers'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })
  const toggle = useMutation({
    mutationFn: async (c: Row) => { const { error } = await supabase.from('customers').update({ is_active: !c.is_active }).eq('id', c.id); if (error) throw error },
    onSuccess: () => { setDetail(null); void qc.invalidateQueries({ queryKey: ['customers'] }) },
    onError: (e) => setNote({ ok: false, t: friendly(e) }) })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = e.currentTarget
    const raw = Object.fromEntries(new FormData(f)) as Record<string, unknown>
    const p = schema.safeParse(raw)
    if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); save.mutate(p.data, { onSuccess: () => f.reset() })
  }
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
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Customer directory, contact details and credit balances."
        actions={canEdit ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setErrs({}); setFormOpen((v) => !v) }} aria-expanded={formOpen}>
            {formOpen ? 'Close form' : '+ Add customer'}
          </Btn>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {canEdit && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full text-sm font-semibold text-slate-900">{editing ? `Editing ${editing.name}` : 'Add a customer'}</p>
            {field('name', 'Name', 'text', { required: true })}
            {field('phone', 'Phone')}
            {field('email', 'Email', 'email')}
            {field('address', 'Address')}
            {field('credit_limit', 'Credit limit', 'number', { step: 'any', required: true })}
            {editing && (
              <p className="self-end text-sm text-slate-600">
                Balance<br />
                <span className="font-mono font-medium text-slate-900">{org!.currency} {Number(editing.balance).toFixed(2)}</span>{' '}
                <span className="text-xs">(updated only by sales and voids)</span>
              </p>
            )}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Btn variant="primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add customer'}
              </Btn>
              <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}>
                {editing ? 'Cancel' : 'Close'}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search name, phone or email" aria-label="Search customers" className={`${inputCls} sm:max-w-xs`} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0) }} aria-label="Status filter" className="rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <TableShell label="Customers">
        <thead>
          <tr>
            <th className={thCls}>Name</th><th className={thCls}>Phone</th>
            <th className={`${thCls} text-right`}>Balance</th><th className={`${thCls} text-right`}>Credit limit</th>
            <th className={thCls}>Status</th><th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={6}><Spinner label="Loading customers…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={6}>
              Could not load customers. <button className="font-medium underline" onClick={() => list.refetch()}>Retry</button>
            </td></tr>
          )}
          {list.data && list.data.rows.length === 0 && (
            <tr><td colSpan={6}><EmptyState title="No customers match." hint="Try a different search — or add a customer above." /></td></tr>
          )}
          {list.data?.rows.map((c) => (
            <tr key={c.id} className={rowCls}>
              <td className={`${tdCls} font-medium`}>{c.name}</td>
              <td className={tdCls}>{c.phone ?? '—'}</td>
              <td className={`${tdCls} text-right font-mono ${Number(c.balance) > 0 ? 'font-semibold text-amber-800' : ''}`}>
                {org!.currency} {Number(c.balance).toFixed(2)}
              </td>
              <td className={`${tdCls} text-right font-mono`}>{org!.currency} {Number(c.credit_limit).toFixed(2)}</td>
              <td className={tdCls}>
                <StatusBadge tone={c.is_active ? 'green' : 'slate'}>{c.is_active ? 'Active' : 'Inactive'}</StatusBadge>
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>
                <button className="font-medium text-brand-700 hover:underline" onClick={() => setDetail(c)}>View</button>
                {canEdit && (
                  <>
                    <button className="ml-3 font-medium text-brand-700 hover:underline" onClick={() => { setEditing(c); setErrs({}); setFormOpen(true) }}>Edit</button>
                    <button className="ml-3 font-medium text-brand-700 hover:underline" onClick={() => toggle.mutate(c)}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
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
          <div role="dialog" aria-label={`Customer ${detail.name}`} className="w-full max-w-sm space-y-2 rounded-2xl border border-brand-100 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{detail.name}</h2>
              <button type="button" onClick={() => setDetail(null)} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <dl className="space-y-1 text-sm">
              {[['Phone', detail.phone], ['Email', detail.email], ['Address', detail.address]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v || '—'}</dd></div>
              ))}
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Balance</dt><dd className="font-mono font-semibold text-slate-900">{org!.currency} {Number(detail.balance).toFixed(2)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Credit limit</dt><dd className="font-mono font-medium text-slate-900">{org!.currency} {Number(detail.credit_limit).toFixed(2)}</dd></div>
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
