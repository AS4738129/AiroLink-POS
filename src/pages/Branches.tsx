import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { allowed } from '../lib/permissions'
import { branchFormSchema, deactivationBlock, needsFirstAssignmentWarning, type BranchFormValues } from '../lib/branches'
import {
  Btn, Card, CrudIcon, Dialog, EmptyState, Field, Notice, PageHeaderOnDark, RowAction, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
} from '../components/ui'

type Branch = {
  id: string; name: string; address: string | null; phone: string | null
  is_main: boolean; is_active: boolean
}
type StaffMember = { user_id: string; role: string; full_name: string | null }
type Assignment = { branch_id: string; user_id: string }

// A branch name that already exists (unique(org_id, name) in the database).
const duplicateMessage = (e: unknown, fallback: string) => {
  const t = friendly(e)
  return /already exists/i.test(t) ? 'A branch with that name already exists.' : t || fallback
}

export default function Branches() {
  const { org } = useAuth(); const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<Branch | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null)
  const [confirmMain, setConfirmMain] = useState<Branch | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Branch | null>(null)
  const [pendingAssign, setPendingAssign] = useState<{ userId: string; branchId: string; userName: string } | null>(null)
  const [assignBranch, setAssignBranch] = useState<Record<string, string>>({})

  const canEditBranch = allowed('editBranches', org?.role)
  const canAssign = allowed('assignBranches', org?.role)

  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => {
    setQ(''); setStatusFilter('all'); setEditing(null); setFormOpen(false); setErrs({})
    setNote(null); setConfirmMain(null); setConfirmToggle(null); setPendingAssign(null); setAssignBranch({})
  }, [org!.id])

  const list = useQuery({ queryKey: ['branches', org!.id], queryFn: async () => {
    let s = supabase.from('branches').select('id,name,address,phone,is_main,is_active').eq('org_id', org!.id)
    if (q.trim()) s = s.ilike('name', `%${q.trim().replace(/[,()%]/g, ' ')}%`)
    if (statusFilter !== 'all') s = s.eq('is_active', statusFilter === 'active')
    const { data, error } = await s.order('name')
    if (error) throw error
    return (data ?? []) as Branch[]
  } })

  // Staff roster: existing organization_members rows (read through existing RLS),
  // with display names resolved from profiles the same way Sales.tsx does.
  const staff = useQuery({ queryKey: ['branches', org!.id, 'staff'], queryFn: async () => {
    const { data: members, error } = await supabase.from('organization_members').select('user_id,role').eq('org_id', org!.id)
    if (error) throw error
    const rows = (members ?? []) as { user_id: string; role: string }[]
    const names = new Map<string, string | null>()
    if (rows.length) {
      const { data: ps } = await supabase.from('profiles').select('id,full_name').in('id', rows.map((m) => m.user_id))
      ;(ps ?? []).forEach((p) => names.set(p.id as string, (p.full_name as string) ?? null))
    }
    return rows
      .map((m) => ({ user_id: m.user_id, role: m.role, full_name: names.get(m.user_id) ?? null }))
      .sort((a, b) => (a.full_name ?? a.user_id).localeCompare(b.full_name ?? b.user_id)) as StaffMember[]
  } })

  // Existing branch_members rows, narrowed client-side to this organization's
  // branches (the table itself carries no org_id; RLS already scoped the read).
  const assignments = useQuery({ queryKey: ['branches', org!.id, 'assignments'], queryFn: async () => {
    const { data, error } = await supabase.from('branch_members').select('branch_id,user_id')
    if (error) throw error
    return (data ?? []) as Assignment[]
  } })

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['branches'] })
  }

  const save = useMutation({
    mutationFn: async (v: BranchFormValues) => {
      const payload = {
        org_id: org!.id, name: v.name, address: v.address || null, phone: v.phone || null,
      }
      if (editing) { const { error } = await supabase.from('branches').update(payload).eq('id', editing.id); if (error) throw error }
      else { const { error } = await supabase.from('branches').insert(payload); if (error) throw error }
    },
    onSuccess: () => { setNote({ ok: true, t: editing ? 'Branch updated.' : 'Branch added.' }); setEditing(null); setFormOpen(false); invalidateAll() },
    onError: (e) => setNote({ ok: false, t: duplicateMessage(e, 'Could not save the branch.') }) })

  const toggle = useMutation({
    mutationFn: async (b: Branch) => {
      const { error } = await supabase.from('branches').update({ is_active: !b.is_active }).eq('id', b.id)
      if (error) throw error
    },
    onSuccess: () => { setConfirmToggle(null); setNote({ ok: true, t: 'Branch status updated.' }); invalidateAll() },
    onError: (e) => { setConfirmToggle(null); setNote({ ok: false, t: duplicateMessage(e, 'Could not update the branch.') }) } })

  // There is no atomic RPC for changing the main branch, so the UI moves the
  // flag in two updates: clear the old main, then set the new one. If the
  // second update fails, the first is rolled back so the organization is never
  // intentionally left with zero main branches (the partial unique index
  // guarantees two mains can never exist at once).
  const setMain = useMutation({
    mutationFn: async (target: Branch) => {
      const rows = (list.data ?? []) as Branch[]
      const current = rows.find((b) => b.is_main)
      if (current?.id === target.id) return
      if (current) {
        const { error: e1 } = await supabase.from('branches').update({ is_main: false }).eq('id', current.id)
        if (e1) throw e1
        const { error: e2 } = await supabase.from('branches').update({ is_main: true }).eq('id', target.id)
        if (e2) {
          const { error: r } = await supabase.from('branches').update({ is_main: true }).eq('id', current.id)
          if (r) throw new Error('Could not set the new main branch, and restoring the previous main branch also failed. Please reload and check which branch is marked main.')
          throw e2
        }
      } else {
        const { error } = await supabase.from('branches').update({ is_main: true }).eq('id', target.id)
        if (error) throw error
      }
    },
    onSuccess: () => { setConfirmMain(null); setNote({ ok: true, t: 'Main branch updated.' }); invalidateAll() },
    onError: (e) => { setConfirmMain(null); setNote({ ok: false, t: duplicateMessage(e, 'Could not change the main branch.') }) } })

  const assign = useMutation({
    mutationFn: async (v: { userId: string; branchId: string }) => {
      const { error } = await supabase.from('branch_members').insert({ branch_id: v.branchId, user_id: v.userId })
      if (error) throw error
    },
    onSuccess: () => { setPendingAssign(null); setNote({ ok: true, t: 'Branch assigned.' }); invalidateAll() },
    onError: (e) => { setPendingAssign(null); setNote({ ok: false, t: duplicateMessage(e, 'Could not assign the branch.') }) } })

  const unassign = useMutation({
    mutationFn: async (v: { userId: string; branchId: string }) => {
      const { error } = await supabase.from('branch_members').delete().eq('branch_id', v.branchId).eq('user_id', v.userId)
      if (error) throw error
    },
    onSuccess: () => { setNote({ ok: true, t: 'Branch assignment removed.' }); invalidateAll() },
    onError: (e) => setNote({ ok: false, t: duplicateMessage(e, 'Could not remove the assignment.') }) })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = e.currentTarget
    const raw = Object.fromEntries(new FormData(f)) as Record<string, unknown>
    const p = branchFormSchema.safeParse(raw)
    if (!p.success) { setErrs(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return }
    setErrs({}); save.mutate(p.data, { onSuccess: () => f.reset() })
  }
  const field = (n: keyof BranchFormValues, label: string, required = false) => (
    <Field label={label} required={required} error={errs[n]}>
      <input
        name={n}
        defaultValue={editing ? String((editing as unknown as Record<string, unknown>)[n] ?? '') : undefined}
        className={inputCls}
      />
    </Field>
  )

  const rows = (list.data ?? []) as Branch[]
  const branchById = new Map(rows.map((b) => [b.id, b]))
  // Only assignments pointing at this organization's branches (see query above).
  const orgAssignments = (assignments.data ?? []).filter((a) => branchById.has(a.branch_id))
  const assignedOf = (userId: string) => orgAssignments.filter((a) => a.user_id === userId).map((a) => a.branch_id)
  const staffName = (m: { full_name: string | null; user_id: string }) => m.full_name?.trim() || m.user_id.slice(0, 8)
  // Presentation-only role label (matches App.tsx): the stored role value is untouched.
  const roleText = (role: string) => (role === 'owner' ? 'Admin' : role.replace('_', ' '))

  const requestAssign = (m: StaffMember, branchId: string) => {
    if (!branchId) return
    // A user's first assignment restricts them to assigned branches only
    // (existing can_access_branch semantics) — require explicit confirmation.
    if (needsFirstAssignmentWarning(assignedOf(m.user_id))) {
      setPendingAssign({ userId: m.user_id, branchId, userName: staffName(m) })
    } else {
      assign.mutate({ userId: m.user_id, branchId })
    }
    setAssignBranch((s) => ({ ...s, [m.user_id]: '' }))
  }

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Branches"
        description="Branch locations, activation, main branch, and staff branch assignments."
        actions={canEditBranch ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setErrs({}); setFormOpen((v) => !v) }} aria-expanded={formOpen}>
            {formOpen ? (<><CrudIcon name="close" /> Close form</>) : (<><CrudIcon name="add" /> Add branch</>)}
          </Btn>
        ) : undefined}
      />
      {note && <Notice tone={note.ok ? 'ok' : 'err'}>{note.t}</Notice>}

      {canEditBranch && formOpen && (
        <Card className="p-4 sm:p-5">
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <p className="col-span-full border-b border-brand-100/70 pb-2 text-sm font-semibold text-slate-900">
              {editing ? `Editing ${editing.name}` : 'Add a branch'}
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                {editing ? 'Update the branch details, then save.' : 'Deactivation (not deletion) removes a branch from day-to-day use.'}
              </span>
            </p>
            {field('name', 'Name', true)}
            {field('phone', 'Phone')}
            {field('address', 'Address')}
            <div className="flex min-w-0 flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Btn variant="primary" disabled={save.isPending}>
                {save.isPending ? (<Spinner label="Saving…" />) : editing ? (<><CrudIcon name="save" /> Save changes</>) : (<><CrudIcon name="add" /> Add branch</>)}
              </Btn>
              <Btn type="button" onClick={() => { setEditing(null); setFormOpen(false) }}>
                <CrudIcon name="close" /> {editing ? 'Cancel' : 'Close'}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search branches" aria-label="Search branches" className={`${inputCls} sm:max-w-xs`} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Status filter" className={selectCls}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <TableShell label="Branches">
        <thead>
          <tr>
            <th className={thCls}>Name</th><th className={thCls}>Contact</th>
            <th className={thCls}>Status</th><th className={thCls}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {list.isLoading && <tr><td className="p-4" colSpan={4}><Spinner label="Loading branches…" /></td></tr>}
          {list.isError && (
            <tr><td className="p-4 text-red-700" colSpan={4}>
              Could not load branches.{' '}
              <RowAction icon="refresh" onClick={() => list.refetch()}>Retry</RowAction>
            </td></tr>
          )}
          {list.data && rows.length === 0 && (
            <tr><td colSpan={4}><EmptyState title={q.trim() || statusFilter !== 'all' ? 'No branches match these filters.' : 'No branches yet.'} hint={q.trim() || statusFilter !== 'all' ? 'Try a different search — or clear the filters to see every branch.' : 'Add your first branch above.'} /></td></tr>
          )}
          {rows.map((b) => {
            const block = deactivationBlock(rows, b.id)
            return (
              <tr key={b.id} className={rowCls}>
                <td className={`${tdCls} font-medium`}>
                  {b.name}{' '}
                  {b.is_main && <StatusBadge tone="blue">Main</StatusBadge>}
                </td>
                <td className={tdCls}>{[b.phone, b.address].filter(Boolean).join(' · ') || '—'}</td>
                <td className={tdCls}>
                  <StatusBadge tone={b.is_active ? 'green' : 'slate'}>{b.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {canEditBranch && (
                      <>
                        <RowAction icon="edit" onClick={() => { setEditing(b); setErrs({}); setFormOpen(true) }}>Edit</RowAction>
                        {!b.is_main && b.is_active && (
                          <RowAction icon="save" title="Make this the main branch" disabled={setMain.isPending} onClick={() => setConfirmMain(b)}>
                            Set as main
                          </RowAction>
                        )}
                        <RowAction
                          icon={b.is_active ? 'deactivate' : 'activate'}
                          danger={b.is_active}
                          disabled={toggle.isPending || (b.is_active && block !== null)}
                          title={b.is_active ? (block ?? 'Deactivates the branch (keeps its history)') : 'Reactivates the branch'}
                          onClick={() => { if (b.is_active && block) { setNote({ ok: false, t: block }); return } setConfirmToggle(b) }}
                        >
                          {b.is_active ? 'Deactivate' : 'Activate'}
                        </RowAction>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </TableShell>

      <Card className="p-4 sm:p-5">
        <h2 className="text-base font-bold text-ink-900">Staff branch assignments</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Staff with no assigned branches can access all branches. Assigning a staff member&apos;s first branch
          restricts them to assigned branches only.
        </p>
        <div className="mt-3 space-y-3">
          {staff.isLoading && <Spinner label="Loading staff…" />}
          {staff.isError && (
            <p className="text-sm text-red-700">
              Could not load staff.{' '}
              <RowAction icon="refresh" onClick={() => staff.refetch()}>Retry</RowAction>
            </p>
          )}
          {staff.data && staff.data.length === 0 && (
            <EmptyState title="No staff yet." hint="Staff appear here once they join this business." />
          )}
          {staff.data?.map((m) => {
            const mine = assignedOf(m.user_id)
            const unassigned = rows.filter((b) => b.is_active && !mine.includes(b.id))
            return (
              <div key={m.user_id} className="rounded-xl border border-brand-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold text-slate-900">
                    {staffName(m)}{' '}
                    <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold capitalize text-brand-800 ring-1 ring-inset ring-brand-200">
                      {roleText(m.role)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {mine.length === 0 ? 'All branches (unrestricted)' : `${mine.length} assigned`}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mine.length === 0 && <span className="text-xs text-slate-500">No specific branches assigned.</span>}
                  {mine.map((bid) => (
                    <span key={bid} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-900 ring-1 ring-inset ring-brand-200">
                      {branchById.get(bid)?.name ?? 'Unknown branch'}
                      {canAssign && (
                        <button
                          type="button"
                          onClick={() => unassign.mutate({ userId: m.user_id, branchId: bid })}
                          disabled={unassign.isPending}
                          aria-label={`Remove ${staffName(m)} from ${branchById.get(bid)?.name ?? 'branch'}`}
                          title="Remove this assignment"
                          className="rounded-full px-1 font-bold text-brand-700 hover:bg-brand-100 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {canAssign && (
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <select
                      value={assignBranch[m.user_id] ?? ''}
                      onChange={(e) => setAssignBranch((s) => ({ ...s, [m.user_id]: e.target.value }))}
                      aria-label={`Branch to assign to ${staffName(m)}`}
                      className={`${selectCls} min-w-0 flex-1`}
                    >
                      <option value="">Assign to a branch…</option>
                      {unassigned.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <Btn
                      type="button"
                      disabled={!(assignBranch[m.user_id] ?? '') || assign.isPending}
                      onClick={() => requestAssign(m, assignBranch[m.user_id] ?? '')}
                      className="min-h-[44px]"
                    >
                      <CrudIcon name="add" /> Assign
                    </Btn>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {confirmToggle && (
        <Dialog label={`${confirmToggle.is_active ? 'Deactivate' : 'Activate'} ${confirmToggle.name}`} onClose={() => setConfirmToggle(null)}>
          <p className="text-sm text-slate-600">
            {confirmToggle.is_active
              ? 'Deactivating removes this branch from day-to-day use. Its sales, inventory, purchase and expense history is kept.'
              : 'Reactivating returns this branch to day-to-day use.'}
          </p>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Btn type="button" onClick={() => setConfirmToggle(null)}><CrudIcon name="close" /> Cancel</Btn>
            <Btn type="button" variant={confirmToggle.is_active ? 'danger' : 'primary'} disabled={toggle.isPending} onClick={() => toggle.mutate(confirmToggle)} className="min-h-[44px]">
              {toggle.isPending ? (<Spinner label="Saving…" />) : confirmToggle.is_active ? 'Deactivate' : 'Activate'}
            </Btn>
          </div>
        </Dialog>
      )}

      {confirmMain && (
        <Dialog label={`Set ${confirmMain.name} as the main branch`} onClose={() => setConfirmMain(null)}>
          <p className="text-sm text-slate-600">
            The current main branch will stop being main. There is always exactly one main branch.
          </p>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Btn type="button" onClick={() => setConfirmMain(null)}><CrudIcon name="close" /> Cancel</Btn>
            <Btn type="button" variant="primary" disabled={setMain.isPending} onClick={() => setMain.mutate(confirmMain)} className="min-h-[44px]">
              {setMain.isPending ? (<Spinner label="Saving…" />) : 'Set as main'}
            </Btn>
          </div>
        </Dialog>
      )}

      {pendingAssign && (
        <Dialog label="Restrict branch access?" onClose={() => setPendingAssign(null)}>
          <p className="text-sm text-slate-600">
            {staffName({ user_id: pendingAssign.userId, full_name: pendingAssign.userName })} currently has access to
            all branches. Assigning this first branch will restrict them to assigned branches only.
          </p>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Btn type="button" onClick={() => setPendingAssign(null)}><CrudIcon name="close" /> Cancel</Btn>
            <Btn
              type="button"
              variant="primary"
              disabled={assign.isPending}
              onClick={() => assign.mutate({ userId: pendingAssign.userId, branchId: pendingAssign.branchId })}
              className="min-h-[44px]"
            >
              {assign.isPending ? (<Spinner label="Assigning…" />) : 'Assign first branch'}
            </Btn>
          </div>
        </Dialog>
      )}
    </div>
  )
}
