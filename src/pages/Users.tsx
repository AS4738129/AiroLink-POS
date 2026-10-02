// Phase 6C-1 — Users / Staff read-only roster.
//
// Reads ONLY through existing RLS-protected structures: organization_members
// (mem_sel), profiles (prof_sel), branches (branch_sel/branch_visible) and
// branch_members (branch_mem_sel). No INSERT/UPDATE/DELETE, no invite, no
// role change, no removal. The org id always comes from the session context.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, friendly } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { accessSummary, roleText, staffDisplayName } from '../lib/users'
import {
  Card, EmptyState, Notice, PageHeaderOnDark, RowAction, Spinner, StatusBadge,
  TableShell, inputCls, rowCls, selectCls, tdCls, thCls, filterBarCls, pageCanvasCls,
} from '../components/ui'

type StaffRow = { user_id: string; role: string; full_name: string | null; branchNames: string[] }

export default function Users() {
  const { org } = useAuth()
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | string>('all')

  // Reset page-local state on organization change so the old org's filters never linger.
  useEffect(() => { setQ(''); setRoleFilter('all') }, [org!.id])

  const roster = useQuery({ queryKey: ['users', org!.id], queryFn: async () => {
    const { data: members, error } = await supabase
      .from('organization_members')
      .select('user_id,role')
      .eq('org_id', org!.id)
    if (error) throw error
    const rows = (members ?? []) as { user_id: string; role: string }[]
    const names = new Map<string, string | null>()
    if (rows.length) {
      const { data: ps } = await supabase.from('profiles').select('id,full_name').in('id', rows.map((m) => m.user_id))
      ;(ps ?? []).forEach((p) => names.set(p.id as string, (p.full_name as string) ?? null))
    }
    // Branch names for the access summary: org branches (RLS-scoped read) plus
    // existing branch_members rows narrowed client-side to this organization
    // (the table itself carries no org_id; RLS already scoped the read).
    const [{ data: branchRows }, { data: assignRows }] = await Promise.all([
      supabase.from('branches').select('id,name').eq('org_id', org!.id),
      supabase.from('branch_members').select('branch_id,user_id'),
    ])
    const branchName = new Map(((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]))
    const assigned = new Map<string, string[]>()
    for (const a of ((assignRows ?? []) as { branch_id: string; user_id: string }[])) {
      const name = branchName.get(a.branch_id)
      if (!name) continue // assignment in another organization — not shown here
      const list = assigned.get(a.user_id) ?? []
      list.push(name)
      assigned.set(a.user_id, list)
    }
    return rows
      .map((m) => ({
        user_id: m.user_id,
        role: m.role,
        full_name: names.get(m.user_id) ?? null,
        branchNames: (assigned.get(m.user_id) ?? []).sort((x, y) => x.localeCompare(y)),
      }))
      .sort((a, b) => staffDisplayName(a.full_name, a.user_id).localeCompare(staffDisplayName(b.full_name, b.user_id))) as StaffRow[]
  } })

  const term = q.trim().toLowerCase()
  const rows = (roster.data ?? []).filter((m) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false
    if (!term) return true
    return staffDisplayName(m.full_name, m.user_id).toLowerCase().includes(term)
      || m.role.toLowerCase().includes(term)
  })
  const roles = [...new Set((roster.data ?? []).map((m) => m.role))].sort()

  return (
    <div className={pageCanvasCls}>
      <PageHeaderOnDark
        title="Users"
        description="Staff roster for this business. Read-only — roles and branch assignments are managed elsewhere."
      />
      {roster.isError && <Notice tone="err">Could not load staff: {friendly(roster.error)}</Notice>}

      <div className={filterBarCls}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or role" aria-label="Search staff" className={`${inputCls} sm:max-w-xs`} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role filter" className={selectCls}>
          <option value="all">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{roleText(r)}</option>)}
        </select>
      </div>

      <Card className="p-4 sm:p-5">
        <p className="text-xs text-slate-500">
          Branch assignments are shown for context only. Staff with no assigned branches can access all
          branches; assigning a first branch restricts them to assigned branches. Manage assignments on the
          Branches page.
        </p>
      </Card>

      <TableShell label="Staff">
        <thead>
          <tr>
            <th className={thCls}>Name</th><th className={thCls}>Role</th><th className={thCls}>Branch access</th>
          </tr>
        </thead>
        <tbody>
          {roster.isLoading && <tr><td className="p-4" colSpan={3}><Spinner label="Loading staff…" /></td></tr>}
          {roster.isError && (
            <tr><td className="p-4 text-red-700" colSpan={3}>
              Could not load staff.{' '}
              <RowAction icon="refresh" onClick={() => roster.refetch()}>Retry</RowAction>
            </td></tr>
          )}
          {roster.data && rows.length === 0 && (
            <tr><td colSpan={3}><EmptyState title={term || roleFilter !== 'all' ? 'No staff match these filters.' : 'No staff yet.'} hint={term || roleFilter !== 'all' ? 'Try a different search — or clear the filters to see everyone.' : 'Staff appear here once they join this business.'} /></td></tr>
          )}
          {rows.map((m) => (
            <tr key={m.user_id} className={rowCls}>
              <td className={`${tdCls} font-medium`}>{staffDisplayName(m.full_name, m.user_id)}</td>
              <td className={tdCls}>
                <StatusBadge tone={m.role === 'owner' || m.role === 'super_admin' ? 'blue' : 'slate'}>{roleText(m.role)}</StatusBadge>
              </td>
              <td className={tdCls}>{accessSummary(m.branchNames)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  )
}
