// Phase 6C-1 — Users / Staff read-only roster helpers.
//
// Pure logic lives here so it can be unit-tested; Users.tsx only wires it to
// Supabase. The database (mem_sel/prof_sel/branch_mem_sel RLS) remains the
// authority — these are presentation helpers, never a security boundary.
export function roleText(role: string): string {
  return role === 'owner' ? 'Admin' : role.replace('_', ' ')
}

export function staffDisplayName(fullName: string | null, userId: string): string {
  const trimmed = (fullName ?? '').trim()
  return trimmed || userId.slice(0, 8)
}

// Branch-access summary following the existing can_access_branch semantics:
// zero branch_members rows means access to every branch of the organization.
export function accessSummary(assignedBranchNames: readonly string[]): string {
  if (assignedBranchNames.length === 0) return 'All branches (unrestricted)'
  if (assignedBranchNames.length === 1) return assignedBranchNames[0]
  return `${assignedBranchNames.length} assigned`
}
